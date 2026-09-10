import { Module } from '@nestjs/common';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { MembersModule } from '../members/members.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { PaymentsModule } from '../payments/payments.module';
import { PlansModule } from '../plans/plans.module';
import { StaffModule } from '../staff/staff.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [DashboardsModule, MembersModule, MembershipsModule, PaymentsModule, PlansModule, StaffModule],
  controllers: [AdminController],
})
export class AdminModule {}
