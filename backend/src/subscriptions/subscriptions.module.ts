import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { SubscriptionExpirationService } from './subscription-expiration.service';
import { SubscriptionScheduleService } from './subscription-schedule.service';

@Module({
  imports: [MailModule],
  providers: [SubscriptionExpirationService, SubscriptionScheduleService],
  exports: [SubscriptionScheduleService],
})
export class SubscriptionsModule {}
