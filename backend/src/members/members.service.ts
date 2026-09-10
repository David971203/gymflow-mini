import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../common/auth-context';
import { authenticatedGymId, requireGym } from '../common/gym-scope';
import type { CreateMemberDto, UpdateMemberDto } from './members.dto';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  async listForGym(gymId: string, search?: string, verifyGym = false, includeLastNameOrder = true) {
    if (verifyGym) await requireGym(this.prisma, gymId);
    return this.prisma.member.findMany({
      where: { gymId, ...(search ? { OR: [{ code: { contains: search, mode: 'insensitive' as const } }, { ci: { contains: search } }, { firstName: { contains: search, mode: 'insensitive' as const } }, { lastName: { contains: search, mode: 'insensitive' as const } }, { phone: { contains: search } }] } : {}) },
      include: { memberships: { include: { plan: true, payment: true }, orderBy: { createdAt: 'desc' as const }, take: 1 } },
      orderBy: includeLastNameOrder
        ? [{ status: 'asc' as const }, { firstName: 'asc' as const }, { lastName: 'asc' as const }]
        : [{ status: 'asc' as const }, { firstName: 'asc' as const }],
    });
  }

  async createForGym(gymId: string, dto: CreateMemberDto, options: { verifyGym?: boolean; idempotentClientId?: boolean } = {}) {
    if (options.verifyGym) await requireGym(this.prisma, gymId);
    const { clientId, occurredAt, ...data } = dto;
    if (options.idempotentClientId && clientId) {
      const existing = await this.prisma.member.findUnique({ where: { id: clientId } });
      if (existing) {
        if (existing.gymId !== gymId) throw new ConflictException('El identificador local ya está en uso');
        return existing;
      }
    }
    try {
      return await this.prisma.member.create({ data: { ...(clientId ? { id: clientId } : {}), ...data, gymId, status: 'INACTIVE', ...(occurredAt ? { joinedAt: new Date(occurredAt) } : {}) } });
    } catch (error) {
      this.rethrowCiConflict(error);
    }
  }

  async updateForGym(gymId: string, id: string, dto: UpdateMemberDto) {
    const member = await this.prisma.member.findFirst({ where: { id, gymId } });
    if (!member) throw new NotFoundException('Miembro no encontrado');
    try {
      return await this.prisma.member.update({ where: { id }, data: dto });
    } catch (error) {
      this.rethrowCiConflict(error);
    }
  }

  async deleteForGym(gymId: string, id: string) {
    const member = await this.prisma.member.findFirst({ where: { id, gymId } });
    if (!member) throw new NotFoundException('Miembro no encontrado');
    const [memberships, payments, attendances] = await Promise.all([
      this.prisma.membership.count({ where: { memberId: id } }),
      this.prisma.payment.count({ where: { memberId: id, gymId } }),
      this.prisma.attendance.count({ where: { memberId: id, gymId } }),
    ]);
    if (memberships > 0 || payments > 0 || attendances > 0) {
      const cancellable = await this.prisma.membership.findMany({ where: { memberId: id, status: { in: [MembershipStatus.ACTIVE, MembershipStatus.SCHEDULED] } }, select: { id: true } });
      const ids = cancellable.map((membership) => membership.id);
      await this.prisma.$transaction(async (tx) => {
        if (ids.length) await tx.membership.updateMany({ where: { id: { in: ids }, memberId: id }, data: { status: MembershipStatus.CANCELLED } });
        await tx.member.update({ where: { id }, data: { status: 'INACTIVE' } });
      });
      return { id, disposition: 'ARCHIVED' as const };
    }
    await this.prisma.member.delete({ where: { id } });
    return { id, disposition: 'DELETED' as const };
  }

  async savePhoto(id: string, file: Express.Multer.File | undefined, user: AuthUser) {
    const gymId = authenticatedGymId(user);
    await this.requireMember(id, gymId);
    if (!file?.buffer?.length) throw new BadRequestException('Selecciona una foto válida');
    if (file.size > 250 * 1024) throw new BadRequestException('La foto supera el límite de 250 KB');
    const isJpeg = file.buffer.length >= 3 && file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff;
    if (file.mimetype !== 'image/jpeg' || !isJpeg) throw new BadRequestException('La foto debe estar en formato JPEG');
    const photoUpdatedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.memberPhoto.upsert({ where: { memberId: id }, create: { memberId: id, gymId, data: file.buffer, mimeType: 'image/jpeg', byteSize: file.size }, update: { gymId, data: file.buffer, mimeType: 'image/jpeg', byteSize: file.size } }),
      this.prisma.member.update({ where: { id }, data: { photoUpdatedAt } }),
    ]);
    return { photoUpdatedAt };
  }

  async getPhoto(id: string, user: AuthUser) {
    await this.requireMember(id, authenticatedGymId(user));
    const photo = await this.prisma.memberPhoto.findUnique({ where: { memberId: id } });
    if (!photo) throw new NotFoundException('El miembro no tiene una foto');
    return photo;
  }

  async deletePhoto(id: string, user: AuthUser) {
    const gymId = authenticatedGymId(user);
    await this.requireMember(id, gymId);
    await this.prisma.$transaction([
      this.prisma.memberPhoto.deleteMany({ where: { memberId: id, gymId } }),
      this.prisma.member.update({ where: { id }, data: { photoUpdatedAt: null } }),
    ]);
    return { id, photoUpdatedAt: null };
  }

  list(user: AuthUser, search?: string) { return this.listForGym(authenticatedGymId(user), search, false, false); }
  create(dto: CreateMemberDto, user: AuthUser) { return this.createForGym(authenticatedGymId(user), dto, { idempotentClientId: true }); }
  update(id: string, dto: UpdateMemberDto, user: AuthUser) { return this.updateForGym(authenticatedGymId(user), id, dto); }
  delete(id: string, user: AuthUser) { return this.deleteForGym(authenticatedGymId(user), id); }
  findByCi(ci: string, user: AuthUser) { return this.prisma.member.findUnique({ where: { gymId_ci: { gymId: authenticatedGymId(user), ci } } }); }

  private async requireMember(id: string, gymId: string) {
    const member = await this.prisma.member.findFirst({ where: { id, gymId } });
    if (!member) throw new NotFoundException('Miembro no encontrado');
    return member;
  }

  private rethrowCiConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : String(error.meta?.target ?? '');
      if (target.includes('code')) throw new ConflictException('Ya existe un miembro con ese código interno en el gimnasio');
      throw new ConflictException('Ya existe un miembro registrado con ese carnet de identidad');
    }
    throw error;
  }
}
