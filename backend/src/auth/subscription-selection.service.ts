import { ConflictException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { GymSubscriptionPlan, SubscriptionRequestAction, SubscriptionRequestStatus } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import type { SelectSubscriptionDto } from './auth.dto';
import type { AuthUser } from '../common/auth-context';
import { PrismaService } from '../database/prisma.service';
import { subscriptionIsActiveThroughDay, subscriptionWarningStart } from '../subscriptions/subscription-time';
import { SubscriptionScheduleService } from '../subscriptions/subscription-schedule.service';

const WINDOW_MS = 24 * 60 * 60_000;
const COOLDOWN_MS = 60_000;
const IDENTITY_LIMIT = 5;
const IP_LIMIT = 20;

@Injectable()
export class SubscriptionSelectionService {
  constructor(private readonly prisma: PrismaService, private readonly schedule?: SubscriptionScheduleService) {}

  async select(user: AuthUser, dto: SelectSubscriptionDto, requestIp: string | undefined, profile: (userId: string) => Promise<unknown>) {
    if (!user.gymId) throw new ConflictException('La cuenta no pertenece a un gimnasio');
    await this.schedule?.activateDue(user.gymId);
    const owner = await this.prisma.user.findUnique({ where: { id: user.id }, select: { phone: true } });
    if (!owner?.phone) throw new ConflictException('La cuenta no tiene un teléfono móvil registrado');
    if (dto.plan === GymSubscriptionPlan.TRIAL) return this.selectTrial({ ...user, gymId: user.gymId }, dto, requestIp, owner.phone, profile);
    const now = new Date();
    const gym = await this.prisma.gym.findUnique({ where:{ id:user.gymId }, select:{ subscriptionPlan:true, subscriptionEndsAt:true, scheduledSubscriptionPlan:true } });
    if (!gym) throw new ConflictException('El gimnasio no existe');
    this.assertAction(gym, dto, now);
    const existing = await this.prisma.subscriptionRequest.findFirst({ where: { gymId: user.gymId, plan: dto.plan, action: dto.action, status: SubscriptionRequestStatus.PENDING }, orderBy: { requestedAt: 'desc' } });
    if (existing) return { user: await profile(user.id), request: this.publicRequest(existing) };
    const request = await this.prisma.$transaction(async tx => {
      await tx.subscriptionRequest.updateMany({ where: { gymId: user.gymId!, status: SubscriptionRequestStatus.PENDING }, data: { status: SubscriptionRequestStatus.CANCELLED, resolvedAt: now } });
      return tx.subscriptionRequest.create({ data: { code: `GF-${randomBytes(3).toString('hex').toUpperCase()}`, gymId: user.gymId!, plan: dto.plan, action:dto.action, fromPlan:gym.subscriptionPlan, previousEndsAt:gym.subscriptionEndsAt } });
    });
    return { user: await profile(user.id), request: this.publicRequest(request) };
  }

  publicRequest(request: { id:string; code:string; plan:GymSubscriptionPlan; action:SubscriptionRequestAction; fromPlan:GymSubscriptionPlan | null; status:SubscriptionRequestStatus; requestedAt:Date; resolvedAt:Date | null } | null | undefined) {
    if (!request) return null;
    return { id:request.id, code:request.code, plan:request.plan, action:request.action, fromPlan:request.fromPlan, status:request.status, requestedAt:request.requestedAt, resolvedAt:request.resolvedAt };
  }

  private async selectTrial(user: AuthUser & { gymId: string }, dto: SelectSubscriptionDto, requestIp: string | undefined, phone: string, profile: (userId:string)=>Promise<unknown>) {
    if (dto.action !== SubscriptionRequestAction.ACTIVATE) throw new ConflictException('La prueba solo puede solicitarse como activación inicial');
    const now = new Date(); const deviceHash = this.deviceHash(dto.deviceId); const ipHash = requestIp?.trim() ? this.ipHash(requestIp.trim()) : null;
    if (await this.prisma.trialClaim.findFirst({ where: { OR: [{ phone }, { deviceHash }] }, select: { id: true } })) throw new ConflictException('La prueba gratuita ya fue utilizada con este teléfono o dispositivo');
    const pending = await this.prisma.subscriptionRequest.findFirst({ where: { gymId: user.gymId, plan: GymSubscriptionPlan.TRIAL, status: SubscriptionRequestStatus.PENDING }, orderBy: { requestedAt: 'desc' } });
    if (pending) {
      const elapsed = now.getTime() - pending.lastRequestedAt.getTime();
      if (elapsed < COOLDOWN_MS) throw new HttpException(`Espera ${Math.ceil((COOLDOWN_MS - elapsed) / 1000)} segundos antes de reenviar la solicitud por WhatsApp`, HttpStatus.TOO_MANY_REQUESTS);
      if (pending.requestedAt.getTime() >= now.getTime() - WINDOW_MS && pending.resendCount >= IDENTITY_LIMIT - 1) throw new HttpException('Alcanzaste el límite de reenvíos. Intenta nuevamente dentro de 24 horas', HttpStatus.TOO_MANY_REQUESTS);
      const expired = pending.requestedAt.getTime() < now.getTime() - WINDOW_MS;
      const resent = await this.prisma.subscriptionRequest.update({ where: { id: pending.id }, data: expired ? { requestedAt: now, lastRequestedAt: now, resendCount: 0 } : { resendCount: { increment: 1 }, lastRequestedAt: now } });
      return { user: await profile(user.id), request: this.publicRequest(resent) };
    }
    const dayAgo = new Date(now.getTime() - WINDOW_MS);
    const [identityAttempts, ipAttempts] = await Promise.all([
      this.prisma.subscriptionRequest.count({ where: { plan: GymSubscriptionPlan.TRIAL, requestedAt: { gte: dayAgo }, OR: [{ verificationPhone: phone }, { deviceHash }] } }),
      ipHash ? this.prisma.subscriptionRequest.count({ where: { plan: GymSubscriptionPlan.TRIAL, requestedAt: { gte: dayAgo }, ipHash } }) : Promise.resolve(0),
    ]);
    if (identityAttempts >= IDENTITY_LIMIT || ipAttempts >= IP_LIMIT) throw new HttpException('Alcanzaste el límite de solicitudes de prueba. Intenta nuevamente dentro de 24 horas', HttpStatus.TOO_MANY_REQUESTS);
    const request = await this.prisma.$transaction(async tx => {
      const gym = await tx.gym.findUniqueOrThrow({ where: { id: user.gymId } });
      if (gym.subscriptionPlan) throw new ConflictException('Este gimnasio ya utilizó o tiene una suscripción');
      await tx.subscriptionRequest.updateMany({ where: { gymId: user.gymId, status: SubscriptionRequestStatus.PENDING }, data: { status: SubscriptionRequestStatus.CANCELLED, resolvedAt: now } });
      return tx.subscriptionRequest.create({ data: { code: `GF-T-${randomBytes(3).toString('hex').toUpperCase()}`, gymId: user.gymId, plan: GymSubscriptionPlan.TRIAL, action: SubscriptionRequestAction.ACTIVATE, verificationPhone: phone, deviceHash, ipHash, lastRequestedAt: now } });
    });
    return { user: await profile(user.id), request: this.publicRequest(request) };
  }

  private assertAction(gym: { subscriptionPlan:GymSubscriptionPlan|null; subscriptionEndsAt:Date|null; scheduledSubscriptionPlan:GymSubscriptionPlan|null }, dto:SelectSubscriptionDto, now:Date) {
    if (gym.scheduledSubscriptionPlan) throw new ConflictException('Ya existe un cambio de plan programado');
    const current=gym.subscriptionPlan;
    if (!current) { if (dto.action !== SubscriptionRequestAction.ACTIVATE) throw new ConflictException('Debes activar primero una suscripción'); return; }
    if (dto.action === SubscriptionRequestAction.ACTIVATE) throw new ConflictException('Este gimnasio ya tiene una suscripción');
    if (dto.action === SubscriptionRequestAction.RENEW) { if (current===GymSubscriptionPlan.TRIAL || dto.plan!==current) throw new ConflictException('La renovación debe conservar el plan actual'); this.assertWindow(gym.subscriptionEndsAt,now); return; }
    if (dto.action!==SubscriptionRequestAction.CHANGE || dto.plan===current || dto.plan===GymSubscriptionPlan.TRIAL) throw new ConflictException('El cambio de plan solicitado no es válido');
    if (!(current===GymSubscriptionPlan.MONTHLY && dto.plan===GymSubscriptionPlan.ANNUAL) && current!==GymSubscriptionPlan.TRIAL) this.assertWindow(gym.subscriptionEndsAt,now);
  }
  private assertWindow(endsAt:Date|null, now:Date) { if (!subscriptionIsActiveThroughDay(endsAt,now)||!endsAt) return; const available=subscriptionWarningStart(endsAt); if(now<available){const date=new Intl.DateTimeFormat('es-CU',{timeZone:'America/Havana',day:'numeric',month:'long',year:'numeric'}).format(available);throw new ConflictException(`Esta operación estará disponible a partir del ${date}, cuando falten 3 días para el vencimiento`);} }
  private deviceHash(value:string) { return createHash('sha256').update(`gymflow-mini:${process.env.JWT_SECRET ?? 'local'}:${value}`).digest('hex'); }
  private ipHash(value:string) { return createHash('sha256').update(`gymflow-mini:${process.env.JWT_SECRET ?? 'local'}:ip:${value}`).digest('hex'); }
}
