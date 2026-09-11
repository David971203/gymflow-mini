import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { GymSubscriptionPlan, Prisma, SubscriptionRequestAction, SubscriptionRequestStatus, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { assertCubanLocation } from '../common/cuba-locations';
import type { CreateGymAdminDto, CreateGymDto, UpdateGymAdminDto, UpdateGymDto } from './platform.dto';
import { PrismaService } from '../database/prisma.service';
import { subscriptionExpiryBoundary, subscriptionIsActiveThroughDay } from '../subscriptions/subscription-time';
import { PLATFORM_SUBSCRIPTION_PRICES } from '../subscriptions/subscription-pricing';

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  async createGym(dto: CreateGymDto) {
    const province = dto.province.trim();
    const municipality = dto.municipality.trim();
    assertCubanLocation(province, municipality);
    const existing = await this.prisma.user.findUnique({ where: { email: dto.adminEmail.toLowerCase() } });
    if (existing) throw new ConflictException('Ese correo ya tiene una cuenta');
    return this.prisma.$transaction(async (tx) => {
      const subscriptionStartedAt = new Date();
      const subscriptionTrialDays = dto.subscriptionTrialDays ?? 7;
      const subscriptionEndsAt = this.subscriptionEnd(subscriptionStartedAt, dto.subscriptionPlan, subscriptionTrialDays);
      const gym = await tx.gym.create({ data: { name: dto.name, slug: dto.slug.toLowerCase(), province, municipality, phone: dto.phone, currency: dto.currency, subscriptionPlan: dto.subscriptionPlan, subscriptionTrialDays, subscriptionStartedAt, subscriptionEndsAt } });
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

  listSubscriptions() {
    return this.prisma.platformSubscription.findMany({ include: { gym: { select: { id: true, name: true, slug: true } } }, orderBy: { activatedAt: 'desc' } });
  }

  async listSubscriptionRequests() {
    const requests = await this.prisma.subscriptionRequest.findMany({
      include: { gym: { select: { id: true, name: true, phone: true, province: true, users: { where: { role: UserRole.ADMIN }, select: { id: true, name: true, email: true, phone: true }, take: 1 } } } },
      orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
    });
    return requests.map(({ deviceHash: _deviceHash, ipHash: _ipHash, ...request }) => request);
  }

  async resolveSubscriptionRequest(id: string, status: 'APPROVED' | 'REJECTED') {
    const request = await this.prisma.subscriptionRequest.findUnique({ where: { id }, include: { gym: true } });
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    if (request.status !== SubscriptionRequestStatus.PENDING) throw new ConflictException('Esta solicitud ya fue resuelta');
    const now = new Date();
    const active = subscriptionIsActiveThroughDay(request.gym.subscriptionEndsAt, now);
    if (request.plan !== GymSubscriptionPlan.TRIAL) {
      if (request.action === SubscriptionRequestAction.ACTIVATE && request.gym.subscriptionPlan) throw new ConflictException('El gimnasio ya tiene una suscripción; crea una nueva solicitud');
      if (request.action !== SubscriptionRequestAction.ACTIVATE && request.fromPlan !== request.gym.subscriptionPlan) throw new ConflictException('El plan actual cambió; crea una nueva solicitud');
      if (request.previousEndsAt?.getTime() !== request.gym.subscriptionEndsAt?.getTime()) throw new ConflictException('La fecha de vencimiento cambió; crea una nueva solicitud');
    }
    const immediateUpgrade = request.action === SubscriptionRequestAction.CHANGE && request.fromPlan === GymSubscriptionPlan.MONTHLY && request.plan === GymSubscriptionPlan.ANNUAL;
    const startsImmediately = request.plan === GymSubscriptionPlan.TRIAL || request.action === SubscriptionRequestAction.ACTIVATE || immediateUpgrade || !active;
    const startedAt = startsImmediately ? now : subscriptionExpiryBoundary(request.gym.subscriptionEndsAt!);
    const endsAt = this.subscriptionEnd(startedAt, request.plan, request.gym.subscriptionTrialDays);
    const scheduledChange = !startsImmediately && request.action === SubscriptionRequestAction.CHANGE;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.subscriptionRequest.updateMany({ where: { id, status: SubscriptionRequestStatus.PENDING }, data: { status, resolvedAt: now } });
        if (claimed.count !== 1) throw new ConflictException('Esta solicitud ya fue resuelta');
        if (status === SubscriptionRequestStatus.REJECTED) return tx.subscriptionRequest.findUniqueOrThrow({ where: { id }, include: { gym: true } });
        if (request.plan === GymSubscriptionPlan.TRIAL) {
          if (!request.verificationPhone || !request.deviceHash) throw new ConflictException('La solicitud de prueba no contiene los datos de verificación');
          if (request.gym.subscriptionPlan) throw new ConflictException('Este gimnasio ya utilizó o tiene una suscripción');
          await tx.trialClaim.create({ data: { gymId: request.gymId, phone: request.verificationPhone, deviceHash: request.deviceHash } });
          await tx.user.updateMany({ where: { gymId: request.gymId, role: UserRole.ADMIN, phone: request.verificationPhone }, data: { phoneVerifiedAt: now } });
        }
        if (scheduledChange) await tx.gym.update({ where: { id: request.gymId }, data: { scheduledSubscriptionPlan: request.plan, scheduledSubscriptionStartsAt: startedAt, scheduledSubscriptionEndsAt: endsAt } });
        else if (request.action === SubscriptionRequestAction.RENEW && active) await tx.gym.update({ where: { id: request.gymId }, data: { subscriptionEndsAt: endsAt, subscriptionWarningSentFor: null, subscriptionExpiredSentFor: null } });
        else await tx.gym.update({ where: { id: request.gymId }, data: { subscriptionPlan: request.plan, subscriptionStartedAt: startedAt, subscriptionEndsAt: endsAt, subscriptionWarningSentFor: null, subscriptionExpiredSentFor: null } });
        await tx.platformSubscription.create({ data: { gymId: request.gymId, plan: request.plan, amount: PLATFORM_SUBSCRIPTION_PRICES[request.plan], startedAt, endsAt } });
        return tx.subscriptionRequest.findUniqueOrThrow({ where: { id }, include: { gym: true } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && request.plan === GymSubscriptionPlan.TRIAL) throw new ConflictException('La prueba gratuita ya fue utilizada con este teléfono o dispositivo');
      throw error;
    }
  }

  async getGym(id: string) {
    const gym = await this.prisma.gym.findUnique({ where: { id }, include: { _count: { select: { members: true, plans: true, payments: true } }, users: { where: { role: UserRole.ADMIN }, select: { id: true, email: true, name: true, isActive: true, createdAt: true }, orderBy: { createdAt: 'asc' } } } });
    if (!gym) throw new NotFoundException('Gimnasio no encontrado');
    return gym;
  }

  async updateGym(id: string, dto: UpdateGymDto) {
    const current = await this.requireGym(id);
    const province = (dto.province ?? current.province)?.trim();
    const municipality = (dto.municipality ?? current.municipality)?.trim();
    if (!province || !municipality) throw new BadRequestException('Selecciona la provincia y el municipio del gimnasio');
    assertCubanLocation(province, municipality);
    try {
      return await this.prisma.gym.update({ where: { id }, data: { ...dto, province, municipality, ...(dto.slug ? { slug: dto.slug.toLowerCase() } : {}) } });
    } catch (error) {
      if (this.isUniqueConflict(error, 'slug')) throw new ConflictException('Ese identificador de gimnasio ya está en uso');
      throw error;
    }
  }

  updateGymStatus(id: string, isActive: boolean) { return this.prisma.gym.update({ where: { id }, data: { isActive } }); }

  async renewGymSubscription(id: string, plan: GymSubscriptionPlan, requestedTrialDays?: number) {
    const gym = await this.requireGym(id);
    const now = new Date();
    const startedAt = subscriptionIsActiveThroughDay(gym.subscriptionEndsAt, now) ? gym.subscriptionEndsAt! : now;
    const trialDays = requestedTrialDays ?? gym.subscriptionTrialDays ?? 7;
    const endsAt = this.subscriptionEnd(startedAt, plan, trialDays);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.gym.update({ where: { id }, data: { subscriptionPlan: plan, subscriptionTrialDays: trialDays, subscriptionStartedAt: startedAt, subscriptionEndsAt: endsAt, scheduledSubscriptionPlan: null, scheduledSubscriptionStartsAt: null, scheduledSubscriptionEndsAt: null } });
      await tx.platformSubscription.create({ data: { gymId: id, plan, amount: PLATFORM_SUBSCRIPTION_PRICES[plan], startedAt, endsAt } });
      return updated;
    });
  }

  async removeGymSubscription(id: string) {
    await this.requireGym(id);
    return this.prisma.gym.update({ where: { id }, data: { subscriptionPlan: null, subscriptionStartedAt: null, subscriptionEndsAt: null, scheduledSubscriptionPlan: null, scheduledSubscriptionStartsAt: null, scheduledSubscriptionEndsAt: null } });
  }

  async listGymAdmins(gymId: string) {
    await this.requireGym(gymId);
    return this.prisma.user.findMany({ where: { gymId, role: UserRole.ADMIN }, select: { id: true, email: true, name: true, isActive: true, createdAt: true }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  }

  async createGymAdmin(gymId: string, dto: CreateGymAdminDto) {
    await this.requireGym(gymId);
    try {
      return await this.prisma.user.create({ data: { gymId, role: UserRole.ADMIN, name: dto.name, email: dto.email.toLowerCase(), passwordHash: await argon2.hash(dto.password), isActive: dto.isActive ?? true }, select: { id: true, email: true, name: true, isActive: true, createdAt: true } });
    } catch (error) { if (this.isUniqueConflict(error, 'email')) throw new ConflictException('Ese correo ya tiene una cuenta'); throw error; }
  }

  async updateGymAdmin(gymId: string, id: string, dto: UpdateGymAdminDto) {
    const admin = await this.prisma.user.findFirst({ where: { id, gymId, role: UserRole.ADMIN } });
    if (!admin) throw new NotFoundException('Administrador no encontrado');
    const { password, email, ...fields } = dto;
    try {
      return await this.prisma.user.update({ where: { id }, data: { ...fields, ...(email ? { email: email.toLowerCase() } : {}), ...(password ? { passwordHash: await argon2.hash(password) } : {}) }, select: { id: true, email: true, name: true, isActive: true, createdAt: true } });
    } catch (error) { if (this.isUniqueConflict(error, 'email')) throw new ConflictException('Ese correo ya tiene una cuenta'); throw error; }
  }

  async deleteGymAdmin(gymId: string, id: string) {
    const admin = await this.prisma.user.findFirst({ where: { id, gymId, role: UserRole.ADMIN } });
    if (!admin) throw new NotFoundException('Administrador no encontrado');
    if (admin.isActive) {
      const others = await this.prisma.user.count({ where: { gymId, role: UserRole.ADMIN, isActive: true, id: { not: id } } });
      if (others === 0) throw new ConflictException('No se puede eliminar el único administrador activo del gimnasio');
    }
    const movements = await this.prisma.paymentMovement.count({ where: { actorUserId: id } });
    if (movements > 0) { await this.prisma.user.update({ where: { id }, data: { isActive: false } }); return { id, disposition: 'ARCHIVED' as const }; }
    await this.prisma.user.delete({ where: { id } });
    return { id, disposition: 'DELETED' as const };
  }

  async listGymStaff(gymId: string) {
    await this.requireGym(gymId);
    return this.prisma.user.findMany({ where: { gymId, role: { in: [UserRole.ADMIN, UserRole.RECEPTIONIST] } }, select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true }, orderBy: [{ role: 'asc' }, { isActive: 'desc' }, { name: 'asc' }] });
  }

  private subscriptionEnd(start: Date, plan: GymSubscriptionPlan, trialDays = 7) {
    const end = new Date(start);
    if (plan === GymSubscriptionPlan.TRIAL) end.setDate(end.getDate() + trialDays);
    else if (plan === GymSubscriptionPlan.MONTHLY) end.setMonth(end.getMonth() + 1);
    else end.setFullYear(end.getFullYear() + 1);
    return end;
  }

  private async requireGym(id: string) {
    const gym = await this.prisma.gym.findUnique({ where: { id } });
    if (!gym) throw new NotFoundException('Gimnasio no encontrado');
    return gym;
  }

  private isUniqueConflict(error: unknown, field: string) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
    const target = error.meta?.target;
    return Array.isArray(target) ? target.includes(field) : String(target ?? '').includes(field);
  }
}
