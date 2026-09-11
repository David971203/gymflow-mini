import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import type { AuthUser } from '../common/auth-context';
import { authenticatedGymId } from '../common/gym-scope';
import type { CreateStaffAccountDto, UpdateStaffAccountDto } from './staff.dto';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: AuthUser) {
    const gymId = authenticatedGymId(user);
    return this.prisma.user.findMany({ where: { gymId, role: { in: [UserRole.ADMIN, UserRole.RECEPTIONIST] } }, select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true }, orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { name: 'asc' }] });
  }

  async create(dto: CreateStaffAccountDto, user: AuthUser) {
    const gymId = authenticatedGymId(user);
    try {
      return await this.prisma.user.create({ data: { gymId, role: UserRole.RECEPTIONIST, name: dto.name.trim(), email: dto.email.trim().toLowerCase(), passwordHash: await argon2.hash(dto.password), emailVerifiedAt: new Date() }, select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true } });
    } catch (error) { if (this.isUniqueEmail(error)) throw new ConflictException('Ese correo ya tiene una cuenta'); throw error; }
  }

  async update(id: string, dto: UpdateStaffAccountDto, user: AuthUser) {
    const gymId = authenticatedGymId(user);
    const account = await this.prisma.user.findFirst({ where: { id, gymId, role: UserRole.RECEPTIONIST } });
    if (!account) throw new NotFoundException('Recepcionista no encontrado');
    const { password, email, ...fields } = dto;
    try {
      return await this.prisma.user.update({ where: { id }, data: { ...fields, ...(email ? { email: email.trim().toLowerCase() } : {}), ...(password ? { passwordHash: await argon2.hash(password) } : {}), ...((password || dto.isActive !== undefined) ? { tokenVersion: { increment: 1 } } : {}) }, select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true } });
    } catch (error) { if (this.isUniqueEmail(error)) throw new ConflictException('Ese correo ya tiene una cuenta'); throw error; }
  }

  async delete(id: string, user: AuthUser) {
    const gymId = authenticatedGymId(user);
    const account = await this.prisma.user.findFirst({ where: { id, gymId, role: UserRole.RECEPTIONIST } });
    if (!account) throw new NotFoundException('Recepcionista no encontrado');
    const movements = await this.prisma.paymentMovement.count({ where: { actorUserId: id } });
    if (movements > 0) { await this.prisma.user.update({ where: { id }, data: { isActive: false, tokenVersion: { increment: 1 } } }); return { id, disposition: 'ARCHIVED' as const }; }
    await this.prisma.user.delete({ where: { id } });
    return { id, disposition: 'DELETED' as const };
  }

  private isUniqueEmail(error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
    const target = error.meta?.target;
    return Array.isArray(target) ? target.includes('email') : String(target ?? '').includes('email');
  }
}
