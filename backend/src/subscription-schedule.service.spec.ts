import { GymSubscriptionPlan } from '@prisma/client';
import { SubscriptionScheduleService } from './subscription-schedule.service';

describe('SubscriptionScheduleService', () => {
  it('activa un cambio programado cuando llega su fecha', async () => {
    const startsAt = new Date('2026-09-07T04:00:00.000Z');
    const endsAt = new Date('2026-10-07T04:00:00.000Z');
    const updateMany = jest.fn().mockResolvedValue({count:1});
    const service = new SubscriptionScheduleService({gym:{findUnique:jest.fn().mockResolvedValue({scheduledSubscriptionPlan:GymSubscriptionPlan.MONTHLY,scheduledSubscriptionStartsAt:startsAt,scheduledSubscriptionEndsAt:endsAt}),updateMany}} as never);

    await expect(service.activateDue('gym-1',startsAt)).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({where:{id:'gym-1',scheduledSubscriptionPlan:GymSubscriptionPlan.MONTHLY,scheduledSubscriptionStartsAt:startsAt},data:{subscriptionPlan:GymSubscriptionPlan.MONTHLY,subscriptionStartedAt:startsAt,subscriptionEndsAt:endsAt,scheduledSubscriptionPlan:null,scheduledSubscriptionStartsAt:null,scheduledSubscriptionEndsAt:null,subscriptionWarningSentFor:null,subscriptionExpiredSentFor:null}});
  });
});
