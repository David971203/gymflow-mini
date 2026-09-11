import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../common/auth-context';
import { authenticatedGymId, requireGym } from '../common/gym-scope';
import type { CreatePlanDto, UpdatePlanDto } from './plans.dto';
import { nextMembershipDayStart } from '../memberships/membership-time';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async listForGym(gymId: string, verifyGym = false) {
    if (verifyGym) await requireGym(this.prisma, gymId);
    return this.prisma.plan.findMany({ where: { gymId }, orderBy: [{ isActive: 'desc' }, { price: 'asc' }] });
  }

  async createForGym(gymId: string, dto: CreatePlanDto, verifyGym = false) {
    if (verifyGym) await requireGym(this.prisma, gymId);
    const { clientId, ...data } = dto;
    if (clientId) {
      const existing = await this.prisma.plan.findUnique({ where: { id: clientId } });
      if (existing) {
        if (existing.gymId !== gymId) throw new ConflictException('El identificador local ya está en uso');
        return existing;
      }
    }
    try {
      return await this.prisma.plan.create({ data: { ...(clientId ? { id: clientId } : {}), ...data, gymId } });
    } catch (error) {
      if (this.isUniqueConflict(error, 'name')) throw new ConflictException('Ya existe un plan con ese nombre en el gimnasio');
      throw error;
    }
  }

  async updateForGym(gymId: string, id: string, dto: UpdatePlanDto, verifyGym = false) {
    if (verifyGym) await requireGym(this.prisma, gymId);
    const plan = await this.prisma.plan.findFirst({ where: { id, gymId } });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    try {
      return await this.prisma.plan.update({ where: { id }, data: dto });
    } catch (error) {
      if (this.isUniqueConflict(error, 'name')) throw new ConflictException('Ya existe un plan con ese nombre en el gimnasio');
      throw error;
    }
  }

  async deleteForGym(gymId: string, id: string, verifyGym = false) {
    if (verifyGym) await requireGym(this.prisma, gymId);
    const plan = await this.prisma.plan.findFirst({ where: { id, gymId } });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    const activeMembership = await this.prisma.membership.findFirst({ where: { planId: id, status: MembershipStatus.ACTIVE, endDate: { gte: nextMembershipDayStart() }, member: { gymId } } });
    if (activeMembership) throw new ConflictException('No se puede eliminar un plan con membresías activas');
    const memberships = await this.prisma.membership.count({ where: { planId: id, member: { gymId } } });
    if (memberships > 0) {
      await this.prisma.plan.update({ where: { id }, data: { isActive: false } });
      return { id, disposition: 'ARCHIVED' as const };
    }
    await this.prisma.plan.delete({ where: { id } });
    return { id, disposition: 'DELETED' as const };
  }

  list(user: AuthUser) { return this.listForGym(authenticatedGymId(user)); }
  create(dto: CreatePlanDto, user: AuthUser) { return this.createForGym(authenticatedGymId(user), dto); }
  update(id: string, dto: UpdatePlanDto, user: AuthUser) { return this.updateForGym(authenticatedGymId(user), id, dto); }
  delete(id: string, user: AuthUser) { return this.deleteForGym(authenticatedGymId(user), id); }
  findByName(name: string, user: AuthUser) { return this.prisma.plan.findUnique({ where: { gymId_name: { gymId: authenticatedGymId(user), name } } }); }

  private isUniqueConflict(error: unknown, field: string): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
    const target = error.meta?.target;
    return Array.isArray(target) ? target.includes(field) : String(target ?? '').includes(field);
  }
}
