import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MiniService } from './mini.service';

describe('MiniService', () => {
  const user = { id: 'admin-1', email: 'admin@gym.cu', role: 'ADMIN' as const, gymId: 'gym-1' };

  it('siempre asigna el tenant autenticado al crear un miembro', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'member-1' });
    const service = new MiniService({ member: { create } } as never);
    await service.createMember({ ci: '90010112345', firstName: 'Ana', lastName: 'Pérez' }, user);
    expect(create).toHaveBeenCalledWith({ data: { ci: '90010112345', firstName: 'Ana', lastName: 'Pérez', gymId: 'gym-1' } });
  });

  it('convierte la restricción única del CI en un conflicto de negocio claro', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target: ['gymId', 'ci'] },
    });
    const service = new MiniService({ member: { create: jest.fn().mockRejectedValue(duplicate) } } as never);
    await expect(
      service.createMember({ ci: '90010112345', firstName: 'Ana', lastName: 'Pérez' }, user),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza un abono inicial superior al precio del plan', async () => {
    const prisma = {
      member: { findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }) },
      plan: { findFirst: jest.fn().mockResolvedValue({ id: 'plan-1', price: 1000, durationDays: 30 }) },
    };
    const service = new MiniService(prisma as never);
    await expect(service.createMembership({ memberId: 'member-1', planId: 'plan-1', initialPayment: 1001 }, user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('permite al superadministrador actualizar todos los datos del gimnasio', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'gym-1', name: 'Titan Centro', slug: 'titan-centro', currency: 'CUP' });
    const prisma = { gym: { findUnique: jest.fn().mockResolvedValue({ id: 'gym-1' }), update } };
    const service = new MiniService(prisma as never);
    await service.updateGym('gym-1', { name: 'Titan Centro', slug: 'titan-centro', currency: 'CUP' });
    expect(update).toHaveBeenCalledWith({ where: { id: 'gym-1' }, data: { name: 'Titan Centro', slug: 'titan-centro', currency: 'CUP' } });
  });

  it('asigna el gimnasio de la ruta al crear un miembro desde plataforma', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'member-2' });
    const prisma = { gym: { findUnique: jest.fn().mockResolvedValue({ id: 'gym-2' }) }, member: { create } };
    const service = new MiniService(prisma as never);
    await service.createGymMember('gym-2', { ci: '91020212345', firstName: 'Luis', lastName: 'Gómez' });
    expect(create).toHaveBeenCalledWith({ data: { gymId: 'gym-2', ci: '91020212345', firstName: 'Luis', lastName: 'Gómez' } });
  });

  it('impide editar un administrador que pertenece a otro gimnasio', async () => {
    const prisma = { user: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new MiniService(prisma as never);
    await expect(service.updateGymAdmin('gym-1', 'admin-other', { name: 'Otro' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
