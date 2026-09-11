import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceMethod, MembershipStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../common/auth-context';
import { AttendanceQueryDto, CheckInAttendanceDto, CheckOutAttendanceDto } from './attendance.dto';
import { nextMembershipDayStart } from '../memberships/membership-time';
import { PrismaService } from '../database/prisma.service';

const attendanceInclude = {
  member: { select: { id: true, firstName: true, lastName: true, status: true, qrCode: true } },
} satisfies Prisma.AttendanceInclude;

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  private gymId(user: AuthUser) {
    if (!user.gymId) throw new BadRequestException('El usuario no pertenece a un gimnasio');
    return user.gymId;
  }

  async list(user: AuthUser, query: AttendanceQueryDto = {}) {
    const gymId = this.gymId(user);
    return this.prisma.attendance.findMany({
      where: {
        gymId,
        ...(query.memberId ? { memberId: query.memberId } : {}),
        ...(query.from || query.to ? { checkInAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
      },
      include: attendanceInclude,
      orderBy: { checkInAt: 'desc' },
      take: 500,
    });
  }

  async snapshot(user: AuthUser) {
    const gymId = this.gymId(user);
    const from = new Date();
    from.setDate(from.getDate() - 30);
    return this.prisma.attendance.findMany({
      where: { gymId, OR: [{ checkInAt: { gte: from } }, { checkOutAt: null }] },
      include: attendanceInclude,
      orderBy: { checkInAt: 'desc' },
      take: 500,
    });
  }

  async checkIn(dto: CheckInAttendanceDto, user: AuthUser) {
    const gymId = this.gymId(user);
    if (!!dto.memberId === !!dto.qrCode) throw new BadRequestException('Indica exactamente un miembro o un código QR');
    if (dto.clientMutationId) {
      const existing = await this.prisma.attendance.findUnique({ where: { clientCheckInId: dto.clientMutationId }, include: attendanceInclude });
      if (existing) {
        if (existing.gymId !== gymId) throw new NotFoundException('No se encontró la operación sincronizada');
        return existing;
      }
    }
    const member = await this.prisma.member.findFirst({
      where: { gymId, ...(dto.qrCode ? { qrCode: dto.qrCode } : { id: dto.memberId }), gym: { isActive: true } },
    });
    if (!member) throw new NotFoundException('No se encontró un miembro válido con ese código');
    if (member.status !== 'ACTIVE') throw new BadRequestException('El miembro está inactivo y no puede registrar asistencia');

    const now = new Date();
    const checkInAt = dto.occurredAt ? new Date(dto.occurredAt) : now;
    if (checkInAt < new Date(now.getTime() - 72 * 60 * 60 * 1000) || checkInAt > new Date(now.getTime() + 5 * 60 * 1000)) {
      throw new BadRequestException('La hora de entrada no está dentro del rango offline permitido');
    }
    const membership = await this.prisma.membership.findFirst({
      where: { memberId: member.id, status: MembershipStatus.ACTIVE, startDate: { lt: nextMembershipDayStart(checkInAt) }, endDate: { gte: nextMembershipDayStart(checkInAt) } },
    });
    if (!membership) throw new BadRequestException('El miembro no tiene una membresía vigente');
    const open = await this.prisma.attendance.findFirst({ where: { gymId, memberId: member.id, checkOutAt: null } });
    if (open) throw new ConflictException('El miembro ya tiene una entrada abierta');

    try {
      return await this.prisma.attendance.create({
        data: {
          ...(dto.clientAttendanceId ? { id: dto.clientAttendanceId } : {}),
          gymId,
          memberId: member.id,
          checkInAt,
          method: dto.qrCode ? AttendanceMethod.QR : (dto.method ?? AttendanceMethod.MANUAL),
          clientCheckInId: dto.clientMutationId,
        },
        include: attendanceInclude,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('El miembro ya tiene una entrada abierta');
      throw error;
    }
  }

  async checkOut(id: string, dto: CheckOutAttendanceDto, user: AuthUser) {
    const gymId = this.gymId(user);
    if (dto.clientMutationId) {
      const existing = await this.prisma.attendance.findUnique({ where: { clientCheckOutId: dto.clientMutationId }, include: attendanceInclude });
      if (existing) {
        if (existing.gymId !== gymId) throw new NotFoundException('No se encontró la operación sincronizada');
        return existing;
      }
    }
    const attendance = await this.prisma.attendance.findFirst({ where: { id, gymId }, include: attendanceInclude });
    if (!attendance) throw new NotFoundException('Registro de asistencia no encontrado');
    if (attendance.checkOutAt) throw new ConflictException('La salida ya fue registrada');
    const now = new Date();
    const checkOutAt = dto.occurredAt ? new Date(dto.occurredAt) : now;
    if (checkOutAt < attendance.checkInAt || checkOutAt > new Date(now.getTime() + 5 * 60 * 1000)) throw new BadRequestException('La hora de salida no es válida');
    return this.prisma.attendance.update({
      where: { id }, data: { checkOutAt, clientCheckOutId: dto.clientMutationId }, include: attendanceInclude,
    });
  }
}
