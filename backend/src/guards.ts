import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { IS_PUBLIC, ROLES, type AuthUser } from './common';
import { PrismaService } from './prisma.service';

@Injectable()
export class JwtGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) { super(); }
  canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    return super.canActivate(context);
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES, [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;
    const user = context.switchToHttp().getRequest().user as AuthUser;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException('No tienes permiso para esta operación');
    return true;
  }
}

@Injectable()
export class GymSubscriptionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ method: string; user?: AuthUser }>();
    if (!request.user || request.user.role !== UserRole.ADMIN || ['GET','HEAD','OPTIONS'].includes(request.method)) return true;
    if (!request.user.gymId) throw new ForbiddenException('Para continuar debes renovar la membresía de tu gimnasio.');
    const gym = await this.prisma.gym.findUnique({ where: { id: request.user.gymId }, select: { isActive: true, subscriptionEndsAt: true } });
    if (!gym?.isActive || gym.subscriptionEndsAt.getTime() <= Date.now()) throw new ForbiddenException('Para continuar debes renovar la membresía de tu gimnasio.');
    return true;
  }
}
