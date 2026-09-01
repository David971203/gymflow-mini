import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendPasswordResetCode(input: { to: string; name: string; code: string }) {
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const password = this.config.get<string>('SMTP_PASSWORD')?.replace(/\s/g, '');
    if (!user || !password) throw new ServiceUnavailableException('El correo de soporte no está configurado');
    const host = this.config.get<string>('SMTP_HOST')?.trim() || 'smtp.gmail.com';
    const port = Number(this.config.get<string>('SMTP_PORT') || 465);
    const secure = (this.config.get<string>('SMTP_SECURE') || 'true').toLowerCase() !== 'false';
    const from = this.config.get<string>('SMTP_FROM')?.trim() || `GymFlow Mini <${user}>`;
    const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass: password } });
    try {
      await transporter.sendMail({
        from,
        to: input.to,
        subject: `${input.code} es tu código de recuperación de GymFlow Mini`,
        text: `Hola ${input.name}. Tu código de recuperación es ${input.code}. Vence en 15 minutos y solo puede usarse una vez. Si no solicitaste este cambio, ignora este mensaje.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17221d"><h2 style="color:#173f31">GymFlow Mini</h2><p>Hola ${this.escape(input.name)},</p><p>Usa este código para recuperar tu cuenta:</p><div style="margin:24px 0;padding:18px;text-align:center;background:#f2f5f3;border-radius:12px;font-size:30px;font-weight:800;letter-spacing:8px;color:#1d6b4d">${input.code}</div><p>El código vence en <strong>15 minutos</strong> y solo puede utilizarse una vez.</p><p style="color:#657169;font-size:13px">Si no solicitaste este cambio, ignora este mensaje. Tu contraseña no se modificará.</p></div>`,
      });
    } catch (error) {
      this.logger.error(`No se pudo enviar el código de recuperación a ${input.to}`, error instanceof Error ? error.stack : undefined);
      throw new ServiceUnavailableException('No se pudo enviar el correo de recuperación');
    }
  }

  private escape(value: string) {
    return value.replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]!);
  }
}
