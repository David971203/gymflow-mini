import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { GymSubscriptionGuard } from './auth.guards';

describe('GymSubscriptionGuard', () => {
  const createGuard = (prisma: unknown) => new GymSubscriptionGuard(prisma as never, { getAllAndOverride: () => false } as never);
  const context = (method: string, role: UserRole = UserRole.ADMIN) => ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ method, user: { id:'user-1', email:'admin@gym.cu', role, gymId: role === UserRole.SUPER_ADMIN ? null : 'gym-1' } }) }),
  }) as never;

  it('permite consultar aunque la suscripción esté vencida', async () => {
    const findUnique = jest.fn().mockResolvedValue({ isActive:true, subscriptionPlan:'MONTHLY', subscriptionEndsAt:new Date(Date.now()-1) });
    const guard = createGuard({ gym: { findUnique } });
    await expect(guard.canActivate(context('GET'))).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalled();
  });

  it('bloquea incluso las consultas hasta que el nuevo gimnasio elige una oferta', async () => {
    const guard = createGuard({ gym: { findUnique:jest.fn().mockResolvedValue({ isActive:true, subscriptionPlan:null, subscriptionEndsAt:null }) } });
    await expect(guard.canActivate(context('GET'))).rejects.toEqual(new ForbiddenException('Elige una prueba o solicita un plan para acceder a GymFlow Mini.'));
  });

  it('bloquea escrituras de un gimnasio vencido con el mensaje de renovación', async () => {
    const guard = createGuard({ gym: { findUnique: jest.fn().mockResolvedValue({ isActive:true, subscriptionEndsAt:new Date(Date.now()-48*60*60*1000) }) } });
    await expect(guard.canActivate(context('POST'))).rejects.toEqual(new ForbiddenException('Para continuar debes renovar la suscripción de tu gimnasio.'));
  });

  it('bloquea escrituras cuando el gimnasio no tiene suscripción', async () => {
    const guard = createGuard({ gym: { findUnique: jest.fn().mockResolvedValue({ isActive:true, subscriptionEndsAt:null }) } });
    await expect(guard.canActivate(context('POST'))).rejects.toEqual(new ForbiddenException('Para continuar debes renovar la suscripción de tu gimnasio.'));
  });

  it('permite escrituras mientras la suscripción está activa', async () => {
    const guard = createGuard({ gym: { findUnique: jest.fn().mockResolvedValue({ isActive:true, subscriptionEndsAt:new Date(Date.now()+60_000) }) } });
    await expect(guard.canActivate(context('PATCH'))).resolves.toBe(true);
  });

  it('permite escrituras durante todo el día indicado como vencimiento', async () => {
    const guard = createGuard({ gym: { findUnique: jest.fn().mockResolvedValue({ isActive:true, subscriptionEndsAt:new Date(Date.now()-1) }) } });
    await expect(guard.canActivate(context('POST'))).resolves.toBe(true);
  });

  it('no restringe las operaciones del superadministrador', async () => {
    const findUnique = jest.fn();
    const guard = createGuard({ gym: { findUnique } });
    await expect(guard.canActivate(context('DELETE',UserRole.SUPER_ADMIN))).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('aplica la suscripción del gimnasio a las recepcionistas', async () => {
    const findUnique = jest.fn().mockResolvedValue({ isActive:true, subscriptionPlan:'MONTHLY', subscriptionEndsAt:new Date(Date.now()-48*60*60*1000) });
    const guard = createGuard({ gym:{ findUnique } });
    await expect(guard.canActivate(context('POST',UserRole.RECEPTIONIST))).rejects.toEqual(new ForbiddenException('Para continuar debes renovar la suscripción de tu gimnasio.'));
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where:{ id:'gym-1' } }));
  });
});
