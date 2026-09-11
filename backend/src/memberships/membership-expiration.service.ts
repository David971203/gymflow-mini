import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MembershipStatus } from '@prisma/client';
import { nextMembershipDayStart } from './membership-time';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class MembershipExpirationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MembershipExpirationService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.runSafely();
    this.scheduleNextRun();
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }

  async reconcileMembershipStatuses(now = new Date()) {
    const membershipDayBoundary = nextMembershipDayStart(now);
    const expired = await this.prisma.membership.updateMany({
      where: {
        status: { in: [MembershipStatus.ACTIVE, MembershipStatus.SCHEDULED] },
        endDate: { lt: membershipDayBoundary },
      },
      data: { status: MembershipStatus.EXPIRED },
    });
    const activated = await this.prisma.membership.updateMany({
      where: {
        status: MembershipStatus.SCHEDULED,
        startDate: { lt: membershipDayBoundary },
        endDate: { gte: membershipDayBoundary },
      },
      data: { status: MembershipStatus.ACTIVE },
    });
    const inactivated = await this.prisma.member.updateMany({
      where: {
        status: 'ACTIVE',
        AND: [
          { memberships: { some: {} } },
          { memberships: { none: { status: MembershipStatus.ACTIVE, startDate: { lt: membershipDayBoundary }, endDate: { gte: membershipDayBoundary } } } },
        ],
      },
      data: { status: 'INACTIVE' },
    });
    await this.prisma.member.updateMany({
      where: {
        status: 'INACTIVE',
        memberships: { some: { status: MembershipStatus.ACTIVE, startDate: { lt: membershipDayBoundary }, endDate: { gte: membershipDayBoundary } } },
      },
      data: { status: 'ACTIVE' },
    });
    return { expired: expired.count, activated: activated.count, inactivated: inactivated.count };
  }

  private async runSafely() {
    try {
      const result = await this.reconcileMembershipStatuses();
      if (result.expired || result.activated || result.inactivated) this.logger.log(`Membresías actualizadas: ${result.expired} vencidas, ${result.activated} activadas, ${result.inactivated} miembros inactivos`);
    } catch (error) {
      this.logger.error('No se pudieron actualizar los estados de membresía', error instanceof Error ? error.stack : undefined);
    }
  }

  private scheduleNextRun() {
    const now = new Date();
    const nextRun = nextMembershipDayStart(now);
    this.timer = setTimeout(() => {
      void this.runSafely().finally(() => this.scheduleNextRun());
    }, nextRun.getTime() - now.getTime());
    this.timer.unref?.();
  }
}
