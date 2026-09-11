import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser } from '../common/auth-context';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: config.getOrThrow('JWT_SECRET') });
  }
  async validate(payload: { sub: string; email: string; role: AuthUser['role']; gymId: string | null; tokenVersion?: number }): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { isActive: true, tokenVersion: true } });
    if (!user?.isActive || user.tokenVersion !== (payload.tokenVersion ?? 0)) throw new UnauthorizedException('La sesión ya no es válida');
    return { id: payload.sub, email: payload.email, role: payload.role, gymId: payload.gymId };
  }
}
