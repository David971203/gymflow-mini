import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const ROLES = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  gymId: string | null;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => context.switchToHttp().getRequest().user,
);

