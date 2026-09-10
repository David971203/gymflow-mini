import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import type { ForgotPasswordDto, ResetPasswordDto } from './auth.dto';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class PasswordRecoveryService {
  constructor(private readonly prisma: PrismaService, private readonly mail: MailService) {}

  async request(dto: ForgotPasswordDto) {
    const response = { message: 'El código de recuperación fue enviado.' };
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() }, select: { id: true, email: true, name: true, isActive: true } });
    if (!user?.isActive) throw new NotFoundException('El correo no se encuentra registrado en el sistema');
    const recent = await this.prisma.passwordResetCode.findFirst({ where: { userId: user.id, usedAt: null, createdAt: { gte: new Date(Date.now() - 60_000) } } });
    if (recent) return response;
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const now = new Date(); const expiresAt = new Date(now.getTime() + 15 * 60_000);
    const challenge = await this.prisma.$transaction(async tx => {
      await tx.passwordResetCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
      return tx.passwordResetCode.create({ data: { userId: user.id, codeHash: this.codeHash(user.id, code), expiresAt } });
    });
    try { await this.mail.sendPasswordResetCode({ to: user.email, name: user.name, code }); }
    catch (error) { await this.prisma.passwordResetCode.update({ where: { id: challenge.id }, data: { usedAt: new Date() } }).catch(() => undefined); throw error; }
    return response;
  }

  async reset(dto: ResetPasswordDto) {
    const invalid = new BadRequestException('El código es incorrecto, venció o ya fue utilizado');
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() }, select: { id: true, passwordHash: true, isActive: true } });
    if (!user?.isActive) throw invalid;
    const challenge = await this.prisma.passwordResetCode.findFirst({ where: { userId: user.id, usedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!challenge) throw invalid;
    const now = new Date();
    if (challenge.expiresAt.getTime() <= now.getTime() || challenge.attempts >= 5) { await this.prisma.passwordResetCode.update({ where: { id: challenge.id }, data: { usedAt: now } }); throw invalid; }
    const provided = Buffer.from(this.codeHash(user.id, dto.code), 'hex'); const expected = Buffer.from(challenge.codeHash, 'hex');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) { const attempts = challenge.attempts + 1; await this.prisma.passwordResetCode.update({ where: { id: challenge.id }, data: { attempts, ...(attempts >= 5 ? { usedAt: now } : {}) } }); throw invalid; }
    if (await argon2.verify(user.passwordHash, dto.newPassword)) throw new BadRequestException('La nueva contraseña debe ser diferente a la anterior');
    const passwordHash = await argon2.hash(dto.newPassword);
    await this.prisma.$transaction(async tx => { await tx.user.update({ where: { id: user.id }, data: { passwordHash, tokenVersion: { increment: 1 } } }); await tx.passwordResetCode.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }); });
    return { message: 'Contraseña actualizada. Ya puedes iniciar sesión.' };
  }

  private codeHash(userId: string, code: string) { return createHmac('sha256', process.env.JWT_SECRET ?? 'local').update(`${userId}:${code}`).digest('hex'); }
}
