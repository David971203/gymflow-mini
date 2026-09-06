import type { Membership } from './types';

export const MEMBERSHIP_TIME_ZONE = 'America/Havana';
const DAY_MS = 86_400_000;

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: MEMBERSHIP_TIME_ZONE,
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: MEMBERSHIP_TIME_ZONE,
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

type DateParts = { year: number; month: number; day: number; hour?: number; minute?: number; second?: number };

function parts(value: Date | string | number, withTime = false): DateParts | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatter = withTime ? dateTimeFormatter : dateFormatter;
  const result = Object.fromEntries(formatter.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return result as DateParts;
}

function dayNumber(value: Date | string | number) {
  const valueParts = parts(value);
  return valueParts ? Date.UTC(valueParts.year, valueParts.month - 1, valueParts.day) / DAY_MS : Number.NaN;
}

function zonedMidnightUtc(year: number, month: number, day: number) {
  const desiredWallTime = Date.UTC(year, month - 1, day);
  let candidate = desiredWallTime;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = parts(new Date(candidate), true);
    if (!actual) return new Date(Number.NaN);
    const actualWallTime = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour ?? 0, actual.minute ?? 0, actual.second ?? 0);
    candidate += desiredWallTime - actualWallTime;
  }
  return new Date(candidate);
}

export function membershipExpiryInstant(value: string) {
  const valueParts = parts(value);
  return valueParts ? zonedMidnightUtc(valueParts.year, valueParts.month, valueParts.day) : new Date(Number.NaN);
}

export function shiftMembershipDayStart(value: string, days: number) {
  const valueParts = parts(value);
  if (!valueParts) return new Date(Number.NaN);
  const shifted = new Date(Date.UTC(valueParts.year, valueParts.month - 1, valueParts.day + days));
  return zonedMidnightUtc(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

export function membershipRemainingDays(endDate: string, now: Date | number = new Date()) {
  const difference = dayNumber(endDate) - dayNumber(now);
  return Number.isFinite(difference) ? Math.max(0, difference) : 0;
}

export function isMembershipDayBefore(value: string, now: Date | number = new Date()) {
  return dayNumber(value) < dayNumber(now);
}

export function isMembershipDayOnOrBefore(value: string, now: Date | number = new Date()) {
  return dayNumber(value) <= dayNumber(now);
}

export function membershipIsCurrent(membership: Partial<Pick<Membership, 'startDate' | 'endDate' | 'status'>>, now: Date | number = new Date()) {
  if (membership.status !== 'ACTIVE' && membership.status !== 'SCHEDULED') return false;
  if (!membership.startDate || !membership.endDate) return false;
  const today = dayNumber(now);
  return dayNumber(membership.startDate) <= today && dayNumber(membership.endDate) > today;
}

export function effectiveMembershipStatus(membership: Pick<Membership, 'startDate' | 'endDate' | 'status'>, now: Date | number = new Date()) {
  const today = dayNumber(now);
  if ((membership.status === 'ACTIVE' || membership.status === 'SCHEDULED') && dayNumber(membership.endDate) <= today) return 'EXPIRED';
  if (membership.status === 'SCHEDULED' && dayNumber(membership.startDate) <= today) return 'ACTIVE';
  return membership.status;
}
