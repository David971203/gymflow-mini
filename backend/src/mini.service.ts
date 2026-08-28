import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { GymSubscriptionPlan, MembershipStatus, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from './prisma.service';
import type { AuthUser } from './common';
import { ApplyPaymentDto, AssignGymMembershipDto, CreateGymAdminDto, CreateGymDto, CreateMemberDto, CreateMembershipDto, CreatePlanDto, RenewMembershipDto, UpdateGymAdminDto, UpdateGymDto, UpdateGymMembershipDto, UpdateMemberDto, UpdatePlanDto } from './mini.dto';

const membershipInclude = {
  member: { select: { id: true, gymId: true, ci: true, firstName: true, lastName: true, phone: true } },
  plan: true,
  payment: { include: { movements: { orderBy: { occurredAt: 'desc' as const } } } },
} satisfies Prisma.MembershipInclude;

const PLATFORM_SUBSCRIPTION_PRICES: Record<GymSubscriptionPlan, number> = {
  [GymSubscriptionPlan.TRIAL]: 0,
  [GymSubscriptionPlan.MONTHLY]: 5000,
  [GymSubscriptionPlan.ANNUAL]: 50000,
};

@Injectable()
export class MiniService {
  constructor(private readonly prisma: PrismaService) {}

  private gymId(user: AuthUser): string {
    if (user.role !== UserRole.ADMIN || !user.gymId) throw new BadRequestException('Se requiere un administrador de gimnasio');
    return user.gymId;
  }

  private subscriptionEnd(start: Date, plan: GymSubscriptionPlan, trialDays = 7) {
    const end = new Date(start);
    if (plan === GymSubscriptionPlan.TRIAL) end.setDate(end.getDate() + trialDays);
    else if (plan === GymSubscriptionPlan.MONTHLY) end.setMonth(end.getMonth() + 1);
    else end.setFullYear(end.getFullYear() + 1);
    return end;
  }

  async createGym(dto: CreateGymDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.adminEmail.toLowerCase() } });
    if (existing) throw new ConflictException('Ese correo ya tiene una cuenta');
    return this.prisma.$transaction(async (tx) => {
      const subscriptionStartedAt = new Date();
      const subscriptionTrialDays = dto.subscriptionTrialDays ?? 7;
      const subscriptionEndsAt = this.subscriptionEnd(subscriptionStartedAt, dto.subscriptionPlan, subscriptionTrialDays);
      const gym = await tx.gym.create({ data: { name: dto.name, slug: dto.slug.toLowerCase(), province: dto.province, phone: dto.phone, currency: dto.currency, subscriptionPlan: dto.subscriptionPlan, subscriptionTrialDays, subscriptionStartedAt, subscriptionEndsAt } });
      await tx.platformSubscription.create({ data: { gymId: gym.id, plan: dto.subscriptionPlan, amount: PLATFORM_SUBSCRIPTION_PRICES[dto.subscriptionPlan], startedAt: subscriptionStartedAt, endsAt: subscriptionEndsAt } });
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

  async renewGymSubscription(id: string, subscriptionPlan: GymSubscriptionPlan, requestedTrialDays?: number) {
    const gym = await this.requireGym(id);
    const now = new Date();
    const subscriptionStartedAt = gym.subscriptionEndsAt > now ? gym.subscriptionEndsAt : now;
    const subscriptionTrialDays = requestedTrialDays ?? gym.subscriptionTrialDays ?? 7;
    const subscriptionEndsAt = this.subscriptionEnd(subscriptionStartedAt, subscriptionPlan, subscriptionTrialDays);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.gym.update({ where: { id }, data: { subscriptionPlan, subscriptionTrialDays, subscriptionStartedAt, subscriptionEndsAt } });
      await tx.platformSubscription.create({ data: { gymId: id, plan: subscriptionPlan, amount: PLATFORM_SUBSCRIPTION_PRICES[subscriptionPlan], startedAt: subscriptionStartedAt, endsAt: subscriptionEndsAt } });
      return updated;
    });
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

  async deleteGymAdmin(gymId: string, id: string) {
    const admin = await this.prisma.user.findFirst({ where: { id, gymId, role: UserRole.ADMIN } });
    if (!admin) throw new NotFoundException('Administrador no encontrado');
    if (admin.isActive) {
      const otherActiveAdmins = await this.prisma.user.count({ where: { gymId, role: UserRole.ADMIN, isActive: true, id: { not: id } } });
      if (otherActiveAdmins === 0) throw new ConflictException('No se puede eliminar el único administrador activo del gimnasio');
    }
    const movements = await this.prisma.paymentMovement.count({ where: { actorUserId: id } });
    if (movements > 0) {
      await this.prisma.user.update({ where: { id }, data: { isActive: false } });
      return { id, disposition: 'ARCHIVED' };
    }
    await this.prisma.user.delete({ where: { id } });
    return { id, disposition: 'DELETED' };
  }

  async listGymMembers(gymId: string, search?: string) {
    await this.requireGym(gymId);
    return this.prisma.member.findMany({
      where: { gymId, ...(search ? { OR: [{ code: { contains: search, mode: 'insensitive' } }, { ci: { contains: search } }, { firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] } : {}) },
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

  async deleteGymMember(gymId: string, id: string) {
    const member = await this.prisma.member.findFirst({ where: { id, gymId } });
    if (!member) throw new NotFoundException('Miembro no encontrado');
    const [memberships, payments] = await Promise.all([
      this.prisma.membership.count({ where: { memberId: id } }),
      this.prisma.payment.count({ where: { memberId: id, gymId } }),
    ]);
    if (memberships > 0 || payments > 0) {
      await this.prisma.member.update({ where: { id }, data: { status: 'INACTIVE' } });
      return { id, disposition: 'ARCHIVED' };
    }
    await this.prisma.member.delete({ where: { id } });
    return { id, disposition: 'DELETED' };
  }

  deleteMember(id: string, user: AuthUser) {
    return this.deleteGymMember(this.gymId(user), id);
  }

  async listGymPlans(gymId: string) {
    await this.requireGym(gymId);
    return this.prisma.plan.findMany({ where: { gymId }, orderBy: [{ isActive: 'desc' }, { price: 'asc' }] });
  }

  async createGymPlan(gymId: string, dto: CreatePlanDto) {
    await this.requireGym(gymId);
    return this.createPlanForGym(gymId, dto);
  }

  async updateGymPlan(gymId: string, id: string, dto: UpdatePlanDto) {
    await this.requireGym(gymId);
    return this.updatePlanForGym(gymId, id, dto);
  }

  async deleteGymPlan(gymId: string, id: string) {
    await this.requireGym(gymId);
    const plan = await this.prisma.plan.findFirst({ where: { id, gymId } });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    const activeMembership = await this.prisma.membership.findFirst({ where: { planId: id, status: MembershipStatus.ACTIVE, endDate: { gte: new Date() }, member: { gymId } } });
    if (activeMembership) throw new ConflictException('No se puede eliminar un plan con membresías activas');
    const memberships = await this.prisma.membership.count({ where: { planId: id, member: { gymId } } });
    if (memberships > 0) {
      await this.prisma.plan.update({ where: { id }, data: { isActive: false } });
      return { id, disposition: 'ARCHIVED' };
    }
    await this.prisma.plan.delete({ where: { id } });
    return { id, disposition: 'DELETED' };
  }

  async createGymMembership(gymId: string, memberId: string, dto: AssignGymMembershipDto, user: AuthUser) {
    await this.requireGym(gymId);
    const active = await this.prisma.membership.findFirst({ where: { memberId, member: { gymId }, status: MembershipStatus.ACTIVE, endDate: { gte: new Date() } } });
    if (active) throw new ConflictException('El miembro ya tiene una membresía activa');
    return this.assignMembershipForGym({ ...dto, memberId }, gymId, user);
  }

  async listGymMemberships(gymId: string, memberId: string) {
    await this.requireGym(gymId);
    const member = await this.prisma.member.findFirst({ where: { id: memberId, gymId } });
    if (!member) throw new NotFoundException('Miembro no encontrado');
    return this.prisma.membership.findMany({ where: { memberId }, include: membershipInclude, orderBy: { createdAt: 'desc' } });
  }

  async updateGymMembership(gymId: string, memberId: string, id: string, dto: UpdateGymMembershipDto) {
    await this.requireGym(gymId);
    const current = await this.prisma.membership.findFirst({ where: { id, memberId, member: { gymId } }, include: { member: true, payment: { include: { movements: true } } } });
    if (!current) throw new NotFoundException('Membresía no encontrada');
    const planId = dto.planId ?? current.planId;
    const plan = await this.prisma.plan.findFirst({ where: { id: planId, gymId, ...(planId !== current.planId ? { isActive: true } : {}) } });
    if (!plan) throw new NotFoundException('Plan no encontrado o inactivo');
    const startDate = dto.startDate ? new Date(dto.startDate) : current.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : dto.planId && dto.planId !== current.planId ? new Date(startDate.getTime() + plan.durationDays * 86400000) : current.endDate;
    if (endDate <= startDate) throw new BadRequestException('La fecha final debe ser posterior a la fecha inicial');
    const status = dto.status ?? current.status;
    if (status === MembershipStatus.ACTIVE) {
      if (current.member.status !== 'ACTIVE') throw new BadRequestException('El miembro debe estar activo');
      const collision = await this.prisma.membership.findFirst({ where: { id: { not: id }, memberId, status: MembershipStatus.ACTIVE, endDate: { gte: new Date() } } });
      if (collision) throw new ConflictException('El miembro ya tiene otra membresía activa');
    }
    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.membership.update({ where: { id }, data: { planId, startDate, endDate, status } });
      if (current.payment) {
        const amount = planId !== current.planId ? Number(plan.price) : Number(current.payment.amount);
        const paidAmount = Number(current.payment.paidAmount);
        if (paidAmount > amount) throw new BadRequestException('El importe abonado supera el precio del nuevo plan');
        const paymentStatus = status === MembershipStatus.CANCELLED ? PaymentStatus.CANCELLED : paidAmount === 0 ? PaymentStatus.PENDING : paidAmount >= amount ? PaymentStatus.PAID : PaymentStatus.PARTIAL;
        await tx.payment.update({ where: { id: current.payment.id }, data: { amount, dueDate: startDate, status: paymentStatus, paidAt: paymentStatus === PaymentStatus.PAID ? current.payment.paidAt ?? new Date() : null } });
      }
      return tx.membership.findUniqueOrThrow({ where: { id: membership.id }, include: membershipInclude });
    });
  }

  async deleteGymMembership(gymId: string, memberId: string, id: string) {
    await this.requireGym(gymId);
    const membership = await this.prisma.membership.findFirst({ where: { id, memberId, member: { gymId } }, include: { payment: { include: { movements: true } } } });
    if (!membership) throw new NotFoundException('Membresía no encontrada');
    const hasFinancialHistory = membership.payment && (Number(membership.payment.paidAmount) > 0 || membership.payment.movements.length > 0);
    if (hasFinancialHistory) {
      await this.prisma.$transaction([
        this.prisma.membership.update({ where: { id }, data: { status: MembershipStatus.CANCELLED } }),
        this.prisma.payment.update({ where: { id: membership.payment!.id }, data: { status: PaymentStatus.CANCELLED } }),
      ]);
      return { id, disposition: 'ARCHIVED' };
    }
    await this.prisma.$transaction(async (tx) => {
      if (membership.payment) await tx.payment.delete({ where: { id: membership.payment.id } });
      await tx.membership.delete({ where: { id } });
    });
    return { id, disposition: 'DELETED' };
  }

  async listGymPayments(gymId: string) {
    await this.requireGym(gymId);
    return this.listPaymentsForGym(gymId);
  }

  async applyGymPayment(gymId: string, id: string, dto: ApplyPaymentDto, user: AuthUser) {
    await this.requireGym(gymId);
    return this.applyPaymentForGym(id, dto, gymId, user);
  }

  async getGymFinances(gymId: string) {
    await this.requireGym(gymId);
    await this.prisma.payment.updateMany({ where: { gymId, status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL] }, dueDate: { lt: new Date() } }, data: { status: PaymentStatus.OVERDUE } });
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const [payments, monthlyRevenue, recentMovements] = await Promise.all([
      this.prisma.payment.findMany({ where: { gymId }, select: { amount: true, paidAmount: true, status: true } }),
      this.prisma.paymentMovement.aggregate({ where: { payment: { gymId }, occurredAt: { gte: monthStart } }, _sum: { amount: true } }),
      this.prisma.paymentMovement.findMany({
        where: { payment: { gymId } },
        include: { payment: { include: { member: true, membership: { include: { plan: true } } } }, actor: { select: { id: true, name: true } } },
        orderBy: { occurredAt: 'desc' },
        take: 20,
      }),
    ]);
    const totalBilled = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const totalCollected = payments.reduce((sum, payment) => sum + Number(payment.paidAmount), 0);
    const pendingBalance = payments.reduce((sum, payment) => payment.status === PaymentStatus.CANCELLED ? sum : sum + Math.max(0, Number(payment.amount) - Number(payment.paidAmount)), 0);
    const overdueBalance = payments.reduce((sum, payment) => payment.status === PaymentStatus.OVERDUE ? sum + Math.max(0, Number(payment.amount) - Number(payment.paidAmount)) : sum, 0);
    return {
      totalBilled: Number(totalBilled.toFixed(2)),
      totalCollected: Number(totalCollected.toFixed(2)),
      pendingBalance: Number(pendingBalance.toFixed(2)),
      overdueBalance: Number(overdueBalance.toFixed(2)),
      monthlyRevenue: Number(monthlyRevenue._sum.amount ?? 0),
      pendingPayments: payments.filter(payment => payment.status === PaymentStatus.PENDING || payment.status === PaymentStatus.PARTIAL || payment.status === PaymentStatus.OVERDUE).length,
      recentMovements,
    };
  }

  async platformOverview() {
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const nextMonth = new Date(start); nextMonth.setMonth(nextMonth.getMonth() + 1);
    const now = new Date();
    const trendMonths = Array.from({ length: 6 }, (_, index) => {
      const monthStart = new Date(start); monthStart.setMonth(monthStart.getMonth() - (5 - index));
      const monthEnd = new Date(monthStart); monthEnd.setMonth(monthEnd.getMonth() + 1);
      return { monthStart, monthEnd };
    });
    const activeSubscriptionWhere = { isActive: true, subscriptionEndsAt: { gt: now } } satisfies Prisma.GymWhereInput;
    const [gyms, activeGyms, members, newMembers, revenue, debtRows, subscriptionMonthlyRevenue, subscriptionTotalRevenue, activeTrialSubscriptions, activeMonthlySubscriptions, activeAnnualSubscriptions, expiredSubscriptions, ...memberTrendCounts] = await Promise.all([
      this.prisma.gym.count(),
      this.prisma.gym.count({ where: { isActive: true } }),
      this.prisma.member.count({ where: { status: 'ACTIVE' } }),
      this.prisma.member.count({ where: { joinedAt: { gte: start, lt: nextMonth } } }),
      this.prisma.paymentMovement.aggregate({ where: { occurredAt: { gte: start, lt: nextMonth } }, _sum: { amount: true } }),
      this.prisma.payment.findMany({ where: { status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL, PaymentStatus.OVERDUE] } }, select: { amount: true, paidAmount: true } }),
      this.prisma.platformSubscription.aggregate({ where: { activatedAt: { gte: start, lt: nextMonth } }, _sum: { amount: true } }),
      this.prisma.platformSubscription.aggregate({ _sum: { amount: true } }),
      this.prisma.gym.count({ where: { ...activeSubscriptionWhere, subscriptionPlan: GymSubscriptionPlan.TRIAL } }),
      this.prisma.gym.count({ where: { ...activeSubscriptionWhere, subscriptionPlan: GymSubscriptionPlan.MONTHLY } }),
      this.prisma.gym.count({ where: { ...activeSubscriptionWhere, subscriptionPlan: GymSubscriptionPlan.ANNUAL } }),
      this.prisma.gym.count({ where: { subscriptionEndsAt: { lte: now } } }),
      ...trendMonths.map(({ monthStart, monthEnd }) => this.prisma.member.count({ where: { joinedAt: { gte: monthStart, lt: monthEnd } } })),
    ]);
    const debt = debtRows.reduce((sum, row) => sum + Number(row.amount) - Number(row.paidAmount), 0);
    const memberTrend = trendMonths.map(({ monthStart }, index) => ({ month: monthStart.toISOString().slice(0, 7), members: memberTrendCounts[index] }));
    return {
      gyms, activeGyms, members, newMembers,
      monthlyRevenue: Number(revenue._sum.amount ?? 0),
      pendingDebt: Number(debt.toFixed(2)),
      memberTrend,
      subscriptionMonthlyRevenue: Number(subscriptionMonthlyRevenue._sum.amount ?? 0),
      subscriptionTotalRevenue: Number(subscriptionTotalRevenue._sum.amount ?? 0),
      activeTrialSubscriptions,
      activeMonthlySubscriptions,
      activeAnnualSubscriptions,
      expiredSubscriptions,
    };
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
      where: { gymId, ...(search ? { OR: [{ code: { contains: search, mode: 'insensitive' } }, { ci: { contains: search } }, { firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] } : {}) },
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
    return this.createPlanForGym(gymId, dto);
  }

  private async createPlanForGym(gymId: string, dto: CreatePlanDto) {
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

  listPlans(user: AuthUser) {
    return this.prisma.plan.findMany({ where: { gymId: this.gymId(user) }, orderBy: [{ isActive: 'desc' }, { price: 'asc' }] });
  }

  async updatePlan(id: string, dto: UpdatePlanDto, user: AuthUser) {
    return this.updatePlanForGym(this.gymId(user), id, dto);
  }

  deletePlan(id: string, user: AuthUser) {
    return this.deleteGymPlan(this.gymId(user), id);
  }

  private async updatePlanForGym(gymId: string, id: string, dto: UpdatePlanDto) {
    const plan = await this.prisma.plan.findFirst({ where: { id, gymId } });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    try {
      return await this.prisma.plan.update({ where: { id }, data: dto });
    } catch (error) {
      if (this.isUniqueConflict(error, 'name')) throw new ConflictException('Ya existe un plan con ese nombre en el gimnasio');
      throw error;
    }
  }

  listMemberships(user: AuthUser, memberId?: string) {
    return this.prisma.membership.findMany({ where: { ...(memberId ? { memberId } : {}), member: { gymId: this.gymId(user) } }, include: membershipInclude, orderBy: { createdAt: 'desc' } });
  }

  async createMembership(dto: CreateMembershipDto, user: AuthUser) {
    return this.assignMembership(dto, user);
  }

  async updateMembership(id: string, dto: UpdateGymMembershipDto, user: AuthUser) {
    const gymId = this.gymId(user);
    const membership = await this.prisma.membership.findFirst({ where: { id, member: { gymId } }, select: { memberId: true } });
    if (!membership) throw new NotFoundException('Membresía no encontrada');
    return this.updateGymMembership(gymId, membership.memberId, id, dto);
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
    return this.assignMembershipForGym(dto, gymId, user);
  }

  private async assignMembershipForGym(dto: CreateMembershipDto, gymId: string, user: AuthUser) {
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
    return this.listPaymentsForGym(gymId);
  }

  private async listPaymentsForGym(gymId: string) {
    await this.prisma.payment.updateMany({ where: { gymId, status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL] }, dueDate: { lt: new Date() } }, data: { status: PaymentStatus.OVERDUE } });
    return this.prisma.payment.findMany({ where: { gymId }, include: { member: true, membership: { include: { plan: true } }, movements: { orderBy: { occurredAt: 'desc' } } }, orderBy: { createdAt: 'desc' } });
  }

  async applyPayment(id: string, dto: ApplyPaymentDto, user: AuthUser) {
    const gymId = this.gymId(user);
    return this.applyPaymentForGym(id, dto, gymId, user);
  }

  private async applyPaymentForGym(id: string, dto: ApplyPaymentDto, gymId: string, user: AuthUser) {
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
    const nextMonth = new Date(start); nextMonth.setMonth(nextMonth.getMonth() + 1);
    const [members, activeMemberships, revenue, debtRows, recent] = await Promise.all([
      this.prisma.member.count({ where: { gymId } }),
      this.prisma.membership.count({ where: { status: MembershipStatus.ACTIVE, endDate: { gte: new Date() }, member: { gymId } } }),
      this.prisma.paymentMovement.aggregate({ where: { payment: { gymId }, occurredAt: { gte: start, lt: nextMonth } }, _sum: { amount: true } }),
      this.prisma.payment.findMany({ where: { gymId, status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL, PaymentStatus.OVERDUE] } }, select: { amount: true, paidAmount: true } }),
      this.prisma.paymentMovement.findMany({ where: { payment: { gymId }, occurredAt: { gte: start, lt: nextMonth } }, include: { payment: { include: { member: true } } }, orderBy: { occurredAt: 'desc' }, take: 5 }),
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
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : String(error.meta?.target ?? '');
      if (target.includes('code')) throw new ConflictException('Ya existe un miembro con ese código interno en el gimnasio');
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
