import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module';
import { MembershipExpirationService } from './membership-expiration.service';
import { MembershipsService } from './memberships.service';

@Module({
  imports: [PrismaModule],
  providers: [MembershipsService, MembershipExpirationService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
