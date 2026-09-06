import { membershipDayStart, membershipHasExpired, membershipIsCurrent, nextMembershipDayStart } from './membership-time';

describe('membership calendar rules', () => {
  it('expires for the whole end date regardless of the stored hour', () => {
    const morning = new Date('2026-09-04T05:00:00.000Z');
    const endLaterThatDay = new Date('2026-09-04T22:30:00.000Z');

    expect(membershipHasExpired(endLaterThatDay, morning)).toBe(true);
    expect(membershipIsCurrent(new Date('2026-08-01T15:00:00.000Z'), endLaterThatDay, morning)).toBe(false);
  });

  it('uses the Cuban midnight boundary in daylight and standard time', () => {
    expect(membershipDayStart(new Date('2026-09-04T12:00:00.000Z'))).toEqual(new Date('2026-09-04T04:00:00.000Z'));
    expect(nextMembershipDayStart(new Date('2026-09-04T12:00:00.000Z'))).toEqual(new Date('2026-09-05T04:00:00.000Z'));
    expect(nextMembershipDayStart(new Date('2026-01-04T12:00:00.000Z'))).toEqual(new Date('2026-01-05T05:00:00.000Z'));
  });
});
