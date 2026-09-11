import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { MembersModule } from '../members/members.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { PaymentsModule } from '../payments/payments.module';
import { PlansModule } from '../plans/plans.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [AttendanceModule, DashboardsModule, MembersModule, MembershipsModule, PaymentsModule, PlansModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
