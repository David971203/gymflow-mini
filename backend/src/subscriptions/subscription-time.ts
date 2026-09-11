import { membershipDayStart, nextMembershipDayStart, shiftMembershipDayStart } from '../memberships/membership-time';

/** A subscription remains usable through its displayed expiration day in Cuba. */
export function subscriptionExpiryBoundary(endsAt: Date) {
  return nextMembershipDayStart(endsAt);
}

export function subscriptionIsActiveThroughDay(endsAt: Date | null, now = new Date()) {
  return !!endsAt && subscriptionExpiryBoundary(endsAt) > now;
}

export function subscriptionExpiresToday(endsAt: Date | null, now = new Date()) {
  return !!endsAt && membershipDayStart(endsAt).getTime() === membershipDayStart(now).getTime();
}

export function subscriptionWarningStart(endsAt: Date) {
  return shiftMembershipDayStart(endsAt, -3);
}
