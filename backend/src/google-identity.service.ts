import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class GoogleIdentityService {
  private readonly client = new OAuth2Client();

  constructor(private readonly config: ConfigService) {}

  async verifiedEmail(idToken: string) {
    const audience = this.config.get<string>('GOOGLE_AUTH_CLIENT_ID')?.trim();
    if (!audience) throw new ServiceUnavailableException('El acceso con Google no está configurado');
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience });
      const payload = ticket.getPayload();
      if (!payload?.email || payload.email_verified !== true) {
        throw new UnauthorizedException('Google no confirmó este correo');
      }
      const email = payload.email.trim().toLowerCase();
      if (!email.endsWith('@gmail.com') && !payload.hd) {
        throw new UnauthorizedException('Usa una dirección de Gmail o Google Workspace para acceder con Google');
      }
      return email;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('No se pudo validar el acceso con Google');
    }
  }
}
