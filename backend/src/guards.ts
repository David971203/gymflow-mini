import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { ALLOW_WITHOUT_SUBSCRIPTION, IS_PUBLIC, ROLES, type AuthUser } from './common';
import { PrismaService } from './prisma.service';
import { subscriptionIsActiveThroughDay } from './subscription-time';
import { SubscriptionScheduleService } from './subscription-schedule.service';

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
  constructor(private readonly prisma: PrismaService, private readonly reflector: Reflector, private readonly subscriptionSchedule?: SubscriptionScheduleService) {}
  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_SUBSCRIPTION, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<{ method: string; user?: AuthUser }>();
    if (!request.user || request.user.role === UserRole.SUPER_ADMIN) return true;
    if (!request.user.gymId) throw new ForbiddenException('Para continuar debes renovar la suscripción de tu gimnasio.');
    await this.subscriptionSchedule?.activateDue(request.user.gymId);
    const gym = await this.prisma.gym.findUnique({ where: { id: request.user.gymId }, select: { isActive: true, subscriptionPlan: true, subscriptionEndsAt: true } });
    if (gym?.subscriptionPlan === null) throw new ForbiddenException('Elige una prueba o solicita un plan para acceder a GymFlow Mini.');
    if (['GET','HEAD','OPTIONS'].includes(request.method)) return true;
    if (!gym?.isActive || !subscriptionIsActiveThroughDay(gym.subscriptionEndsAt)) throw new ForbiddenException('Para continuar debes renovar la suscripción de tu gimnasio.');
    return true;
  }
}
