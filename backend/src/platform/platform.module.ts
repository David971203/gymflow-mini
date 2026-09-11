import { Module } from '@nestjs/common';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { PrismaModule } from '../database/prisma.module';
import { MembersModule } from '../members/members.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { PaymentsModule } from '../payments/payments.module';
import { PlansModule } from '../plans/plans.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [PrismaModule, DashboardsModule, MembersModule, MembershipsModule, PaymentsModule, PlansModule],
  controllers: [PlatformController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
