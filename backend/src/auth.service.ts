import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { GymSubscriptionPlan, Prisma, SubscriptionRequestAction, SubscriptionRequestStatus, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService } from './prisma.service';
import { ChangePasswordDto, ForgotPasswordDto, GoogleLoginDto, LoginDto, RegisterDto, ResendEmailVerificationDto, ResetPasswordDto, SelectSubscriptionDto, VerifyEmailDto } from './auth.dto';
import type { AuthUser } from './common';
import { GoogleIdentityService } from './google-identity.service';
import { MailService } from './mail.service';
import { subscriptionIsActiveThroughDay, subscriptionWarningStart } from './subscription-time';
import { SubscriptionScheduleService } from './subscription-schedule.service';
import { assertCubanLocation } from './cuba-locations';

const PLATFORM_SUBSCRIPTION_PRICES: Record<GymSubscriptionPlan, number> = {
  [GymSubscriptionPlan.TRIAL]: 0,
  [GymSubscriptionPlan.MONTHLY]: 5000,
  [GymSubscriptionPlan.ANNUAL]: 50000,
};

const TRIAL_REQUEST_WINDOW_MS = 24 * 60 * 60_000;
const TRIAL_REQUEST_COOLDOWN_MS = 60_000;
const TRIAL_REQUEST_LIMIT = 5;
const TRIAL_IP_REQUEST_LIMIT = 20;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService, private readonly mail: MailService, private readonly googleIdentity?: GoogleIdentityService, private readonly subscriptionSchedule?: SubscriptionScheduleService) {}

  private normalizePhone(value: string) {
    let phone = value.replace(/\D/g, '');
    if (phone.startsWith('53') && phone.length === 10) phone = phone.slice(2);
    if (!/^5\d{7}$/.test(phone)) throw new ConflictException('Usa un número móvil cubano de 8 dígitos que comience con 5');
    return phone;
  }

  private deviceHash(deviceId: string) {
    return createHash('sha256').update(`gymflow-mini:${process.env.JWT_SECRET ?? 'local'}:${deviceId}`).digest('hex');
  }

  private ipHash(ip?: string) {
    const normalized = ip?.trim();
    return normalized ? createHash('sha256').update(`gymflow-mini:${process.env.JWT_SECRET ?? 'local'}:ip:${normalized}`).digest('hex') : null;
  }

  private resetCodeHash(userId: string, code: string) {
    return createHmac('sha256', process.env.JWT_SECRET ?? 'local').update(`${userId}:${code}`).digest('hex');
  }

  private emailVerificationCodeHash(userId: string, code: string) {
    return createHmac('sha256', process.env.JWT_SECRET ?? 'local').update(`verify-email:${userId}:${code}`).digest('hex');
  }

  private emailVerificationRequired() {
    return process.env.NODE_ENV === 'production' || process.env.EMAIL_VERIFICATION_REQUIRED?.trim().toLowerCase() === 'true';
  }

  private publicSubscriptionRequest(request: { id:string; code:string; plan:GymSubscriptionPlan; action:SubscriptionRequestAction; fromPlan:GymSubscriptionPlan | null; status:SubscriptionRequestStatus; requestedAt:Date; resolvedAt:Date | null } | null | undefined) {
    if (!request) return null;
    return { id:request.id, code:request.code, plan:request.plan, action:request.action, fromPlan:request.fromPlan, status:request.status, requestedAt:request.requestedAt, resolvedAt:request.resolvedAt };
  }

  private assertSubscriptionAction(gym: { subscriptionPlan:GymSubscriptionPlan | null; subscriptionEndsAt:Date | null; scheduledSubscriptionPlan:GymSubscriptionPlan | null }, dto: SelectSubscriptionDto, now: Date) {
    if (gym.scheduledSubscriptionPlan) throw new ConflictException('Ya existe un cambio de plan programado');
    const current = gym.subscriptionPlan;
    if (!current) {
      if (dto.action !== SubscriptionRequestAction.ACTIVATE) throw new ConflictException('Debes activar primero una suscripción');
      return;
    }
    if (dto.action === SubscriptionRequestAction.ACTIVATE) throw new ConflictException('Este gimnasio ya tiene una suscripción');
    if (dto.action === SubscriptionRequestAction.RENEW) {
      if (current === GymSubscriptionPlan.TRIAL || dto.plan !== current) throw new ConflictException('La renovación debe conservar el plan actual');
      this.assertRenewalWindow(gym.subscriptionEndsAt, now);
      return;
    }
    if (dto.action !== SubscriptionRequestAction.CHANGE || dto.plan === current || dto.plan === GymSubscriptionPlan.TRIAL) throw new ConflictException('El cambio de plan solicitado no es válido');
    const immediateUpgrade = current === GymSubscriptionPlan.MONTHLY && dto.plan === GymSubscriptionPlan.ANNUAL;
    const trialPurchase = current === GymSubscriptionPlan.TRIAL;
    if (!immediateUpgrade && !trialPurchase) this.assertRenewalWindow(gym.subscriptionEndsAt, now);
  }

  private assertRenewalWindow(endsAt: Date | null, now: Date) {
    if (!subscriptionIsActiveThroughDay(endsAt, now) || !endsAt) return;
    const availableAt = subscriptionWarningStart(endsAt);
    if (now < availableAt) {
      const date = new Intl.DateTimeFormat('es-CU', { timeZone:'America/Havana', day:'numeric', month:'long', year:'numeric' }).format(availableAt);
      throw new ConflictException(`Esta operación estará disponible a partir del ${date}, cuando falten 3 días para el vencimiento`);
    }
  }

  private async sendEmailVerificationCode(user: { id:string; email:string; name:string }) {
    const response = { message:'Enviamos un código de verificación a tu correo.', retryAfterSeconds:60 };
    const minuteAgo = new Date(Date.now() - 60_000);
    const recent = await this.prisma.emailVerificationCode.findFirst({ where:{ userId:user.id, usedAt:null, createdAt:{ gte:minuteAgo } } });
    if (recent) return response;
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60_000);
    const challenge = await this.prisma.$transaction(async tx => {
      await tx.emailVerificationCode.updateMany({ where:{ userId:user.id, usedAt:null }, data:{ usedAt:now } });
      return tx.emailVerificationCode.create({ data:{ userId:user.id, codeHash:this.emailVerificationCodeHash(user.id, code), expiresAt } });
    });
    try {
      await this.mail.sendEmailVerificationCode({ to:user.email, name:user.name, code });
    } catch (error) {
      await this.prisma.emailVerificationCode.update({ where:{ id:challenge.id }, data:{ usedAt:new Date() } }).catch(() => undefined);
      throw error;
    }
    return response;
  }

  private slug(name: string) {
    const base = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'gimnasio';
    return `${base}-${randomBytes(3).toString('hex')}`;
  }

  private async profile(userId: string) {
    if (this.subscriptionSchedule) {
      const identity = await this.prisma.user.findUnique({ where:{ id:userId }, select:{ gymId:true } });
      if (identity?.gymId) await this.subscriptionSchedule.activateDue(identity.gymId);
    }
    const found = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { gym: { include: { subscriptionRequests: { orderBy: { requestedAt: 'desc' }, take: 1 } } } },
    });
    if (!found || !found.isActive) throw new UnauthorizedException();
    const gym = found.gym ? (() => { const { subscriptionRequests, ...data } = found.gym; return data; })() : null;
    const latestSubscriptionRequest = this.publicSubscriptionRequest(found.gym?.subscriptionRequests[0]);
    const subscriptionRequest = latestSubscriptionRequest?.status === SubscriptionRequestStatus.PENDING ? latestSubscriptionRequest : null;
    return { id: found.id, email: found.email, phone: found.phone, phoneVerifiedAt: found.phoneVerifiedAt, name: found.name, role: found.role, gymId: found.gymId, gym, subscriptionRequest, latestSubscriptionRequest };
  }

  private async session(userId: string) {
    const user = await this.profile(userId);
    const security = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenVersion: true } });
    return { accessToken: await this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role, gymId: user.gymId, tokenVersion: security.tokenVersion }), user };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() }, include: { gym: true } });
    if (!user || !user.isActive || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }
    if (user.role !== UserRole.SUPER_ADMIN && (!user.gym || !user.gym.isActive)) {
      throw new UnauthorizedException('El gimnasio está inactivo');
    }
    if (user.role !== UserRole.SUPER_ADMIN && this.emailVerificationRequired() && user.emailVerifiedAt === null) {
      throw new ForbiddenException({ code:'EMAIL_NOT_VERIFIED', message:'Debes verificar tu correo antes de iniciar sesión' });
    }
    return this.session(user.id);
  }

  async googleLogin(dto: GoogleLoginDto) {
    if (!this.googleIdentity) throw new UnauthorizedException('El acceso con Google no está disponible');
    const email = await this.googleIdentity.verifiedEmail(dto.idToken);
    const user = await this.prisma.user.findUnique({ where: { email }, include: { gym: true } });
    if (!user) throw new UnauthorizedException('No existe una cuenta de GymFlow con este correo. Crea tu cuenta primero');
    if (!user.isActive || (user.role !== UserRole.ADMIN && user.role !== UserRole.RECEPTIONIST)) throw new UnauthorizedException('Esta cuenta no puede acceder a la aplicación del gimnasio');
    if (!user.gym || !user.gym.isActive) throw new UnauthorizedException('El gimnasio está inactivo');
    if (user.emailVerifiedAt === null) await this.prisma.user.update({ where:{ id:user.id }, data:{ emailVerifiedAt:new Date() } });
    return this.session(user.id);
  }

  async register(dto: RegisterDto) {
    const province = dto.province.trim();
    const municipality = dto.municipality.trim();
    assertCubanLocation(province, municipality);
    const email = dto.email.trim().toLowerCase();
    const phone = this.normalizePhone(dto.phone);
    const passwordHash = await argon2.hash(dto.password);
    const verificationRequired = this.emailVerificationRequired();
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const gym = await tx.gym.create({ data: { name: dto.gymName.trim(), slug: this.slug(dto.gymName), province, municipality, phone, currency: 'CUP', isActive: true } });
        return tx.user.create({ data: { email, phone, passwordHash, name: dto.ownerName.trim(), role: UserRole.ADMIN, gymId: gym.id, emailVerifiedAt:verificationRequired ? null : new Date() } });
      });
      if (verificationRequired) {
        try {
          const delivery = await this.sendEmailVerificationCode(user);
          return { verificationRequired:true as const, email:user.email, ...delivery };
        } catch (error) {
          await this.prisma.$transaction(async tx => {
            await tx.user.delete({ where:{ id:user.id } });
            if (user.gymId) await tx.gym.delete({ where:{ id:user.gymId } });
          }).catch(() => undefined);
          throw error;
        }
      }
      return this.session(user.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const targets = Array.isArray(error.meta?.target) ? error.meta.target.map(String) : [];
        if (targets.includes('email')) throw new ConflictException('Ese correo ya tiene una cuenta');
      }
      throw error;
    }
  }

  async resendEmailVerification(dto: ResendEmailVerificationDto) {
    const response = { message:'Si la cuenta está pendiente, enviaremos un nuevo código.', retryAfterSeconds:60 };
    const user = await this.prisma.user.findUnique({ where:{ email:dto.email.trim().toLowerCase() }, select:{ id:true, email:true, name:true, isActive:true, emailVerifiedAt:true } });
    if (!user?.isActive || user.emailVerifiedAt) return response;
    await this.sendEmailVerificationCode(user);
    return response;
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const invalid = new BadRequestException('El código es incorrecto, venció o ya fue utilizado');
    const user = await this.prisma.user.findUnique({ where:{ email:dto.email.trim().toLowerCase() }, select:{ id:true, isActive:true, emailVerifiedAt:true } });
    if (!user?.isActive) throw invalid;
    if (user.emailVerifiedAt) return this.session(user.id);
    const challenge = await this.prisma.emailVerificationCode.findFirst({ where:{ userId:user.id, usedAt:null }, orderBy:{ createdAt:'desc' } });
    if (!challenge) throw invalid;
    const now = new Date();
    if (challenge.expiresAt.getTime() <= now.getTime() || challenge.attempts >= 5) {
      await this.prisma.emailVerificationCode.update({ where:{ id:challenge.id }, data:{ usedAt:now } });
      throw invalid;
    }
    const provided = Buffer.from(this.emailVerificationCodeHash(user.id, dto.code), 'hex');
    const expected = Buffer.from(challenge.codeHash, 'hex');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      const attempts = challenge.attempts + 1;
      await this.prisma.emailVerificationCode.update({ where:{ id:challenge.id }, data:{ attempts, ...(attempts >= 5 ? { usedAt:now } : {}) } });
      throw invalid;
    }
    await this.prisma.$transaction(async tx => {
      await tx.user.update({ where:{ id:user.id }, data:{ emailVerifiedAt:now } });
      await tx.emailVerificationCode.updateMany({ where:{ userId:user.id, usedAt:null }, data:{ usedAt:now } });
    });
    return this.session(user.id);
  }

  async selectSubscription(user: AuthUser, dto: SelectSubscriptionDto, requestIp?: string) {
    if (!user.gymId) throw new ConflictException('La cuenta no pertenece a un gimnasio');
    await this.subscriptionSchedule?.activateDue(user.gymId);
    const owner = await this.prisma.user.findUnique({ where: { id: user.id }, select: { phone: true } });
    if (!owner?.phone) throw new ConflictException('La cuenta no tiene un teléfono móvil registrado');

    if (dto.plan === GymSubscriptionPlan.TRIAL) {
      if (dto.action !== SubscriptionRequestAction.ACTIVATE) throw new ConflictException('La prueba solo puede solicitarse como activación inicial');
      const now = new Date();
      const hashedDevice = this.deviceHash(dto.deviceId);
      const hashedIp = this.ipHash(requestIp);
      const used = await this.prisma.trialClaim.findFirst({ where: { OR: [{ phone: owner.phone }, { deviceHash: hashedDevice }] }, select: { id: true } });
      if (used) throw new ConflictException('La prueba gratuita ya fue utilizada con este teléfono o dispositivo');

      const pending = await this.prisma.subscriptionRequest.findFirst({ where: { gymId: user.gymId, plan: GymSubscriptionPlan.TRIAL, status: SubscriptionRequestStatus.PENDING }, orderBy: { requestedAt: 'desc' } });
      if (pending) {
        const elapsed = now.getTime() - pending.lastRequestedAt.getTime();
        if (elapsed < TRIAL_REQUEST_COOLDOWN_MS) {
          const seconds = Math.ceil((TRIAL_REQUEST_COOLDOWN_MS - elapsed) / 1000);
          throw new HttpException(`Espera ${seconds} segundos antes de reenviar la solicitud por WhatsApp`, HttpStatus.TOO_MANY_REQUESTS);
        }
        if (pending.requestedAt.getTime() >= now.getTime() - TRIAL_REQUEST_WINDOW_MS && pending.resendCount >= TRIAL_REQUEST_LIMIT - 1) {
          throw new HttpException('Alcanzaste el límite de reenvíos. Intenta nuevamente dentro de 24 horas', HttpStatus.TOO_MANY_REQUESTS);
        }
        const windowExpired = pending.requestedAt.getTime() < now.getTime() - TRIAL_REQUEST_WINDOW_MS;
        const resent = await this.prisma.subscriptionRequest.update({ where: { id: pending.id }, data: windowExpired ? { requestedAt: now, lastRequestedAt: now, resendCount: 0 } : { resendCount: { increment: 1 }, lastRequestedAt: now } });
        return { user: await this.profile(user.id), request: this.publicSubscriptionRequest(resent) };
      }

      const dayAgo = new Date(now.getTime() - TRIAL_REQUEST_WINDOW_MS);
      const [identityAttempts, ipAttempts] = await Promise.all([
        this.prisma.subscriptionRequest.count({ where: { plan: GymSubscriptionPlan.TRIAL, requestedAt: { gte: dayAgo }, OR: [{ verificationPhone: owner.phone }, { deviceHash: hashedDevice }] } }),
        hashedIp ? this.prisma.subscriptionRequest.count({ where: { plan: GymSubscriptionPlan.TRIAL, requestedAt: { gte: dayAgo }, ipHash: hashedIp } }) : Promise.resolve(0),
      ]);
      if (identityAttempts >= TRIAL_REQUEST_LIMIT || ipAttempts >= TRIAL_IP_REQUEST_LIMIT) throw new HttpException('Alcanzaste el límite de solicitudes de prueba. Intenta nuevamente dentro de 24 horas', HttpStatus.TOO_MANY_REQUESTS);

      const request = await this.prisma.$transaction(async (tx) => {
        const gym = await tx.gym.findUniqueOrThrow({ where: { id: user.gymId! } });
        if (gym.subscriptionPlan) throw new ConflictException('Este gimnasio ya utilizó o tiene una suscripción');
        await tx.subscriptionRequest.updateMany({ where: { gymId: user.gymId!, status: SubscriptionRequestStatus.PENDING }, data: { status: SubscriptionRequestStatus.CANCELLED, resolvedAt: now } });
        return tx.subscriptionRequest.create({ data: { code: `GF-T-${randomBytes(3).toString('hex').toUpperCase()}`, gymId: user.gymId!, plan: GymSubscriptionPlan.TRIAL, action: SubscriptionRequestAction.ACTIVATE, verificationPhone: owner.phone!, deviceHash: hashedDevice, ipHash: hashedIp, lastRequestedAt: now } });
      });
      return { user: await this.profile(user.id), request: this.publicSubscriptionRequest(request) };
    }

    const now = new Date();
    const gym = await this.prisma.gym.findUnique({ where:{ id:user.gymId }, select:{ subscriptionPlan:true, subscriptionEndsAt:true, scheduledSubscriptionPlan:true } });
    if (!gym) throw new ConflictException('El gimnasio no existe');
    this.assertSubscriptionAction(gym, dto, now);
    const existing = await this.prisma.subscriptionRequest.findFirst({ where: { gymId: user.gymId, plan: dto.plan, action: dto.action, status: SubscriptionRequestStatus.PENDING }, orderBy: { requestedAt: 'desc' } });
    if (existing) return { user: await this.profile(user.id), request: this.publicSubscriptionRequest(existing) };
    const request = await this.prisma.$transaction(async (tx) => {
      await tx.subscriptionRequest.updateMany({ where: { gymId: user.gymId!, status: SubscriptionRequestStatus.PENDING }, data: { status: SubscriptionRequestStatus.CANCELLED, resolvedAt: now } });
      return tx.subscriptionRequest.create({ data: { code: `GF-${randomBytes(3).toString('hex').toUpperCase()}`, gymId: user.gymId!, plan: dto.plan, action:dto.action, fromPlan:gym.subscriptionPlan, previousEndsAt:gym.subscriptionEndsAt } });
    });
    return { user: await this.profile(user.id), request: this.publicSubscriptionRequest(request) };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const response = { message: 'El código de recuperación fue enviado.' };
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() }, select: { id: true, email: true, name: true, isActive: true } });
    if (!user?.isActive) throw new NotFoundException('El correo no se encuentra registrado en el sistema');
    const minuteAgo = new Date(Date.now() - 60_000);
    const recent = await this.prisma.passwordResetCode.findFirst({ where: { userId: user.id, usedAt: null, createdAt: { gte: minuteAgo } } });
    if (recent) return response;
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const now = new Date(); const expiresAt = new Date(now.getTime() + 15 * 60_000);
    const challenge = await this.prisma.$transaction(async tx => {
      await tx.passwordResetCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
      return tx.passwordResetCode.create({ data: { userId: user.id, codeHash: this.resetCodeHash(user.id, code), expiresAt } });
    });
    try {
      await this.mail.sendPasswordResetCode({ to: user.email, name: user.name, code });
    } catch (error) {
      await this.prisma.passwordResetCode.update({ where: { id: challenge.id }, data: { usedAt: new Date() } }).catch(() => undefined);
      throw error;
    }
    return response;
  }

  async resetPassword(dto: ResetPasswordDto) {
    const invalid = new BadRequestException('El código es incorrecto, venció o ya fue utilizado');
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() }, select: { id: true, passwordHash: true, isActive: true } });
    if (!user?.isActive) throw invalid;
    const challenge = await this.prisma.passwordResetCode.findFirst({ where: { userId: user.id, usedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!challenge) throw invalid;
    const now = new Date();
    if (challenge.expiresAt.getTime() <= now.getTime() || challenge.attempts >= 5) {
      await this.prisma.passwordResetCode.update({ where: { id: challenge.id }, data: { usedAt: now } });
      throw invalid;
    }
    const provided = Buffer.from(this.resetCodeHash(user.id, dto.code), 'hex');
    const expected = Buffer.from(challenge.codeHash, 'hex');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      const attempts = challenge.attempts + 1;
      await this.prisma.passwordResetCode.update({ where: { id: challenge.id }, data: { attempts, ...(attempts >= 5 ? { usedAt: now } : {}) } });
      throw invalid;
    }
    if (await argon2.verify(user.passwordHash, dto.newPassword)) throw new BadRequestException('La nueva contraseña debe ser diferente a la anterior');
    const passwordHash = await argon2.hash(dto.newPassword);
    await this.prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, tokenVersion: { increment: 1 } } });
      await tx.passwordResetCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
    });
    return { message: 'Contraseña actualizada. Ya puedes iniciar sesión.' };
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto) {
    const found = await this.prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
    if (!found || !(await argon2.verify(found.passwordHash, dto.currentPassword))) throw new BadRequestException('La contraseña actual no es correcta');
    if (await argon2.verify(found.passwordHash, dto.newPassword)) throw new BadRequestException('La nueva contraseña debe ser diferente a la actual');
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await argon2.hash(dto.newPassword), tokenVersion: { increment: 1 } } });
    return this.session(user.id);
  }

  async me(user: AuthUser) {
    return this.profile(user.id);
  }
}
