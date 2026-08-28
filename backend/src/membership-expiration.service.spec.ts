import { MembershipStatus } from '@prisma/client';
import { MembershipExpirationService } from './membership-expiration.service';

describe('MembershipExpirationService', () => {
  it('expires ended memberships and activates scheduled memberships that started', async () => {
    const updateMany = jest.fn().mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 1 });
    const memberUpdateMany = jest.fn().mockResolvedValue({ count:1 });
    const service = new MembershipExpirationService({ membership: { updateMany }, member:{ updateMany:memberUpdateMany } } as never);
    const now = new Date('2026-08-27T12:00:00.000Z');

    await expect(service.reconcileMembershipStatuses(now)).resolves.toEqual({ expired: 2, activated: 1 });
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { status: { in: [MembershipStatus.ACTIVE, MembershipStatus.SCHEDULED] }, endDate: { lt: now } },
      data: { status: MembershipStatus.EXPIRED },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { status: MembershipStatus.SCHEDULED, startDate: { lte: now }, endDate: { gte: now } },
      data: { status: MembershipStatus.ACTIVE },
    });
    expect(memberUpdateMany).toHaveBeenCalledWith({
      where:{ status:'INACTIVE', memberships:{ some:{ status:MembershipStatus.ACTIVE, startDate:{ lte:now }, endDate:{ gte:now } } } },
      data:{ status:'ACTIVE' },
    });
  });
});
