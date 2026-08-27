import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { MiniService } from './mini.service';

describe('MiniService', () => {
  const user = { id: 'admin-1', email: 'admin@gym.cu', role: 'ADMIN' as const, gymId: 'gym-1' };
  const superUser = { id: 'super-1', email: 'super@gym.cu', role: 'SUPER_ADMIN' as const, gymId: null };

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

  it('lista únicamente los planes del gimnasio seleccionado por plataforma', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { gym: { findUnique: jest.fn().mockResolvedValue({ id: 'gym-1' }) }, plan: { findMany } };
    const service = new MiniService(prisma as never);
    await service.listGymPlans('gym-1');
    expect(findMany).toHaveBeenCalledWith({ where: { gymId: 'gym-1' }, orderBy: [{ isActive: 'desc' }, { price: 'asc' }] });
  });

  it('impide editar un plan que pertenece a otro gimnasio', async () => {
    const prisma = { gym: { findUnique: jest.fn().mockResolvedValue({ id: 'gym-1' }) }, plan: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new MiniService(prisma as never);
    await expect(service.updateGymPlan('gym-1', 'plan-other', { name: 'Otro' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('impide asignar una membresía a un miembro de otro gimnasio desde plataforma', async () => {
    const prisma = {
      gym: { findUnique: jest.fn().mockResolvedValue({ id: 'gym-1' }) },
      member: { findFirst: jest.fn().mockResolvedValue(null) },
      membership: { findFirst: jest.fn().mockResolvedValue(null) },
      plan: { findFirst: jest.fn().mockResolvedValue({ id: 'plan-1', gymId: 'gym-1', price: 1000, durationDays: 30 }) },
    };
    const service = new MiniService(prisma as never);
    await expect(service.createGymMembership('gym-1', 'member-other', { planId: 'plan-1' }, superUser)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('impide añadir otra membresía cuando el miembro ya tiene una activa', async () => {
    const prisma = {
      gym: { findUnique: jest.fn().mockResolvedValue({ id: 'gym-1' }) },
      membership: { findFirst: jest.fn().mockResolvedValue({ id: 'membership-active' }) },
    };
    const service = new MiniService(prisma as never);
    await expect(service.createGymMembership('gym-1', 'member-1', { planId: 'plan-1' }, superUser)).rejects.toBeInstanceOf(ConflictException);
  });

  it('impide editar desde móvil una membresía de otro gimnasio', async () => {
    const prisma = { membership: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new MiniService(prisma as never);
    await expect(service.updateMembership('membership-other', { status: 'CANCELLED' as never }, user)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('protege al único administrador activo del gimnasio', async () => {
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'admin-1', isActive: true }), count: jest.fn().mockResolvedValue(0) },
    };
    const service = new MiniService(prisma as never);
    await expect(service.deleteGymAdmin('gym-1', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('archiva un plan utilizado para conservar el historial de membresías', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'plan-1', isActive: false });
    const remove = jest.fn();
    const prisma = {
      gym: { findUnique: jest.fn().mockResolvedValue({ id: 'gym-1' }) },
      plan: { findFirst: jest.fn().mockResolvedValue({ id: 'plan-1' }), update, delete: remove },
      membership: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(2) },
    };
    const service = new MiniService(prisma as never);
    await expect(service.deleteGymPlan('gym-1', 'plan-1')).resolves.toEqual({ id: 'plan-1', disposition: 'ARCHIVED' });
    expect(update).toHaveBeenCalledWith({ where: { id: 'plan-1' }, data: { isActive: false } });
    expect(remove).not.toHaveBeenCalled();
  });

  it('impide eliminar un plan que tiene una membresía activa vigente', async () => {
    const update = jest.fn();
    const remove = jest.fn();
    const prisma = {
      gym: { findUnique: jest.fn().mockResolvedValue({ id: 'gym-1' }) },
      plan: { findFirst: jest.fn().mockResolvedValue({ id: 'plan-1' }), update, delete: remove },
      membership: { findFirst: jest.fn().mockResolvedValue({ id: 'membership-active' }), count: jest.fn() },
    };
    const service = new MiniService(prisma as never);
    await expect(service.deleteGymPlan('gym-1', 'plan-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.membership.count).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('elimina físicamente un miembro sin historial financiero', async () => {
    const remove = jest.fn().mockResolvedValue({ id: 'member-1' });
    const prisma = {
      member: { findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }), delete: remove },
      membership: { count: jest.fn().mockResolvedValue(0) },
      payment: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new MiniService(prisma as never);
    await expect(service.deleteGymMember('gym-1', 'member-1')).resolves.toEqual({ id: 'member-1', disposition: 'DELETED' });
    expect(remove).toHaveBeenCalledWith({ where: { id: 'member-1' } });
  });

  it('impide eliminar desde móvil un miembro de otro gimnasio', async () => {
    const prisma = { member: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new MiniService(prisma as never);
    await expect(service.deleteMember('member-other', user)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lista los cobros exclusivamente para el gimnasio seleccionado', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { gym: { findUnique: jest.fn().mockResolvedValue({ id: 'gym-2' }) }, payment: { updateMany, findMany } };
    const service = new MiniService(prisma as never);
    await service.listGymPayments('gym-2');
    expect(updateMany.mock.calls[0][0].where.gymId).toBe('gym-2');
    expect(findMany.mock.calls[0][0].where).toEqual({ gymId: 'gym-2' });
  });

  it('calcula el resumen financiero sin contar cobros cancelados como deuda', async () => {
    const prisma = {
      gym: { findUnique: jest.fn().mockResolvedValue({ id: 'gym-1' }) },
      payment: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), findMany: jest.fn().mockResolvedValue([
        { amount: 1000, paidAmount: 250, status: PaymentStatus.PARTIAL },
        { amount: 500, paidAmount: 0, status: PaymentStatus.OVERDUE },
        { amount: 300, paidAmount: 0, status: PaymentStatus.CANCELLED },
      ]) },
      paymentMovement: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 250 } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new MiniService(prisma as never);
    await expect(service.getGymFinances('gym-1')).resolves.toMatchObject({
      totalBilled: 1800,
      totalCollected: 250,
      pendingBalance: 1250,
      overdueBalance: 500,
      monthlyRevenue: 250,
      pendingPayments: 2,
    });
  });
});
