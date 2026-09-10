import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, SubscriptionRequestStatus, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { ChangePasswordDto, ForgotPasswordDto, GoogleLoginDto, LoginDto, RegisterDto, ResendEmailVerificationDto, ResetPasswordDto, SelectSubscriptionDto, VerifyEmailDto } from './auth.dto';
import type { AuthUser } from '../common/auth-context';
import { GoogleIdentityService } from './google-identity.service';
import { MailService } from '../mail/mail.service';
import { SubscriptionScheduleService } from '../subscriptions/subscription-schedule.service';
import { assertCubanLocation } from '../common/cuba-locations';
import { EmailVerificationService } from './email-verification.service';
import { PasswordRecoveryService } from './password-recovery.service';
import { SubscriptionSelectionService } from './subscription-selection.service';

@Injectable()
export class AuthService {
  private readonly emailVerification: EmailVerificationService;
  private readonly passwordRecovery: PasswordRecoveryService;
  private readonly subscriptionSelection: SubscriptionSelectionService;
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService, private readonly mail: MailService, private readonly googleIdentity?: GoogleIdentityService, private readonly subscriptionSchedule?: SubscriptionScheduleService, emailVerification?: EmailVerificationService, passwordRecovery?: PasswordRecoveryService, subscriptionSelection?: SubscriptionSelectionService) {
    this.emailVerification = emailVerification ?? new EmailVerificationService(prisma, mail);
    this.passwordRecovery = passwordRecovery ?? new PasswordRecoveryService(prisma, mail);
    this.subscriptionSelection = subscriptionSelection ?? new SubscriptionSelectionService(prisma, subscriptionSchedule);
  }

  private normalizePhone(value: string) {
    let phone = value.replace(/\D/g, '');
    if (phone.startsWith('53') && phone.length === 10) phone = phone.slice(2);
    if (!/^5\d{7}$/.test(phone)) throw new ConflictException('Usa un número móvil cubano de 8 dígitos que comience con 5');
    return phone;
  }

  private emailVerificationRequired() {
    return this.emailVerification.required();
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
    const latestSubscriptionRequest = this.subscriptionSelection.publicRequest(found.gym?.subscriptionRequests[0]);
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
          const delivery = await this.emailVerification.send(user);
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
    return this.emailVerification.resend(dto);
  }

  async verifyEmail(dto: VerifyEmailDto) {
    return this.emailVerification.verify(dto, (userId) => this.session(userId));
  }

  async selectSubscription(user: AuthUser, dto: SelectSubscriptionDto, requestIp?: string) {
    return this.subscriptionSelection.select(user, dto, requestIp, (userId) => this.profile(userId));
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    return this.passwordRecovery.request(dto);
  }

  async resetPassword(dto: ResetPasswordDto) {
    return this.passwordRecovery.reset(dto);
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
