import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { GymSubscriptionPlan, Prisma, SubscriptionRequestStatus, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService } from './prisma.service';
import { ChangePasswordDto, ForgotPasswordDto, GoogleLoginDto, LoginDto, RegisterDto, ResetPasswordDto, SelectSubscriptionDto } from './auth.dto';
import type { AuthUser } from './common';
import { GoogleIdentityService } from './google-identity.service';
import { MailService } from './mail.service';

const PLATFORM_SUBSCRIPTION_PRICES: Record<GymSubscriptionPlan, number> = {
  [GymSubscriptionPlan.TRIAL]: 0,
  [GymSubscriptionPlan.MONTHLY]: 5000,
  [GymSubscriptionPlan.ANNUAL]: 50000,
};

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService, private readonly mail: MailService, private readonly googleIdentity?: GoogleIdentityService) {}

  private normalizePhone(value: string) {
    let phone = value.replace(/\D/g, '');
    if (phone.startsWith('53') && phone.length === 10) phone = phone.slice(2);
    if (!/^5\d{7}$/.test(phone)) throw new ConflictException('Usa un número móvil cubano de 8 dígitos que comience con 5');
    return phone;
  }

  private deviceHash(deviceId: string) {
    return createHash('sha256').update(`gymflow-mini:${process.env.JWT_SECRET ?? 'local'}:${deviceId}`).digest('hex');
  }

  private resetCodeHash(userId: string, code: string) {
    return createHmac('sha256', process.env.JWT_SECRET ?? 'local').update(`${userId}:${code}`).digest('hex');
  }

  private slug(name: string) {
    const base = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'gimnasio';
    return `${base}-${randomBytes(3).toString('hex')}`;
  }

  private async profile(userId: string) {
    const found = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { gym: { include: { subscriptionRequests: { orderBy: { requestedAt: 'desc' }, take: 1 } } } },
    });
    if (!found || !found.isActive) throw new UnauthorizedException();
    const gym = found.gym ? (() => { const { subscriptionRequests, ...data } = found.gym; return data; })() : null;
    const latestSubscriptionRequest = found.gym?.subscriptionRequests[0] ?? null;
    const subscriptionRequest = latestSubscriptionRequest?.status === SubscriptionRequestStatus.PENDING ? latestSubscriptionRequest : null;
    return { id: found.id, email: found.email, phone: found.phone, name: found.name, role: found.role, gymId: found.gymId, gym, subscriptionRequest, latestSubscriptionRequest };
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
    if (user.role === 'ADMIN' && (!user.gym || !user.gym.isActive)) {
      throw new UnauthorizedException('El gimnasio está inactivo');
    }
    return this.session(user.id);
  }

  async googleLogin(dto: GoogleLoginDto) {
    if (!this.googleIdentity) throw new UnauthorizedException('El acceso con Google no está disponible');
    const email = await this.googleIdentity.verifiedEmail(dto.idToken);
    const user = await this.prisma.user.findUnique({ where: { email }, include: { gym: true } });
    if (!user) throw new UnauthorizedException('No existe una cuenta de GymFlow con este correo. Crea tu cuenta primero');
    if (!user.isActive || user.role !== UserRole.ADMIN) throw new UnauthorizedException('Esta cuenta no puede acceder a la aplicación de administradores');
    if (!user.gym || !user.gym.isActive) throw new UnauthorizedException('El gimnasio está inactivo');
    return this.session(user.id);
  }

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const phone = this.normalizePhone(dto.phone);
    const passwordHash = await argon2.hash(dto.password);
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const gym = await tx.gym.create({ data: { name: dto.gymName.trim(), slug: this.slug(dto.gymName), province: dto.province?.trim() || null, phone, currency: 'CUP', isActive: true } });
        return tx.user.create({ data: { email, phone, passwordHash, name: dto.ownerName.trim(), role: UserRole.ADMIN, gymId: gym.id } });
      });
      return this.session(user.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const targets = Array.isArray(error.meta?.target) ? error.meta.target.map(String) : [];
        if (targets.includes('email')) throw new ConflictException('Ese correo ya tiene una cuenta');
      }
      throw error;
    }
  }

  async selectSubscription(user: AuthUser, dto: SelectSubscriptionDto) {
    if (!user.gymId) throw new ConflictException('La cuenta no pertenece a un gimnasio');
    const owner = await this.prisma.user.findUnique({ where: { id: user.id }, select: { phone: true } });
    if (!owner?.phone) throw new ConflictException('La cuenta no tiene un teléfono verificado');

    if (dto.plan === GymSubscriptionPlan.TRIAL) {
      const now = new Date();
      const endsAt = new Date(now); endsAt.setDate(endsAt.getDate() + 7);
      try {
        await this.prisma.$transaction(async (tx) => {
          const gym = await tx.gym.findUniqueOrThrow({ where: { id: user.gymId! } });
          if (gym.subscriptionPlan) throw new ConflictException('Este gimnasio ya utilizó o tiene una membresía');
          await tx.trialClaim.create({ data: { gymId: user.gymId!, phone: owner.phone!, deviceHash: this.deviceHash(dto.deviceId) } });
          await tx.subscriptionRequest.updateMany({ where: { gymId: user.gymId!, status: SubscriptionRequestStatus.PENDING }, data: { status: SubscriptionRequestStatus.CANCELLED, resolvedAt: now } });
          await tx.gym.update({ where: { id: user.gymId! }, data: { subscriptionPlan: GymSubscriptionPlan.TRIAL, subscriptionTrialDays: 7, subscriptionStartedAt: now, subscriptionEndsAt: endsAt } });
          await tx.platformSubscription.create({ data: { gymId: user.gymId!, plan: GymSubscriptionPlan.TRIAL, amount: 0, startedAt: now, endsAt } });
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('La prueba gratuita ya fue utilizada con este teléfono o dispositivo');
        throw error;
      }
      return { user: await this.profile(user.id), request: null };
    }

    const existing = await this.prisma.subscriptionRequest.findFirst({ where: { gymId: user.gymId, plan: dto.plan, status: SubscriptionRequestStatus.PENDING }, orderBy: { requestedAt: 'desc' } });
    if (existing) return { user: await this.profile(user.id), request: existing };
    const request = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.subscriptionRequest.updateMany({ where: { gymId: user.gymId!, status: SubscriptionRequestStatus.PENDING }, data: { status: SubscriptionRequestStatus.CANCELLED, resolvedAt: now } });
      return tx.subscriptionRequest.create({ data: { code: `GF-${randomBytes(3).toString('hex').toUpperCase()}`, gymId: user.gymId!, plan: dto.plan } });
    });
    return { user: await this.profile(user.id), request };
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
