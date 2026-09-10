import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthUser } from './auth-context';
import { PrismaService } from '../database/prisma.service';

export function authenticatedGymId(user: AuthUser): string {
  if ((user.role !== UserRole.ADMIN && user.role !== UserRole.RECEPTIONIST) || !user.gymId) {
    throw new BadRequestException('Se requiere una cuenta del gimnasio');
  }
  return user.gymId;
}

export async function requireGym(prisma: PrismaService, id: string) {
  const gym = await prisma.gym.findUnique({ where: { id } });
  if (!gym) throw new NotFoundException('Gimnasio no encontrado');
  return gym;
}
