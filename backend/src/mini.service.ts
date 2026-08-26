import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipStatus, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from './prisma.service';
import type { AuthUser } from './common';
import { ApplyPaymentDto, CreateGymAdminDto, CreateGymDto, CreateMemberDto, CreateMembershipDto, CreatePlanDto, RenewMembershipDto, UpdateGymAdminDto, UpdateGymDto, UpdateMemberDto, UpdatePlanDto } from './mini.dto';

const membershipInclude = {
  member: { select: { id: true, gymId: true, ci: true, firstName: true, lastName: true, phone: true } },
  plan: true,
  payment: { include: { movements: { orderBy: { occurredAt: 'desc' as const } } } },
} satisfies Prisma.MembershipInclude;

@Injectable()
export class MiniService {
  constructor(private readonly prisma: PrismaService) {}

  private gymId(user: AuthUser): string {
    if (user.role !== UserRole.ADMIN || !user.gymId) throw new BadRequestException('Se requiere un administrador de gimnasio');
    return user.gymId;
  }

  async createGym(dto: CreateGymDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.adminEmail.toLowerCase() } });
    if (existing) throw new ConflictException('Ese correo ya tiene una cuenta');
    return this.prisma.$transaction(async (tx) => {
      const gym = await tx.gym.create({ data: { name: dto.name, slug: dto.slug.toLowerCase(), province: dto.province, phone: dto.phone } });
      await tx.user.create({ data: { email: dto.adminEmail.toLowerCase(), passwordHash: await argon2.hash(dto.adminPassword), name: dto.adminName, role: UserRole.ADMIN, gymId: gym.id } });
      return gym;
    });
  }

  listGyms() {
    return this.prisma.gym.findMany({
      include: { _count: { select: { members: true } }, users: { where: { role: UserRole.ADMIN }, select: { id: true, email: true, name: true, isActive: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getGym(id: string) {
    const gym = await this.prisma.gym.findUnique({
      where: { id },
      include: {
        _count: { select: { members: true, plans: true, payments: true } },
        users: { where: { role: UserRole.ADMIN }, select: { id: true, email: true, name: true, isActive: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!gym) throw new NotFoundException('Gimnasio no encontrado');
    return gym;
  }

  async updateGym(id: string, dto: UpdateGymDto) {
    await this.requireGym(id);
    try {
      return await this.prisma.gym.update({ where: { id }, data: { ...dto, ...(dto.slug ? { slug: dto.slug.toLowerCase() } : {}) } });
    } catch (error) {
      if (this.isUniqueConflict(error, 'slug')) throw new ConflictException('Ese identificador de gimnasio ya está en uso');
      throw error;
    }
  }

  updateGymStatus(id: string, isActive: boolean) {
    return this.prisma.gym.update({ where: { id }, data: { isActive } });
  }

  async listGymAdmins(gymId: string) {
    await this.requireGym(gymId);
    return this.prisma.user.findMany({
      where: { gymId, role: UserRole.ADMIN },
      select: { id: true, email: true, name: true, isActive: true, createdAt: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async createGymAdmin(gymId: string, dto: CreateGymAdminDto) {
    await this.requireGym(gymId);
    try {
      return await this.prisma.user.create({
        data: { gymId, role: UserRole.ADMIN, name: dto.name, email: dto.email.toLowerCase(), passwordHash: await argon2.hash(dto.password), isActive: dto.isActive ?? true },
        select: { id: true, email: true, name: true, isActive: true, createdAt: true },
      });
    } catch (error) {
      if (this.isUniqueConflict(error, 'email')) throw new ConflictException('Ese correo ya tiene una cuenta');
      throw error;
    }
  }

  async updateGymAdmin(gymId: string, id: string, dto: UpdateGymAdminDto) {
    const admin = await this.prisma.user.findFirst({ where: { id, gymId, role: UserRole.ADMIN } });
    if (!admin) throw new NotFoundException('Administrador no encontrado');
    const { password, email, ...fields } = dto;
    try {
      return await this.prisma.user.update({
        where: { id },
        data: { ...fields, ...(email ? { email: email.toLowerCase() } : {}), ...(password ? { passwordHash: await argon2.hash(password) } : {}) },
        select: { id: true, email: true, name: true, isActive: true, createdAt: true },
      });
    } catch (error) {
      if (this.isUniqueConflict(error, 'email')) throw new ConflictException('Ese correo ya tiene una cuenta');
      throw error;
    }
  }

  async listGymMembers(gymId: string, search?: string) {
    await this.requireGym(gymId);
    return this.prisma.member.findMany({
      where: { gymId, ...(search ? { OR: [{ ci: { contains: search } }, { firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] } : {}) },
      include: { memberships: { include: { plan: true, payment: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: [{ status: 'asc' }, { firstName: 'asc' }, { lastName: 'asc' }],
    });
  }

  async createGymMember(gymId: string, dto: CreateMemberDto) {
    await this.requireGym(gymId);
    const { clientId, occurredAt, ...data } = dto;
    try {
      return await this.prisma.member.create({ data: { ...(clientId ? { id: clientId } : {}), ...data, gymId, ...(occurredAt ? { joinedAt: new Date(occurredAt) } : {}) } });
    } catch (error) {
      this.rethrowMemberCiConflict(error);
    }
  }

  async updateGymMember(gymId: string, id: string, dto: UpdateMemberDto) {
    const member = await this.prisma.member.findFirst({ where: { id, gymId } });
    if (!member) throw new NotFoundException('Miembro no encontrado');
    try {
      return await this.prisma.member.update({ where: { id }, data: dto });
    } catch (error) {
      this.rethrowMemberCiConflict(error);
    }
  }

  async platformOverview() {
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const [gyms, activeGyms, members, newMembers, revenue, debtRows] = await Promise.all([
      this.prisma.gym.count(),
      this.prisma.gym.count({ where: { isActive: true } }),
      this.prisma.member.count({ where: { status: 'ACTIVE' } }),
      this.prisma.member.count({ where: { joinedAt: { gte: start } } }),
      this.prisma.paymentMovement.aggregate({ where: { occurredAt: { gte: start } }, _sum: { amount: true } }),
      this.prisma.payment.findMany({ where: { status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL, PaymentStatus.OVERDUE] } }, select: { amount: true, paidAmount: true } }),
    ]);
    const debt = debtRows.reduce((sum, row) => sum + Number(row.amount) - Number(row.paidAmount), 0);
    return { gyms, activeGyms, members, newMembers, monthlyRevenue: Number(revenue._sum.amount ?? 0), pendingDebt: Number(debt.toFixed(2)) };
  }

  async createMember(dto: CreateMemberDto, user: AuthUser) {
    const gymId = this.gymId(user);
    const { clientId, occurredAt, ...data } = dto;
    if (clientId) {
      const existingById = await this.prisma.member.findUnique({ where: { id: clientId } });
      if (existingById) {
        if (existingById.gymId !== gymId) throw new ConflictException('El identificador local ya está en uso');
        return existingById;
      }
    }
    try {
      return await this.prisma.member.create({ data: { ...(clientId ? { id: clientId } : {}), ...data, gymId, ...(occurredAt ? { joinedAt: new Date(occurredAt) } : {}) } });
    } catch (error) {
      this.rethrowMemberCiConflict(error);
    }
  }

  listMembers(user: AuthUser, search?: string) {
    const gymId = this.gymId(user);
    return this.prisma.member.findMany({
      where: { gymId, ...(search ? { OR: [{ ci: { contains: search } }, { firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] } : {}) },
      include: { memberships: { include: { plan: true, payment: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: [{ status: 'asc' }, { firstName: 'asc' }],
    });
  }

  async updateMember(id: string, dto: UpdateMemberDto, user: AuthUser) {
    await this.requireMember(id, user);
    try {
      return await this.prisma.member.update({ where: { id }, data: dto });
    } catch (error) {
      this.rethrowMemberCiConflict(error);
    }
  }

  async createPlan(dto: CreatePlanDto, user: AuthUser) {
    const gymId = this.gymId(user);
    const { clientId, ...data } = dto;
    if (clientId) {
      const existing = await this.prisma.plan.findUnique({ where: { id: clientId } });
      if (existing) {
        if (existing.gymId !== gymId) throw new ConflictException('El identificador local ya está en uso');
        return existing;
      }
    }
    return this.prisma.plan.create({ data: { ...(clientId ? { id: clientId } : {}), ...data, gymId } });
  }

  listPlans(user: AuthUser) {
    return this.prisma.plan.findMany({ where: { gymId: this.gymId(user) }, orderBy: [{ isActive: 'desc' }, { price: 'asc' }] });
  }

  async updatePlan(id: string, dto: UpdatePlanDto, user: AuthUser) {
    const plan = await this.prisma.plan.findFirst({ where: { id, gymId: this.gymId(user) } });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    return this.prisma.plan.update({ where: { id }, data: dto });
  }

  listMemberships(user: AuthUser, memberId?: string) {
    return this.prisma.membership.findMany({ where: { ...(memberId ? { memberId } : {}), member: { gymId: this.gymId(user) } }, include: membershipInclude, orderBy: { createdAt: 'desc' } });
  }

  async createMembership(dto: CreateMembershipDto, user: AuthUser) {
    return this.assignMembership(dto, user);
  }

  async renewMembership(id: string, dto: RenewMembershipDto, user: AuthUser) {
    const gymId = this.gymId(user);
    const current = await this.prisma.membership.findFirst({ where: { id, member: { gymId } } });
    if (!current) throw new NotFoundException('Membresía no encontrada');
    const startDate = current.endDate > new Date() ? current.endDate : new Date();
    return this.assignMembership({ memberId: current.memberId, planId: dto.planId ?? current.planId, startDate: startDate.toISOString(), initialPayment: dto.initialPayment, paymentMethod: dto.paymentMethod, reference: dto.reference, clientMembershipId: dto.clientMembershipId, clientPaymentId: dto.clientPaymentId, clientMutationId: dto.clientMutationId, occurredAt: dto.occurredAt }, user);
  }

  private async assignMembership(dto: CreateMembershipDto, user: AuthUser) {
    const gymId = this.gymId(user);
    if (dto.clientMutationId) {
      const repeated = await this.prisma.membership.findUnique({ where: { clientMutationId: dto.clientMutationId }, include: membershipInclude });
      if (repeated) {
        if (repeated.member.gymId !== gymId) throw new ConflictException('La operación pertenece a otro gimnasio');
        return repeated;
      }
    }
    const [member, plan] = await Promise.all([
      this.prisma.member.findFirst({ where: { id: dto.memberId, gymId, status: 'ACTIVE' } }),
      this.prisma.plan.findFirst({ where: { id: dto.planId, gymId, isActive: true } }),
    ]);
    if (!member) throw new NotFoundException('Miembro activo no encontrado');
    if (!plan) throw new NotFoundException('Plan activo no encontrado');
    const total = Number(plan.price);
    const initial = dto.initialPayment ?? 0;
    if (initial > total) throw new BadRequestException('El abono inicial supera el precio del plan');
    if (initial > 0 && !dto.paymentMethod) throw new BadRequestException('Indica el método del abono inicial');
    const now = new Date();
    const startDate = dto.startDate ? new Date(dto.startDate) : now;
    const status = startDate > now ? MembershipStatus.SCHEDULED : MembershipStatus.ACTIVE;
    const endDate = new Date(startDate); endDate.setDate(endDate.getDate() + plan.durationDays);

    return this.prisma.$transaction(async (tx) => {
      await tx.membership.updateMany({ where: { memberId: member.id, status: MembershipStatus.ACTIVE, endDate: { lt: now } }, data: { status: MembershipStatus.EXPIRED } });
      const collision = await tx.membership.findFirst({ where: { memberId: member.id, status, ...(status === MembershipStatus.ACTIVE ? { endDate: { gte: now } } : {}) } });
      if (collision) throw new ConflictException(status === MembershipStatus.ACTIVE ? 'El miembro ya tiene una membresía activa' : 'El miembro ya tiene una renovación programada');
      const membership = await tx.membership.create({ data: { id: dto.clientMembershipId, memberId: member.id, planId: plan.id, startDate, endDate, status, clientMutationId: dto.clientMutationId } });
      const paymentStatus = initial === 0 ? PaymentStatus.PENDING : initial >= total ? PaymentStatus.PAID : PaymentStatus.PARTIAL;
      const operationTime = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
      const payment = await tx.payment.create({ data: { id: dto.clientPaymentId, gymId, memberId: member.id, membershipId: membership.id, amount: plan.price, paidAmount: initial, dueDate: startDate, status: paymentStatus, paidAt: paymentStatus === PaymentStatus.PAID ? operationTime : null } });
      if (initial > 0 && dto.paymentMethod) await tx.paymentMovement.create({ data: { paymentId: payment.id, actorUserId: user.id, amount: initial, method: dto.paymentMethod, reference: dto.reference, occurredAt: operationTime, clientMutationId: dto.clientMutationId } });
      return tx.membership.findUniqueOrThrow({ where: { id: membership.id }, include: membershipInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async listPayments(user: AuthUser) {
    const gymId = this.gymId(user);
    await this.prisma.payment.updateMany({ where: { gymId, status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL] }, dueDate: { lt: new Date() } }, data: { status: PaymentStatus.OVERDUE } });
    return this.prisma.payment.findMany({ where: { gymId }, include: { member: true, membership: { include: { plan: true } }, movements: { orderBy: { occurredAt: 'desc' } } }, orderBy: { createdAt: 'desc' } });
  }

  async applyPayment(id: string, dto: ApplyPaymentDto, user: AuthUser) {
    const gymId = this.gymId(user);
    if (dto.clientMutationId) {
      const repeated = await this.prisma.paymentMovement.findUnique({
        where: { clientMutationId: dto.clientMutationId },
        include: { payment: { include: { member: true, membership: { include: { plan: true } }, movements: true } } },
      });
      if (repeated) {
        if (repeated.payment.gymId !== gymId) throw new ConflictException('La operación pertenece a otro gimnasio');
        return repeated.payment;
      }
    }
    const current = await this.prisma.payment.findFirst({ where: { id, gymId } });
    if (!current) throw new NotFoundException('Cobro no encontrado');
    if (current.status === PaymentStatus.CANCELLED) throw new BadRequestException('El cobro está cancelado');
    const balance = Number(current.amount) - Number(current.paidAmount);
    if (dto.amount > balance) throw new BadRequestException(`El abono supera el saldo de ${balance.toFixed(2)}`);
    const paidAmount = Number(current.paidAmount) + dto.amount;
    const status = paidAmount >= Number(current.amount) ? PaymentStatus.PAID : PaymentStatus.PARTIAL;
    const operationTime = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payment.updateMany({ where: { id, paidAmount: current.paidAmount }, data: { paidAmount, status, paidAt: status === PaymentStatus.PAID ? operationTime : null } });
      if (updated.count !== 1) throw new ConflictException('El cobro cambió; vuelve a intentarlo');
      await tx.paymentMovement.create({ data: { paymentId: id, actorUserId: user.id, amount: dto.amount, method: dto.method, reference: dto.reference, occurredAt: operationTime, clientMutationId: dto.clientMutationId } });
      return tx.payment.findUniqueOrThrow({ where: { id }, include: { member: true, membership: { include: { plan: true } }, movements: true } });
    });
  }

  async adminDashboard(user: AuthUser) {
    const gymId = this.gymId(user);
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const [members, activeMemberships, revenue, debtRows, recent] = await Promise.all([
      this.prisma.member.count({ where: { gymId } }),
      this.prisma.membership.count({ where: { status: MembershipStatus.ACTIVE, endDate: { gte: new Date() }, member: { gymId } } }),
      this.prisma.paymentMovement.aggregate({ where: { payment: { gymId }, occurredAt: { gte: start } }, _sum: { amount: true } }),
      this.prisma.payment.findMany({ where: { gymId, status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL, PaymentStatus.OVERDUE] } }, select: { amount: true, paidAmount: true } }),
      this.prisma.paymentMovement.findMany({ where: { payment: { gymId } }, include: { payment: { include: { member: true } } }, orderBy: { occurredAt: 'desc' }, take: 5 }),
    ]);
    return { members, activeMemberships, monthlyRevenue: Number(revenue._sum.amount ?? 0), pendingDebt: Number(debtRows.reduce((sum, row) => sum + Number(row.amount) - Number(row.paidAmount), 0).toFixed(2)), recentPayments: recent };
  }

  private async requireMember(id: string, user: AuthUser) {
    const member = await this.prisma.member.findFirst({ where: { id, gymId: this.gymId(user) } });
    if (!member) throw new NotFoundException('Miembro no encontrado');
    return member;
  }

  private async requireGym(id: string) {
    const gym = await this.prisma.gym.findUnique({ where: { id } });
    if (!gym) throw new NotFoundException('Gimnasio no encontrado');
    return gym;
  }

  findMemberByCi(ci: string, user: AuthUser) {
    return this.prisma.member.findUnique({ where: { gymId_ci: { gymId: this.gymId(user), ci } } });
  }

  findPlanByName(name: string, user: AuthUser) {
    return this.prisma.plan.findUnique({ where: { gymId_name: { gymId: this.gymId(user), name } } });
  }

  private rethrowMemberCiConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('Ya existe un miembro registrado con ese carnet de identidad');
    }
    throw error;
  }

  private isUniqueConflict(error: unknown, field: string): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
    const target = error.meta?.target;
    return Array.isArray(target) ? target.includes(field) : String(target ?? '').includes(field);
  }
}
