import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser } from './common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: config.getOrThrow('JWT_SECRET') });
  }
  validate(payload: { sub: string; email: string; role: AuthUser['role']; gymId: string | null }): AuthUser {
    return { id: payload.sub, email: payload.email, role: payload.role, gymId: payload.gymId };
  }
}

