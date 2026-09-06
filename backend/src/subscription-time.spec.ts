import { subscriptionExpiresToday, subscriptionExpiryBoundary, subscriptionIsActiveThroughDay } from './subscription-time';

describe('subscription-time', () => {
  const displayedEnd = new Date('2026-09-06T15:30:00.000Z');

  it('mantiene la suscripción activa durante todo el día mostrado en Cuba', () => {
    expect(subscriptionIsActiveThroughDay(displayedEnd, new Date('2026-09-07T03:59:59.000Z'))).toBe(true);
    expect(subscriptionExpiresToday(displayedEnd, new Date('2026-09-07T03:59:59.000Z'))).toBe(true);
  });

  it('vence al comenzar el día siguiente en Cuba', () => {
    expect(subscriptionExpiryBoundary(displayedEnd)).toEqual(new Date('2026-09-07T04:00:00.000Z'));
    expect(subscriptionIsActiveThroughDay(displayedEnd, new Date('2026-09-07T04:00:00.000Z'))).toBe(false);
  });
});
