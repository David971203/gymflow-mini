import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../database/prisma.service';
import { subscriptionExpiryBoundary, subscriptionWarningStart } from './subscription-time';
import { SubscriptionScheduleService } from './subscription-schedule.service';

const WARNING_QUERY_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

@Injectable()
export class SubscriptionExpirationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubscriptionExpirationService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaService, private readonly mail: MailService, private readonly subscriptionSchedule?: SubscriptionScheduleService) {}

  async onModuleInit() {
    await this.runSafely();
    this.timer = setInterval(() => void this.runSafely(), CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async processDueNotifications(now = new Date()) {
    const warningLimit = new Date(now.getTime() + WARNING_QUERY_WINDOW_MS);
    const gyms = await this.prisma.gym.findMany({
      where: {
        isActive:true,
        subscriptionPlan:{ not:null },
        subscriptionEndsAt:{ lte:warningLimit },
      },
      select: {
        id:true,
        name:true,
        subscriptionEndsAt:true,
        subscriptionWarningSentFor:true,
        subscriptionExpiredSentFor:true,
        scheduledSubscriptionStartsAt:true,
        users:{
          where:{ role:UserRole.ADMIN, isActive:true },
          select:{ email:true, name:true },
        },
      },
    });

    let warnings = 0;
    let expired = 0;
    for (const gym of gyms) {
      if (gym.scheduledSubscriptionStartsAt && gym.scheduledSubscriptionStartsAt <= now) {
        await this.subscriptionSchedule?.activateDue(gym.id, now);
        continue;
      }
      const endsAt = gym.subscriptionEndsAt;
      if (!endsAt || !gym.users.length) continue;
      const expiryBoundary = subscriptionExpiryBoundary(endsAt);
      const warningStart = subscriptionWarningStart(endsAt);
      const alreadyWarned = gym.subscriptionWarningSentFor?.getTime() === endsAt.getTime();
      const alreadyExpired = gym.subscriptionExpiredSentFor?.getTime() === endsAt.getTime();
      try {
        if (now >= warningStart && now < expiryBoundary && !alreadyWarned) {
          await Promise.all(gym.users.map(user => this.mail.sendSubscriptionExpiryNotice({ to:user.email, name:user.name, gymName:gym.name, endsAt, stage:'WARNING' })));
          await this.prisma.gym.update({ where:{ id:gym.id }, data:{ subscriptionWarningSentFor:endsAt } });
          warnings += 1;
        } else if (now >= expiryBoundary && !alreadyExpired) {
          await Promise.all(gym.users.map(user => this.mail.sendSubscriptionExpiryNotice({ to:user.email, name:user.name, gymName:gym.name, endsAt, stage:'EXPIRED' })));
          await this.prisma.gym.update({ where:{ id:gym.id }, data:{ subscriptionExpiredSentFor:endsAt } });
          expired += 1;
        }
      } catch (error) {
        this.logger.error(`No se pudo enviar el aviso de suscripción de ${gym.name}`, error instanceof Error ? error.stack : undefined);
      }
    }
    return { warnings, expired };
  }

  private async runSafely() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.processDueNotifications();
      if (result.warnings || result.expired) this.logger.log(`Avisos de suscripción enviados: ${result.warnings} próximos a vencer, ${result.expired} vencidos`);
    } catch (error) {
      this.logger.error('No se pudieron procesar los avisos de suscripción', error instanceof Error ? error.stack : undefined);
    } finally {
      this.running = false;
    }
  }
}
