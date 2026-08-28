import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { GymSubscriptionPlan, MembershipStatus, PaymentStatus, Prisma } from '@prisma/client';
import { MiniService } from './mini.service';

describe('MiniService', () => {
  const user = { id: 'admin-1', email: 'admin@gym.cu', role: 'ADMIN' as const, gymId: 'gym-1' };
  const superUser = { id: 'super-1', email: 'super@gym.cu', role: 'SUPER_ADMIN' as const, gymId: null };

  it('siempre asigna el tenant autenticado al crear un miembro', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'member-1' });
    const service = new MiniService({ member: { create } } as never);
    await service.createMember({ ci: '90010112345', code: 'SOC-001', firstName: 'Ana', lastName: 'Pérez', age: 29, sex: 'FEMALE' }, user);
    expect(create).toHaveBeenCalledWith({ data: { ci: '90010112345', code: 'SOC-001', firstName: 'Ana', lastName: 'Pérez', age: 29, sex: 'FEMALE', gymId: 'gym-1' } });
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

  it('rechaza códigos internos repetidos dentro del gimnasio', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target: ['gymId', 'code'] },
    });
    const service = new MiniService({ member: { create: jest.fn().mockRejectedValue(duplicate) } } as never);
    await expect(
      service.createMember({ ci: '90010112346', code: 'SOC-001', firstName: 'Leo', lastName: 'Díaz' }, user),
    ).rejects.toThrow('Ya existe un miembro con ese código interno en el gimnasio');
  });

  it('rechaza un abono inicial superior al precio del plan', async () => {
    const prisma = {
      member: { findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }) },
      plan: { findFirst: jest.fn().mockResolvedValue({ id: 'plan-1', price: 1000, durationDays: 30 }) },
    };
    const service = new MiniService(prisma as never);
    await expect(service.createMembership({ memberId: 'member-1', planId: 'plan-1', initialPayment: 1001 }, user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('multiplica precio y duración al prepagar varios períodos', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-28T12:00:00.000Z'));
    try {
      const membershipCreate = jest.fn().mockImplementation(({ data }) => ({ ...data }));
      const paymentCreate = jest.fn().mockImplementation(({ data }) => ({ id:'payment-1', ...data }));
      const memberUpdate = jest.fn().mockResolvedValue({ id:'member-1', status:'ACTIVE' });
      const tx = {
        member: { update:memberUpdate },
        membership: { updateMany:jest.fn(), findFirst:jest.fn().mockResolvedValue(null), create:membershipCreate, findUniqueOrThrow:jest.fn().mockResolvedValue({ id:'membership-1' }) },
        payment: { create:paymentCreate },
        paymentMovement: { create:jest.fn() },
      };
      const prisma = {
        member: { findFirst:jest.fn().mockResolvedValue({ id:'member-1', status:'INACTIVE' }) },
        plan: { findFirst:jest.fn().mockResolvedValue({ id:'plan-1', name:'Mensual original', price:1000, durationDays:30 }) },
        $transaction:jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
      };
      const service = new MiniService(prisma as never);
      await service.createMembership({ memberId:'member-1', planId:'plan-1', periodCount:3 }, user);
      expect(prisma.member.findFirst).toHaveBeenCalledWith({ where:{ id:'member-1', gymId:'gym-1' } });
      expect(membershipCreate).toHaveBeenCalledWith({ data:expect.objectContaining({
        periodCount:3,
        planName:'Mensual original',
        planPrice:1000,
        planDurationDays:30,
        startDate:new Date('2026-08-28T12:00:00.000Z'),
      }) });
      const endDate = membershipCreate.mock.calls[0][0].data.endDate as Date;
      expect([endDate.getFullYear(), endDate.getMonth(), endDate.getDate()]).toEqual([2026, 10, 26]);
      expect(paymentCreate).toHaveBeenCalledWith({ data:expect.objectContaining({ amount:3000 }) });
      expect(memberUpdate).toHaveBeenCalledWith({ where:{ id:'member-1' }, data:{ status:'ACTIVE' } });
    } finally { jest.useRealTimers(); }
  });

  it('rechaza cantidades superiores a 24 períodos', async () => {
    const prisma = {
      member: { findFirst:jest.fn().mockResolvedValue({ id:'member-1' }) },
      plan: { findFirst:jest.fn().mockResolvedValue({ id:'plan-1', price:1000, durationDays:30 }) },
    };
    const service = new MiniService(prisma as never);
    await expect(service.createMembership({ memberId:'member-1', planId:'plan-1', periodCount:25 }, user)).rejects.toThrow('La cantidad de períodos debe ser un número entero entre 1 y 24');
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

  it('lista el historial completo de suscripciones de la plataforma', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new MiniService({ platformSubscription:{ findMany } } as never);
    await service.listPlatformSubscriptions();
    expect(findMany).toHaveBeenCalledWith({
      include:{ gym:{ select:{ id:true, name:true, slug:true } } },
      orderBy:{ activatedAt:'desc' },
    });
  });

  it('impide editar un plan que pertenece a otro gimnasio', async () => {
    const prisma = { gym: { findUnique: jest.fn().mockResolvedValue({ id: 'gym-1' }) }, plan: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new MiniService(prisma as never);
    await expect(service.updateGymPlan('gym-1', 'plan-other', { name: 'Otro' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('impide eliminar desde móvil un plan de otro gimnasio', async () => {
    const prisma = { gym: { findUnique: jest.fn().mockResolvedValue({ id: 'gym-1' }) }, plan: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new MiniService(prisma as never);
    await expect(service.deletePlan('plan-other', user)).rejects.toBeInstanceOf(NotFoundException);
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

  it('impide cambiar el plan mientras la membresía continúa activa', async () => {
    const prisma = {
      gym: { findUnique: jest.fn().mockResolvedValue({ id: 'gym-1' }) },
      membership: { findFirst: jest.fn().mockResolvedValue({ id:'membership-1', planId:'plan-1', status:MembershipStatus.ACTIVE, endDate:new Date(Date.now() + 86400000) }) },
      plan: { findFirst: jest.fn() },
    };
    const service = new MiniService(prisma as never);
    await expect(service.updateGymMembership('gym-1', 'member-1', 'membership-1', { planId:'plan-2' })).rejects.toThrow('No se puede cambiar el plan de una membresía mientras esté activa');
    expect(prisma.plan.findFirst).not.toHaveBeenCalled();
  });

  it('permite cancelar una membresía activa sin cambiar su plan', async () => {
    const current = { id:'membership-1', planId:'plan-1', status:MembershipStatus.ACTIVE, startDate:new Date(), endDate:new Date(Date.now() + 86400000), member:{ status:'ACTIVE' }, payment:null };
    const updated = { ...current, status:MembershipStatus.CANCELLED };
    const memberUpdateMany = jest.fn().mockResolvedValue({ count:1 });
    const tx = { member:{ updateMany:memberUpdateMany }, membership: { update: jest.fn().mockResolvedValue(updated), findUniqueOrThrow: jest.fn().mockResolvedValue(updated) } };
    const prisma = {
      gym: { findUnique: jest.fn().mockResolvedValue({ id:'gym-1' }) },
      membership: { findFirst: jest.fn().mockResolvedValue(current) },
      plan: { findFirst: jest.fn().mockResolvedValue({ id:'plan-1', price:1000, durationDays:30 }) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new MiniService(prisma as never);
    await expect(service.updateGymMembership('gym-1', 'member-1', 'membership-1', { planId:'plan-1', status:MembershipStatus.CANCELLED })).resolves.toMatchObject({ status:MembershipStatus.CANCELLED });
    expect(memberUpdateMany).toHaveBeenCalledWith({
      where:{ id:'member-1', memberships:{ none:{ status:MembershipStatus.ACTIVE, endDate:{ gte:expect.any(Date) } } } },
      data:{ status:'INACTIVE' },
    });
  });

  it('elimina desde móvil solamente una renovación programada del gimnasio autenticado', async () => {
    const prisma = { membership: { findFirst: jest.fn().mockResolvedValue({ memberId:'member-1', status:MembershipStatus.SCHEDULED }) } };
    const service = new MiniService(prisma as never);
    const remove = jest.spyOn(service, 'deleteGymMembership').mockResolvedValue({ id:'membership-1', disposition:'DELETED' });

    await expect(service.deleteMembership('membership-1', user)).resolves.toEqual({ id:'membership-1', disposition:'DELETED' });
    expect(prisma.membership.findFirst).toHaveBeenCalledWith({ where:{ id:'membership-1', member:{ gymId:'gym-1' } }, select:{ memberId:true, status:true } });
    expect(remove).toHaveBeenCalledWith('gym-1', 'member-1', 'membership-1');
  });

  it('impide eliminar desde móvil una membresía que no está programada', async () => {
    const prisma = { membership: { findFirst: jest.fn().mockResolvedValue({ memberId:'member-1', status:MembershipStatus.ACTIVE }) } };
    const service = new MiniService(prisma as never);

    await expect(service.deleteMembership('membership-1', user)).rejects.toBeInstanceOf(BadRequestException);
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

  it('archiva al miembro y cancela su membresía y cobro sin borrar el historial', async () => {
    const memberUpdate = jest.fn().mockResolvedValue({ id:'member-1', status:'INACTIVE' });
    const membershipUpdateMany = jest.fn().mockResolvedValue({ count:2 });
    const paymentUpdateMany = jest.fn().mockResolvedValue({ count:2 });
    const remove = jest.fn();
    const tx = {
      member: { update:memberUpdate },
      membership: { updateMany:membershipUpdateMany },
      payment: { updateMany:paymentUpdateMany },
    };
    const prisma = {
      member: { findFirst:jest.fn().mockResolvedValue({ id:'member-1' }), delete:remove },
      membership: {
        count:jest.fn().mockResolvedValue(2),
        findMany:jest.fn().mockResolvedValue([{ id:'membership-active' }, { id:'membership-scheduled' }]),
      },
      payment: { count:jest.fn().mockResolvedValue(2) },
      $transaction:jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new MiniService(prisma as never);

    await expect(service.deleteGymMember('gym-1', 'member-1')).resolves.toEqual({ id:'member-1', disposition:'ARCHIVED' });
    expect(prisma.membership.findMany).toHaveBeenCalledWith({
      where:{ memberId:'member-1', status:{ in:[MembershipStatus.ACTIVE, MembershipStatus.SCHEDULED] } },
      select:{ id:true },
    });
    expect(paymentUpdateMany).toHaveBeenCalledWith({
      where:{ gymId:'gym-1', memberId:'member-1', membershipId:{ in:['membership-active', 'membership-scheduled'] } },
      data:{ status:PaymentStatus.CANCELLED },
    });
    expect(membershipUpdateMany).toHaveBeenCalledWith({
      where:{ id:{ in:['membership-active', 'membership-scheduled'] }, memberId:'member-1' },
      data:{ status:MembershipStatus.CANCELLED },
    });
    expect(memberUpdate).toHaveBeenCalledWith({ where:{ id:'member-1' }, data:{ status:'INACTIVE' } });
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
        { amount: 300, paidAmount: 100, status: PaymentStatus.CANCELLED },
      ]) },
      paymentMovement: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 250 } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new MiniService(prisma as never);
    await expect(service.getGymFinances('gym-1')).resolves.toMatchObject({
      totalBilled: 1500,
      totalCollected: 250,
      pendingBalance: 1250,
      overdueBalance: 500,
      monthlyRevenue: 250,
      pendingPayments: 2,
    });
  });

  it('resume las suscripciones e ingresos propios de GymFlow Mini', async () => {
    const gymCount = jest.fn();
    [3,3,1,1,1,0,0].forEach(value => gymCount.mockResolvedValueOnce(value));
    const memberCount = jest.fn();
    [341,38,21,28,25,31,34,38].forEach(value => memberCount.mockResolvedValueOnce(value));
    const subscriptionAggregate = jest.fn()
      .mockResolvedValueOnce({ _sum:{ amount:55000 } })
      .mockResolvedValueOnce({ _sum:{ amount:105000 } });
    const service = new MiniService({
      gym:{ count:gymCount },
      member:{ count:memberCount },
      paymentMovement:{ aggregate:jest.fn().mockResolvedValue({ _sum:{ amount:98050 } }) },
      payment:{ findMany:jest.fn().mockResolvedValue([{ amount:15000, paidAmount:2700 }]) },
      platformSubscription:{ aggregate:subscriptionAggregate },
    } as never);
    await expect(service.platformOverview()).resolves.toMatchObject({
      gyms:3,
      activeGyms:3,
      subscriptionMonthlyRevenue:55000,
      subscriptionTotalRevenue:105000,
      activeTrialSubscriptions:1,
      activeMonthlySubscriptions:1,
      activeAnnualSubscriptions:1,
      expiredSubscriptions:0,
      withoutSubscriptions:0,
    });
  });

  it('renueva desde hoy una suscripción vencida', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-27T12:00:00.000Z'));
    try {
      const update = jest.fn().mockImplementation(({ data }) => ({ id:'gym-1', ...data }));
      const create = jest.fn().mockResolvedValue({ id:'subscription-1' });
      const transaction = jest.fn().mockImplementation(async callback => callback({ gym:{ update }, platformSubscription:{ create } }));
      const service = new MiniService({ gym: { findUnique: jest.fn().mockResolvedValue({ id:'gym-1', subscriptionTrialDays:7, subscriptionEndsAt:new Date('2026-08-20T12:00:00.000Z') }) }, $transaction:transaction } as never);
      await service.renewGymSubscription('gym-1',GymSubscriptionPlan.MONTHLY);
      expect(update).toHaveBeenCalledWith({ where:{ id:'gym-1' }, data:{ subscriptionPlan:GymSubscriptionPlan.MONTHLY, subscriptionTrialDays:7, subscriptionStartedAt:new Date('2026-08-27T12:00:00.000Z'), subscriptionEndsAt:new Date('2026-09-27T12:00:00.000Z') } });
      expect(create).toHaveBeenCalledWith({ data:{ gymId:'gym-1', plan:GymSubscriptionPlan.MONTHLY, amount:5000, startedAt:new Date('2026-08-27T12:00:00.000Z'), endsAt:new Date('2026-09-27T12:00:00.000Z') } });
    } finally { jest.useRealTimers(); }
  });

  it('extiende desde el vencimiento una suscripción que todavía está activa', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-27T12:00:00.000Z'));
    try {
      const update = jest.fn().mockImplementation(({ data }) => ({ id:'gym-1', ...data }));
      const create = jest.fn().mockResolvedValue({ id:'subscription-1' });
      const transaction = jest.fn().mockImplementation(async callback => callback({ gym:{ update }, platformSubscription:{ create } }));
      const service = new MiniService({ gym: { findUnique: jest.fn().mockResolvedValue({ id:'gym-1', subscriptionEndsAt:new Date('2026-09-10T12:00:00.000Z') }) }, $transaction:transaction } as never);
      await service.renewGymSubscription('gym-1',GymSubscriptionPlan.ANNUAL);
      expect(update.mock.calls[0][0].data.subscriptionStartedAt).toEqual(new Date('2026-09-10T12:00:00.000Z'));
      expect(update.mock.calls[0][0].data.subscriptionEndsAt).toEqual(new Date('2027-09-10T12:00:00.000Z'));
      expect(create.mock.calls[0][0].data.amount).toBe(50000);
    } finally { jest.useRealTimers(); }
  });

  it('permite configurar los días al asignar una prueba gratuita', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-27T12:00:00.000Z'));
    try {
      const update = jest.fn().mockImplementation(({ data }) => ({ id:'gym-1', ...data }));
      const create = jest.fn().mockResolvedValue({ id:'subscription-1' });
      const transaction = jest.fn().mockImplementation(async callback => callback({ gym:{ update }, platformSubscription:{ create } }));
      const service = new MiniService({ gym: { findUnique: jest.fn().mockResolvedValue({ id:'gym-1', subscriptionTrialDays:7, subscriptionEndsAt:new Date('2026-08-20T12:00:00.000Z') }) }, $transaction:transaction } as never);
      await service.renewGymSubscription('gym-1',GymSubscriptionPlan.TRIAL,14);
      expect(update).toHaveBeenCalledWith({ where:{ id:'gym-1' }, data:{ subscriptionPlan:GymSubscriptionPlan.TRIAL, subscriptionTrialDays:14, subscriptionStartedAt:new Date('2026-08-27T12:00:00.000Z'), subscriptionEndsAt:new Date('2026-09-10T12:00:00.000Z') } });
      expect(create.mock.calls[0][0].data.amount).toBe(0);
    } finally { jest.useRealTimers(); }
  });

  it('elimina la membresía actual sin borrar su historial', async () => {
    const update = jest.fn().mockResolvedValue({ id:'gym-1', subscriptionPlan:null, subscriptionStartedAt:null, subscriptionEndsAt:null });
    const service = new MiniService({ gym:{ findUnique:jest.fn().mockResolvedValue({ id:'gym-1' }), update } } as never);
    await expect(service.removeGymSubscription('gym-1')).resolves.toMatchObject({ subscriptionPlan:null, subscriptionEndsAt:null });
    expect(update).toHaveBeenCalledWith({ where:{ id:'gym-1' }, data:{ subscriptionPlan:null, subscriptionStartedAt:null, subscriptionEndsAt:null } });
  });
});
