import { SubscriptionExpirationService } from './subscription-expiration.service';

describe('SubscriptionExpirationService', () => {
  const now = new Date('2026-09-05T12:00:00.000Z');

  function setup(gym: Record<string, unknown>) {
    const prisma = {
      gym:{
        findMany:jest.fn().mockResolvedValue([{
          id:'gym-1',
          name:'Titan Gym',
          subscriptionEndsAt:new Date('2026-09-08T12:00:00.000Z'),
          subscriptionWarningSentFor:null,
          subscriptionExpiredSentFor:null,
          users:[{ email:'admin@gym.cu', name:'Ana' }],
          ...gym,
        }]),
        update:jest.fn().mockResolvedValue({}),
      },
    };
    const mail = { sendSubscriptionExpiryNotice:jest.fn().mockResolvedValue(undefined) };
    return { service:new SubscriptionExpirationService(prisma as never, mail as never), prisma, mail };
  }

  it('envía el aviso tres días antes y registra la fecha para no duplicarlo', async () => {
    const { service, prisma, mail } = setup({});

    await expect(service.processDueNotifications(now)).resolves.toEqual({ warnings:1, expired:0 });
    expect(mail.sendSubscriptionExpiryNotice).toHaveBeenCalledWith(expect.objectContaining({ to:'admin@gym.cu', stage:'WARNING' }));
    expect(prisma.gym.update).toHaveBeenCalledWith(expect.objectContaining({ data:{ subscriptionWarningSentFor:new Date('2026-09-08T12:00:00.000Z') } }));
  });

  it('envía el aviso de suscripción vencida al comenzar el día posterior al indicado', async () => {
    const endsAt = new Date('2026-09-04T11:00:00.000Z');
    const { service, prisma, mail } = setup({ subscriptionEndsAt:endsAt, subscriptionWarningSentFor:endsAt });

    await expect(service.processDueNotifications(now)).resolves.toEqual({ warnings:0, expired:1 });
    expect(mail.sendSubscriptionExpiryNotice).toHaveBeenCalledWith(expect.objectContaining({ stage:'EXPIRED', endsAt }));
    expect(prisma.gym.update).toHaveBeenCalledWith(expect.objectContaining({ data:{ subscriptionExpiredSentFor:endsAt } }));
  });

  it('no repite un correo ya enviado para la misma fecha de vencimiento', async () => {
    const endsAt = new Date('2026-09-08T12:00:00.000Z');
    const { service, prisma, mail } = setup({ subscriptionEndsAt:endsAt, subscriptionWarningSentFor:endsAt });

    await expect(service.processDueNotifications(now)).resolves.toEqual({ warnings:0, expired:0 });
    expect(mail.sendSubscriptionExpiryNotice).not.toHaveBeenCalled();
    expect(prisma.gym.update).not.toHaveBeenCalled();
  });

  it('no marca el aviso como enviado cuando falla el correo', async () => {
    const { service, prisma, mail } = setup({});
    mail.sendSubscriptionExpiryNotice.mockRejectedValueOnce(new Error('Proveedor no disponible'));

    await expect(service.processDueNotifications(now)).resolves.toEqual({ warnings:0, expired:0 });
    expect(prisma.gym.update).not.toHaveBeenCalled();
  });
});
