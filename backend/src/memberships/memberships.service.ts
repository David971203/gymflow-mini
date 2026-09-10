import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipStatus, PaymentStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../common/auth-context';
import { authenticatedGymId, requireGym } from '../common/gym-scope';
import type { AssignGymMembershipDto, CreateMemberWithMembershipDto, CreateMembershipDto, RenewMembershipDto, UpdateGymMembershipDto } from './memberships.dto';
import { membershipHasExpired, nextMembershipDayStart } from './membership-time';
import { PrismaService } from '../database/prisma.service';

export const membershipInclude = {
  member: { select: { id: true, gymId: true, ci: true, firstName: true, lastName: true, phone: true } },
  plan: true,
  payment: { include: { movements: { orderBy: { occurredAt: 'desc' as const } } } },
} satisfies Prisma.MembershipInclude;

@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService) {}

  async createMemberWithMembershipForGym(gymId: string, dto: CreateMemberWithMembershipDto, user: AuthUser, mergeByCi: boolean, verifyGym = false) {
    if (verifyGym) await requireGym(this.prisma, gymId);
    const { member: memberInput, membership: membershipInput } = dto;
    const { clientId, occurredAt, ...memberData } = memberInput;
    const periodCount = membershipInput.periodCount ?? 1;
    this.assertPeriodCount(periodCount);
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (membershipInput.clientMutationId) {
          const repeated = await tx.membership.findUnique({ where: { clientMutationId: membershipInput.clientMutationId }, include: membershipInclude });
          if (repeated) {
            if (repeated.member.gymId !== gymId) throw new ConflictException('La operación pertenece a otro gimnasio');
            return { member: repeated.member, membership: repeated, merged: repeated.member.id !== clientId };
          }
        }
        const [plan, existingById, existingByCi] = await Promise.all([
          tx.plan.findFirst({ where: { id: membershipInput.planId, gymId, isActive: true } }),
          clientId ? tx.member.findUnique({ where: { id: clientId } }) : Promise.resolve(null),
          tx.member.findUnique({ where: { gymId_ci: { gymId, ci: memberInput.ci } } }),
        ]);
        if (!plan) throw new NotFoundException('Plan activo no encontrado');
        if (existingById && existingById.gymId !== gymId) throw new ConflictException('El identificador local ya está en uso');
        const now = new Date();
        const boundary = nextMembershipDayStart(now);
        const startDate = membershipInput.startDate ? new Date(membershipInput.startDate) : now;
        const status = startDate >= boundary ? MembershipStatus.SCHEDULED : MembershipStatus.ACTIVE;
        const existing = existingById ?? existingByCi;
        if (existing && !mergeByCi) throw new ConflictException('Ya existe un miembro con ese carnet de identidad');
        const member = existing ?? await tx.member.create({ data: { ...(clientId ? { id: clientId } : {}), ...memberData, gymId, status: status === MembershipStatus.ACTIVE ? 'ACTIVE' : 'INACTIVE', ...(occurredAt ? { joinedAt: new Date(occurredAt) } : {}) } });
        const initial = membershipInput.initialPayment ?? 0;
        const total = Number(plan.price) * periodCount;
        this.assertInitialPayment(initial, total, membershipInput.paymentMethod);
        const collision = await tx.membership.findFirst({ where: { memberId: member.id, status, ...(status === MembershipStatus.ACTIVE ? { endDate: { gte: boundary } } : {}) } });
        if (collision) throw new ConflictException(status === MembershipStatus.ACTIVE ? 'El miembro ya tiene una membresía activa' : 'El miembro ya tiene una renovación programada');
        const endDate = new Date(startDate); endDate.setDate(endDate.getDate() + plan.durationDays * periodCount);
        const membership = await tx.membership.create({ data: { id: membershipInput.clientMembershipId, memberId: member.id, planId: plan.id, planName: plan.name, planPrice: plan.price, planDurationDays: plan.durationDays, startDate, endDate, periodCount, status, clientMutationId: membershipInput.clientMutationId } });
        const paymentStatus = initial === 0 ? PaymentStatus.PENDING : initial >= total ? PaymentStatus.PAID : PaymentStatus.PARTIAL;
        const operationTime = membershipInput.occurredAt ? new Date(membershipInput.occurredAt) : new Date();
        const payment = await tx.payment.create({ data: { id: membershipInput.clientPaymentId, gymId, memberId: member.id, membershipId: membership.id, amount: total, paidAmount: initial, dueDate: startDate, status: paymentStatus, paidAt: paymentStatus === PaymentStatus.PAID ? operationTime : null } });
        if (initial > 0 && membershipInput.paymentMethod) await tx.paymentMovement.create({ data: { paymentId: payment.id, actorUserId: user.id, amount: initial, method: membershipInput.paymentMethod, reference: membershipInput.reference, occurredAt: operationTime, clientMutationId: membershipInput.clientMutationId } });
        if (status === MembershipStatus.ACTIVE && member.status !== 'ACTIVE') await tx.member.update({ where: { id: member.id }, data: { status: 'ACTIVE' } });
        return { member, membership: await tx.membership.findUniqueOrThrow({ where: { id: membership.id }, include: membershipInclude }), merged: Boolean(existing) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      this.rethrowMemberConflict(error);
    }
  }

  async createForGym(gymId: string, memberId: string, dto: AssignGymMembershipDto, user: AuthUser, verifyGym = false) {
    if (verifyGym) await requireGym(this.prisma, gymId);
    const active = await this.prisma.membership.findFirst({ where: { memberId, member: { gymId }, status: MembershipStatus.ACTIVE, endDate: { gte: nextMembershipDayStart() } } });
    if (active) throw new ConflictException('El miembro ya tiene una membresía activa');
    return this.assignForGym({ ...dto, memberId }, gymId, user);
  }

  async listForGym(gymId: string, memberId?: string, verifyGym = false) {
    if (verifyGym) await requireGym(this.prisma, gymId);
    if (memberId) {
      const member = await this.prisma.member.findFirst({ where: { id: memberId, gymId } });
      if (!member) throw new NotFoundException('Miembro no encontrado');
    }
    return this.prisma.membership.findMany({ where: { ...(memberId ? { memberId } : {}), member: { gymId } }, include: membershipInclude, orderBy: { createdAt: 'desc' } });
  }

  async updateForGym(gymId: string, memberId: string, id: string, dto: UpdateGymMembershipDto, verifyGym = false) {
    if (verifyGym) await requireGym(this.prisma, gymId);
    const current = await this.prisma.membership.findFirst({ where: { id, memberId, member: { gymId } }, include: { member: true, payment: { include: { movements: true } } } });
    if (!current) throw new NotFoundException('Membresía no encontrada');
    const boundary = nextMembershipDayStart();
    if (current.status === MembershipStatus.ACTIVE && current.endDate >= boundary && ((dto.planId && dto.planId !== current.planId) || dto.startDate || dto.endDate)) throw new ConflictException('No se puede cambiar el plan de una membresía mientras esté activa. Puedes cancelarla o esperar a que venza.');
    const planId = dto.planId ?? current.planId;
    const plan = await this.prisma.plan.findFirst({ where: { id: planId, gymId, ...(planId !== current.planId ? { isActive: true } : {}) } });
    if (!plan) throw new NotFoundException('Plan no encontrado o inactivo');
    const startDate = dto.startDate ? new Date(dto.startDate) : current.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : dto.planId && dto.planId !== current.planId ? new Date(startDate.getTime() + plan.durationDays * current.periodCount * 86400000) : current.endDate;
    if (endDate <= startDate) throw new BadRequestException('La fecha final debe ser posterior a la fecha inicial');
    const status = dto.status === MembershipStatus.CANCELLED || (current.status === MembershipStatus.CANCELLED && dto.status === undefined) ? MembershipStatus.CANCELLED : membershipHasExpired(endDate) ? MembershipStatus.EXPIRED : startDate >= boundary ? MembershipStatus.SCHEDULED : MembershipStatus.ACTIVE;
    if (status === MembershipStatus.ACTIVE) {
      const collision = await this.prisma.membership.findFirst({ where: { id: { not: id }, memberId, status: MembershipStatus.ACTIVE, endDate: { gte: boundary } } });
      if (collision) throw new ConflictException('El miembro ya tiene otra membresía activa');
    }
    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.membership.update({ where: { id }, data: { planId, startDate, endDate, status, ...(planId !== current.planId ? { planName: plan.name, planPrice: plan.price, planDurationDays: plan.durationDays } : {}) } });
      if (current.payment) {
        const amount = planId !== current.planId ? Number(plan.price) * current.periodCount : Number(current.payment.amount);
        const paidAmount = Number(current.payment.paidAmount);
        if (paidAmount > amount) throw new BadRequestException('El importe abonado supera el precio del nuevo plan');
        const paymentStatus = paidAmount === 0 ? (current.payment.status === PaymentStatus.OVERDUE ? PaymentStatus.OVERDUE : PaymentStatus.PENDING) : paidAmount >= amount ? PaymentStatus.PAID : (current.payment.status === PaymentStatus.OVERDUE ? PaymentStatus.OVERDUE : PaymentStatus.PARTIAL);
        await tx.payment.update({ where: { id: current.payment.id }, data: { amount, dueDate: startDate, status: paymentStatus, paidAt: paymentStatus === PaymentStatus.PAID ? current.payment.paidAt ?? new Date() : null } });
      }
      const active = await tx.membership.findFirst({ where: { memberId, status: MembershipStatus.ACTIVE, startDate: { lt: boundary }, endDate: { gte: boundary } }, select: { id: true } });
      await tx.member.update({ where: { id: memberId }, data: { status: active ? 'ACTIVE' : 'INACTIVE' } });
      return tx.membership.findUniqueOrThrow({ where: { id: membership.id }, include: membershipInclude });
    });
  }

  async deleteForGym(gymId: string, memberId: string, id: string, verifyGym = false) {
    if (verifyGym) await requireGym(this.prisma, gymId);
    const membership = await this.prisma.membership.findFirst({ where: { id, memberId, member: { gymId } }, include: { payment: { include: { movements: true } } } });
    if (!membership) throw new NotFoundException('Membresía no encontrada');
    const hasHistory = membership.payment && (Number(membership.payment.paidAmount) > 0 || membership.payment.movements.length > 0);
    return this.prisma.$transaction(async (tx) => {
      if (hasHistory) await tx.membership.update({ where: { id }, data: { status: MembershipStatus.CANCELLED } });
      else { if (membership.payment) await tx.payment.delete({ where: { id: membership.payment.id } }); await tx.membership.delete({ where: { id } }); }
      const boundary = nextMembershipDayStart();
      const active = await tx.membership.findFirst({ where: { memberId, status: MembershipStatus.ACTIVE, startDate: { lt: boundary }, endDate: { gte: boundary } }, select: { id: true } });
      await tx.member.update({ where: { id: memberId }, data: { status: active ? 'ACTIVE' : 'INACTIVE' } });
      return { id, disposition: hasHistory ? 'ARCHIVED' as const : 'DELETED' as const };
    });
  }

  async assignForGym(dto: CreateMembershipDto, gymId: string, user: AuthUser) {
    if (dto.clientMutationId) {
      const repeated = await this.prisma.membership.findUnique({ where: { clientMutationId: dto.clientMutationId }, include: membershipInclude });
      if (repeated) { if (repeated.member.gymId !== gymId) throw new ConflictException('La operación pertenece a otro gimnasio'); return repeated; }
    }
    const [member, plan] = await Promise.all([
      this.prisma.member.findFirst({ where: { id: dto.memberId, gymId } }),
      this.prisma.plan.findFirst({ where: { id: dto.planId, gymId, isActive: true } }),
    ]);
    if (!member) throw new NotFoundException('Miembro no encontrado');
    if (!plan) throw new NotFoundException('Plan activo no encontrado');
    const periodCount = dto.periodCount ?? 1;
    this.assertPeriodCount(periodCount);
    const total = Number(plan.price) * periodCount;
    const initial = dto.initialPayment ?? 0;
    this.assertInitialPayment(initial, total, dto.paymentMethod);
    const now = new Date();
    const boundary = nextMembershipDayStart(now);
    const startDate = dto.startDate ? new Date(dto.startDate) : now;
    const status = startDate >= boundary ? MembershipStatus.SCHEDULED : MembershipStatus.ACTIVE;
    const endDate = new Date(startDate); endDate.setDate(endDate.getDate() + plan.durationDays * periodCount);
    return this.prisma.$transaction(async (tx) => {
      await tx.membership.updateMany({ where: { memberId: member.id, status: MembershipStatus.ACTIVE, endDate: { lt: boundary } }, data: { status: MembershipStatus.EXPIRED } });
      const collision = await tx.membership.findFirst({ where: { memberId: member.id, status, ...(status === MembershipStatus.ACTIVE ? { endDate: { gte: boundary } } : {}) } });
      if (collision) throw new ConflictException(status === MembershipStatus.ACTIVE ? 'El miembro ya tiene una membresía activa' : 'El miembro ya tiene una renovación programada');
      const membership = await tx.membership.create({ data: { id: dto.clientMembershipId, memberId: member.id, planId: plan.id, planName: plan.name, planPrice: plan.price, planDurationDays: plan.durationDays, startDate, endDate, periodCount, status, clientMutationId: dto.clientMutationId } });
      const paymentStatus = initial === 0 ? PaymentStatus.PENDING : initial >= total ? PaymentStatus.PAID : PaymentStatus.PARTIAL;
      const operationTime = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
      const payment = await tx.payment.create({ data: { id: dto.clientPaymentId, gymId, memberId: member.id, membershipId: membership.id, amount: total, paidAmount: initial, dueDate: startDate, status: paymentStatus, paidAt: paymentStatus === PaymentStatus.PAID ? operationTime : null } });
      if (initial > 0 && dto.paymentMethod) await tx.paymentMovement.create({ data: { paymentId: payment.id, actorUserId: user.id, amount: initial, method: dto.paymentMethod, reference: dto.reference, occurredAt: operationTime, clientMutationId: dto.clientMutationId } });
      if (status === MembershipStatus.ACTIVE) await tx.member.update({ where: { id: member.id }, data: { status: 'ACTIVE' } });
      return tx.membership.findUniqueOrThrow({ where: { id: membership.id }, include: membershipInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  create(dto: CreateMembershipDto, user: AuthUser) { return this.assignForGym(dto, authenticatedGymId(user), user); }
  createMemberWithMembership(dto: CreateMemberWithMembershipDto, user: AuthUser, mergeByCi = false) { return this.createMemberWithMembershipForGym(authenticatedGymId(user), dto, user, mergeByCi); }
  list(user: AuthUser, memberId?: string) { return this.listForGym(authenticatedGymId(user), memberId); }

  async update(id: string, dto: UpdateGymMembershipDto, user: AuthUser) {
    const gymId = authenticatedGymId(user);
    const membership = await this.prisma.membership.findFirst({ where: { id, member: { gymId } }, select: { memberId: true } });
    if (!membership) throw new NotFoundException('Membresía no encontrada');
    return this.updateForGym(gymId, membership.memberId, id, dto);
  }

  async delete(id: string, user: AuthUser) {
    const gymId = authenticatedGymId(user);
    const membership = await this.prisma.membership.findFirst({ where: { id, member: { gymId } }, select: { memberId: true, status: true } });
    if (!membership) throw new NotFoundException('Membresía no encontrada');
    if (membership.status !== MembershipStatus.SCHEDULED) throw new BadRequestException('Solo se pueden eliminar renovaciones programadas');
    return this.deleteForGym(gymId, membership.memberId, id);
  }

  async renew(id: string, dto: RenewMembershipDto, user: AuthUser) {
    const gymId = authenticatedGymId(user);
    const current = await this.prisma.membership.findFirst({ where: { id, member: { gymId } } });
    if (!current) throw new NotFoundException('Membresía no encontrada');
    const now = new Date();
    const startDate = membershipHasExpired(current.endDate, now) ? now : current.endDate;
    return this.assignForGym({ memberId: current.memberId, planId: dto.planId ?? current.planId, periodCount: dto.periodCount, startDate: startDate.toISOString(), initialPayment: dto.initialPayment, paymentMethod: dto.paymentMethod, reference: dto.reference, clientMembershipId: dto.clientMembershipId, clientPaymentId: dto.clientPaymentId, clientMutationId: dto.clientMutationId, occurredAt: dto.occurredAt }, gymId, user);
  }

  private assertPeriodCount(value: number) {
    if (!Number.isInteger(value) || value < 1 || value > 24) throw new BadRequestException('La cantidad de períodos debe ser un número entero entre 1 y 24');
  }

  private assertInitialPayment(initial: number, total: number, method?: unknown) {
    if (initial > total) throw new BadRequestException('El abono inicial supera el precio del plan');
    if (initial > 0 && !method) throw new BadRequestException('Indica el método del abono inicial');
  }

  private rethrowMemberConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : String(error.meta?.target ?? '');
      if (target.includes('code')) throw new ConflictException('Ya existe un miembro con ese código interno en el gimnasio');
      throw new ConflictException('Ya existe un miembro registrado con ese carnet de identidad');
    }
    throw error;
  }
}
