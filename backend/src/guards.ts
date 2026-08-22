import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { UserRole } from '@prisma/client';
import { IS_PUBLIC, ROLES, type AuthUser } from './common';

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

