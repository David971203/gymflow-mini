import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { GymSubscriptionGuard } from './guards';

describe('GymSubscriptionGuard', () => {
  const context = (method: string, role: UserRole = UserRole.ADMIN) => ({
    switchToHttp: () => ({ getRequest: () => ({ method, user: { id:'user-1', email:'admin@gym.cu', role, gymId: role === UserRole.ADMIN ? 'gym-1' : null } }) }),
  }) as never;

  it('permite consultar aunque la suscripción esté vencida', async () => {
    const findUnique = jest.fn();
    const guard = new GymSubscriptionGuard({ gym: { findUnique } } as never);
    await expect(guard.canActivate(context('GET'))).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('bloquea escrituras de un gimnasio vencido con el mensaje de renovación', async () => {
    const guard = new GymSubscriptionGuard({ gym: { findUnique: jest.fn().mockResolvedValue({ isActive:true, subscriptionEndsAt:new Date(Date.now()-1) }) } } as never);
    await expect(guard.canActivate(context('POST'))).rejects.toEqual(new ForbiddenException('Para continuar debes renovar la membresía de tu gimnasio.'));
  });

  it('bloquea escrituras cuando el gimnasio no tiene membresía', async () => {
    const guard = new GymSubscriptionGuard({ gym: { findUnique: jest.fn().mockResolvedValue({ isActive:true, subscriptionEndsAt:null }) } } as never);
    await expect(guard.canActivate(context('POST'))).rejects.toEqual(new ForbiddenException('Para continuar debes renovar la membresía de tu gimnasio.'));
  });

  it('permite escrituras mientras la suscripción está activa', async () => {
    const guard = new GymSubscriptionGuard({ gym: { findUnique: jest.fn().mockResolvedValue({ isActive:true, subscriptionEndsAt:new Date(Date.now()+60_000) }) } } as never);
    await expect(guard.canActivate(context('PATCH'))).resolves.toBe(true);
  });

  it('no restringe las operaciones del superadministrador', async () => {
    const findUnique = jest.fn();
    const guard = new GymSubscriptionGuard({ gym: { findUnique } } as never);
    await expect(guard.canActivate(context('DELETE',UserRole.SUPER_ADMIN))).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
