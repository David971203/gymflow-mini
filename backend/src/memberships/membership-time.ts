export const MEMBERSHIP_TIME_ZONE = 'America/Havana';

const formatter = new Intl.DateTimeFormat('en-US', {
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

type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function parts(value: Date): DateParts {
  const result = Object.fromEntries(formatter.formatToParts(value).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return result as DateParts;
}

function zonedMidnightUtc(year: number, month: number, day: number) {
  const desiredWallTime = Date.UTC(year, month - 1, day);
  let candidate = desiredWallTime;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = parts(new Date(candidate));
    const actualWallTime = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    candidate += desiredWallTime - actualWallTime;
  }
  return new Date(candidate);
}

/** Beginning of the next Cuban calendar day. A membership whose endDate is before
 * this boundary expires for the entire current day, regardless of its stored hour. */
export function nextMembershipDayStart(now = new Date()) {
  const current = parts(now);
  const next = new Date(Date.UTC(current.year, current.month - 1, current.day + 1));
  return zonedMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

export function membershipDayStart(now = new Date()) {
  const current = parts(now);
  return zonedMidnightUtc(current.year, current.month, current.day);
}

export function shiftMembershipDayStart(value: Date, days: number) {
  const current = parts(value);
  const shifted = new Date(Date.UTC(current.year, current.month - 1, current.day + days));
  return zonedMidnightUtc(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

export function membershipIsCurrent(startDate: Date, endDate: Date, now = new Date()) {
  const nextDay = nextMembershipDayStart(now);
  return startDate < nextDay && endDate >= nextDay;
}

export function membershipHasExpired(endDate: Date, now = new Date()) {
  return endDate < nextMembershipDayStart(now);
}
