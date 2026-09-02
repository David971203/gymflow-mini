import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendPasswordResetCode(input: { to: string; name: string; code: string }) {
    const subject = `${input.code} es tu código de recuperación de GymFlow Mini`;
    const text = `Hola ${input.name}. Tu código de recuperación es ${input.code}. Vence en 15 minutos y solo puede usarse una vez. Si no solicitaste este cambio, ignora este mensaje.`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17221d"><h2 style="color:#173f31">GymFlow Mini</h2><p>Hola ${this.escape(input.name)},</p><p>Usa este código para recuperar tu cuenta:</p><div style="margin:24px 0;padding:18px;text-align:center;background:#f2f5f3;border-radius:12px;font-size:30px;font-weight:800;letter-spacing:8px;color:#1d6b4d">${input.code}</div><p>El código vence en <strong>15 minutos</strong> y solo puede utilizarse una vez.</p><p style="color:#657169;font-size:13px">Si no solicitaste este cambio, ignora este mensaje. Tu contraseña no se modificará.</p></div>`;
    const provider = this.config.get<string>('MAIL_PROVIDER')?.trim().toLowerCase();
    if (provider === 'apps_script' || provider === 'google_apps_script') {
      await this.sendWithGoogleAppsScript({ ...input, subject, text, html });
      return;
    }

    if (provider === 'gmail' || provider === 'gmail_api') {
      await this.sendWithGmailApi({ ...input, subject, text, html });
      return;
    }

    const mailjetApiKey = this.config.get<string>('MAILJET_API_KEY')?.trim();
    const mailjetSecretKey = this.config.get<string>('MAILJET_SECRET_KEY')?.trim();
    if (provider === 'mailjet' || (provider !== 'smtp' && mailjetApiKey && mailjetSecretKey)) {
      if (!mailjetApiKey || !mailjetSecretKey) throw new ServiceUnavailableException('El correo de soporte no está configurado');
      await this.sendWithMailjet({ ...input, apiKey: mailjetApiKey, secretKey: mailjetSecretKey, subject, text, html });
      return;
    }

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
        subject,
        text,
        html,
      });
    } catch (error) {
      this.logger.error(`No se pudo enviar el código de recuperación a ${input.to}`, error instanceof Error ? error.stack : undefined);
      throw new ServiceUnavailableException('No se pudo enviar el correo de recuperación');
    }
  }

  private async sendWithGoogleAppsScript(input: { to: string; name: string; subject: string; text: string; html: string }) {
    const url = this.config.get<string>('APPS_SCRIPT_WEB_APP_URL')?.trim();
    const secret = this.config.get<string>('APPS_SCRIPT_SECRET')?.trim();
    if (!url || !secret) throw new ServiceUnavailableException('El correo de soporte no está configurado');
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret, to: input.to, name: input.name, subject: input.subject, text: input.text, html: input.html }),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        throw new Error(`Google Apps Script respondió ${response.status}${detail ? `: ${detail}` : ''}`);
      }
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!result?.ok) throw new Error(`Google Apps Script rechazó el envío${result?.error ? `: ${result.error.slice(0, 200)}` : ''}`);
    } catch (error) {
      this.logger.error(`No se pudo enviar el código de recuperación a ${input.to} mediante Google Apps Script`, error instanceof Error ? error.stack : undefined);
      throw new ServiceUnavailableException('No se pudo enviar el correo de recuperación');
    }
  }

  private async sendWithGmailApi(input: { to: string; name: string; subject: string; text: string; html: string }) {
    const clientId = this.config.get<string>('GMAIL_CLIENT_ID')?.trim();
    const clientSecret = this.config.get<string>('GMAIL_CLIENT_SECRET')?.trim();
    const refreshToken = this.config.get<string>('GMAIL_REFRESH_TOKEN')?.trim();
    const senderEmail = this.config.get<string>('GMAIL_SENDER_EMAIL')?.trim() || this.config.get<string>('SMTP_USER')?.trim();
    const senderName = this.config.get<string>('GMAIL_SENDER_NAME')?.trim() || 'GymFlow Mini';
    if (!clientId || !clientSecret || !refreshToken || !senderEmail) {
      throw new ServiceUnavailableException('El correo de soporte no está configurado');
    }

    try {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
      });
      if (!tokenResponse.ok) {
        const detail = (await tokenResponse.text().catch(() => '')).slice(0, 300);
        throw new Error(`Google OAuth respondió ${tokenResponse.status}${detail ? `: ${detail}` : ''}`);
      }
      const token = await tokenResponse.json() as { access_token?: string };
      if (!token.access_token) throw new Error('Google OAuth no devolvió un token de acceso');

      const raw = this.buildMimeMessage({ ...input, senderEmail, senderName });
      const sendResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ raw }),
      });
      if (!sendResponse.ok) {
        const detail = (await sendResponse.text().catch(() => '')).slice(0, 300);
        throw new Error(`Gmail API respondió ${sendResponse.status}${detail ? `: ${detail}` : ''}`);
      }
    } catch (error) {
      this.logger.error(`No se pudo enviar el código de recuperación a ${input.to} mediante Gmail API`, error instanceof Error ? error.stack : undefined);
      throw new ServiceUnavailableException('No se pudo enviar el correo de recuperación');
    }
  }

  private buildMimeMessage(input: { to: string; subject: string; text: string; html: string; senderEmail: string; senderName: string }) {
    const boundary = `gymflow_${Date.now().toString(36)}`;
    const safeSenderName = input.senderName.replace(/[\r\n]/g, ' ').trim();
    const safeTo = input.to.replace(/[\r\n]/g, '').trim();
    const subject = `=?UTF-8?B?${Buffer.from(input.subject, 'utf8').toString('base64')}?=`;
    const message = [
      `From: ${safeSenderName} <${input.senderEmail}>`,
      `To: ${safeTo}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(input.text, 'utf8').toString('base64'),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(input.html, 'utf8').toString('base64'),
      `--${boundary}--`,
    ].join('\r\n');
    return Buffer.from(message, 'utf8').toString('base64url');
  }

  private async sendWithMailjet(input: { to: string; name: string; subject: string; text: string; html: string; apiKey: string; secretKey: string }) {
    const senderEmail = this.config.get<string>('MAILJET_SENDER_EMAIL')?.trim() || this.config.get<string>('SMTP_USER')?.trim();
    const senderName = this.config.get<string>('MAILJET_SENDER_NAME')?.trim() || 'GymFlow Mini';
    if (!senderEmail) throw new ServiceUnavailableException('El correo de soporte no está configurado');
    try {
      const response = await fetch('https://api.mailjet.com/v3.1/send', {
        method: 'POST',
        headers: { accept: 'application/json', authorization: `Basic ${Buffer.from(`${input.apiKey}:${input.secretKey}`).toString('base64')}`, 'content-type': 'application/json' },
        body: JSON.stringify({ Messages: [{ From: { Name: senderName, Email: senderEmail }, To: [{ Email: input.to, Name: input.name }], ReplyTo: { Name: senderName, Email: senderEmail }, Subject: input.subject, TextPart: input.text, HTMLPart: input.html }] }),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        throw new Error(`Mailjet respondió ${response.status}${detail ? `: ${detail}` : ''}`);
      }
    } catch (error) {
      this.logger.error(`No se pudo enviar el código de recuperación a ${input.to} mediante Mailjet`, error instanceof Error ? error.stack : undefined);
      throw new ServiceUnavailableException('No se pudo enviar el correo de recuperación');
    }
  }

  private escape(value: string) {
    return value.replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]!);
  }
}
