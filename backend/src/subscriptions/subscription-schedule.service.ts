import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class SubscriptionScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async activateDue(gymId: string, now = new Date()) {
    const gym = await this.prisma.gym.findUnique({
      where: { id: gymId },
      select: { scheduledSubscriptionPlan: true, scheduledSubscriptionStartsAt: true, scheduledSubscriptionEndsAt: true },
    });
    if (!gym?.scheduledSubscriptionPlan || !gym.scheduledSubscriptionStartsAt || !gym.scheduledSubscriptionEndsAt || gym.scheduledSubscriptionStartsAt > now) return false;
    const activated = await this.prisma.gym.updateMany({
      where: { id: gymId, scheduledSubscriptionPlan: gym.scheduledSubscriptionPlan, scheduledSubscriptionStartsAt: gym.scheduledSubscriptionStartsAt },
      data: {
        subscriptionPlan: gym.scheduledSubscriptionPlan,
        subscriptionStartedAt: gym.scheduledSubscriptionStartsAt,
        subscriptionEndsAt: gym.scheduledSubscriptionEndsAt,
        scheduledSubscriptionPlan: null,
        scheduledSubscriptionStartsAt: null,
        scheduledSubscriptionEndsAt: null,
        subscriptionWarningSentFor: null,
        subscriptionExpiredSentFor: null,
      },
    });
    return activated.count === 1;
  }
}
