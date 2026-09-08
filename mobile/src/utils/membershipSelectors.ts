import { effectiveMembershipStatus, membershipRemainingDays } from '../membershipDates';
import type { Member } from '../types';

export function activeMembership(member: Member) {
  return member.memberships.find((membership) => effectiveMembershipStatus(membership) === 'ACTIVE');
}

export function scheduledMembership(member: Member) {
  return member.memberships.find((membership) => effectiveMembershipStatus(membership) === 'SCHEDULED');
}

export function upcomingMembership(member: Member) {
  if (member.status !== 'ACTIVE') return undefined;
  const membership = activeMembership(member);
  if (!membership) return undefined;
  const days = membershipRemainingDays(membership.endDate);
  return days > 0 && days <= 10 ? membership : undefined;
}

export function editableMembership(member: Member) {
  return activeMembership(member);
}

export function hasExpiredMembership(member: Member) {
  const latest = member.memberships[0];
  return Boolean(latest)
    && effectiveMembershipStatus(latest) === 'EXPIRED'
    && !activeMembership(member)
    && !scheduledMembership(member);
}
