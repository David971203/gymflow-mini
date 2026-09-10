import { GymSubscriptionPlan } from '@prisma/client';

export const PLATFORM_SUBSCRIPTION_PRICES: Readonly<Record<GymSubscriptionPlan, number>> = {
  [GymSubscriptionPlan.TRIAL]: 0,
  [GymSubscriptionPlan.MONTHLY]: 5000,
  [GymSubscriptionPlan.ANNUAL]: 50000,
};
