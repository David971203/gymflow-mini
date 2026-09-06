import { MembershipStatus } from '@prisma/client';
import { MembershipExpirationService } from './membership-expiration.service';

describe('MembershipExpirationService', () => {
  it('expires ended memberships and activates scheduled memberships that started', async () => {
    const updateMany = jest.fn().mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 1 });
    const memberUpdateMany = jest.fn().mockResolvedValueOnce({ count:2 }).mockResolvedValueOnce({ count:1 });
    const service = new MembershipExpirationService({ membership: { updateMany }, member:{ updateMany:memberUpdateMany } } as never);
    const now = new Date('2026-08-27T12:00:00.000Z');
    const nextDay = new Date('2026-08-28T04:00:00.000Z');

    await expect(service.reconcileMembershipStatuses(now)).resolves.toEqual({ expired:2, activated:1, inactivated:2 });
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { status: { in: [MembershipStatus.ACTIVE, MembershipStatus.SCHEDULED] }, endDate: { lt: nextDay } },
      data: { status: MembershipStatus.EXPIRED },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { status: MembershipStatus.SCHEDULED, startDate: { lt: nextDay }, endDate: { gte: nextDay } },
      data: { status: MembershipStatus.ACTIVE },
    });
    expect(memberUpdateMany).toHaveBeenNthCalledWith(1, {
      where:{ status:'ACTIVE', AND:[
        { memberships:{ some:{} } },
        { memberships:{ none:{ status:MembershipStatus.ACTIVE, startDate:{ lt:nextDay }, endDate:{ gte:nextDay } } } },
      ] },
      data:{ status:'INACTIVE' },
    });
    expect(memberUpdateMany).toHaveBeenNthCalledWith(2, {
      where:{ status:'INACTIVE', memberships:{ some:{ status:MembershipStatus.ACTIVE, startDate:{ lt:nextDay }, endDate:{ gte:nextDay } } } },
      data:{ status:'ACTIVE' },
    });
  });
});
