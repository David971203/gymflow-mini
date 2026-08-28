import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MembershipStatus } from '@prisma/client';
import { PrismaService } from './prisma.service';

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
    const expired = await this.prisma.membership.updateMany({
      where: {
        status: { in: [MembershipStatus.ACTIVE, MembershipStatus.SCHEDULED] },
        endDate: { lt: now },
      },
      data: { status: MembershipStatus.EXPIRED },
    });
    const activated = await this.prisma.membership.updateMany({
      where: {
        status: MembershipStatus.SCHEDULED,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      data: { status: MembershipStatus.ACTIVE },
    });
    await this.prisma.member.updateMany({
      where: {
        status: 'INACTIVE',
        memberships: { some: { status: MembershipStatus.ACTIVE, startDate: { lte: now }, endDate: { gte: now } } },
      },
      data: { status: 'ACTIVE' },
    });
    return { expired: expired.count, activated: activated.count };
  }

  private async runSafely() {
    try {
      const result = await this.reconcileMembershipStatuses();
      if (result.expired || result.activated) this.logger.log(`Membresías actualizadas: ${result.expired} vencidas, ${result.activated} activadas`);
    } catch (error) {
      this.logger.error('No se pudieron actualizar los estados de membresía', error instanceof Error ? error.stack : undefined);
    }
  }

  private scheduleNextRun() {
    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setHours(24, 0, 0, 0);
    this.timer = setTimeout(() => {
      void this.runSafely().finally(() => this.scheduleNextRun());
    }, nextRun.getTime() - now.getTime());
    this.timer.unref?.();
  }
}
