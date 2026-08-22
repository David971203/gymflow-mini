import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from './prisma.service';
import { LoginDto } from './auth.dto';
import type { AuthUser } from './common';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() }, include: { gym: true } });
    if (!user || !user.isActive || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }
    if (user.role === 'ADMIN' && (!user.gym || !user.gym.isActive)) {
      throw new UnauthorizedException('El gimnasio está inactivo');
    }
    const profile = { id: user.id, email: user.email, name: user.name, role: user.role, gymId: user.gymId, gym: user.gym };
    return { accessToken: await this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role, gymId: user.gymId }), user: profile };
  }

  async me(user: AuthUser) {
    const found = await this.prisma.user.findUnique({ where: { id: user.id }, include: { gym: true } });
    if (!found || !found.isActive) throw new UnauthorizedException();
    return { id: found.id, email: found.email, name: found.name, role: found.role, gymId: found.gymId, gym: found.gym };
  }
}

