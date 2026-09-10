import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles, type AuthUser } from '../common/auth-context';
import { DashboardsService } from '../dashboards/dashboards.service';
import { MembersService } from '../members/members.service';
import { MembershipsService } from '../memberships/memberships.service';
import { CreateMemberDto, UpdateMemberDto } from '../members/members.dto';
import { AssignGymMembershipDto, CreateMemberWithMembershipDto, UpdateGymMembershipDto } from '../memberships/memberships.dto';
import { ApplyPaymentDto } from '../payments/payments.dto';
import { CreatePlanDto, UpdatePlanDto } from '../plans/plans.dto';
import { CreateGymAdminDto, CreateGymDto, ResolveSubscriptionRequestDto, UpdateGymAdminDto, UpdateGymDto, UpdateGymStatusDto, UpdateGymSubscriptionDto } from './platform.dto';
import { PaymentsService } from '../payments/payments.service';
import { PlansService } from '../plans/plans.service';
import { PlatformService } from './platform.service';

@ApiTags('super-admin')
@Controller('platform')
@Roles(UserRole.SUPER_ADMIN)
export class PlatformController {
  constructor(private readonly platform: PlatformService, private readonly dashboards: DashboardsService, private readonly members: MembersService, private readonly memberships: MembershipsService, private readonly payments: PaymentsService, private readonly plans: PlansService) {}
  @Get('overview') overview() { return this.dashboards.platformOverview(); }
  @Get('subscriptions') subscriptions() { return this.platform.listSubscriptions(); }
  @Get('subscription-requests') subscriptionRequests() { return this.platform.listSubscriptionRequests(); }
  @Patch('subscription-requests/:id') resolveSubscriptionRequest(@Param('id') id: string, @Body() dto: ResolveSubscriptionRequestDto) { return this.platform.resolveSubscriptionRequest(id, dto.status); }
  @Get('gyms') gyms() { return this.platform.listGyms(); }
  @Post('gyms') createGym(@Body() dto: CreateGymDto) { return this.platform.createGym(dto); }
  @Get('gyms/:id') gym(@Param('id') id: string) { return this.platform.getGym(id); }
  @Patch('gyms/:id') updateGym(@Param('id') id: string, @Body() dto: UpdateGymDto) { return this.platform.updateGym(id, dto); }
  @Patch('gyms/:id/status') status(@Param('id') id: string, @Body() dto: UpdateGymStatusDto) { return this.platform.updateGymStatus(id, dto.isActive); }
  @Patch('gyms/:id/subscription') subscription(@Param('id') id: string, @Body() dto: UpdateGymSubscriptionDto) { return this.platform.renewGymSubscription(id, dto.subscriptionPlan, dto.subscriptionTrialDays); }
  @Delete('gyms/:id/subscription') removeSubscription(@Param('id') id: string) { return this.platform.removeGymSubscription(id); }
  @Get('gyms/:gymId/admins') admins(@Param('gymId') gymId: string) { return this.platform.listGymAdmins(gymId); }
  @Get('gyms/:gymId/staff') staff(@Param('gymId') gymId: string) { return this.platform.listGymStaff(gymId); }
  @Post('gyms/:gymId/admins') createAdmin(@Param('gymId') gymId: string, @Body() dto: CreateGymAdminDto) { return this.platform.createGymAdmin(gymId, dto); }
  @Patch('gyms/:gymId/admins/:id') updateAdmin(@Param('gymId') gymId: string, @Param('id') id: string, @Body() dto: UpdateGymAdminDto) { return this.platform.updateGymAdmin(gymId, id, dto); }
  @Delete('gyms/:gymId/admins/:id') deleteAdmin(@Param('gymId') gymId: string, @Param('id') id: string) { return this.platform.deleteGymAdmin(gymId, id); }
  @Get('gyms/:gymId/plans') gymPlans(@Param('gymId') gymId: string) { return this.plans.listForGym(gymId, true); }
  @Post('gyms/:gymId/plans') createPlan(@Param('gymId') gymId: string, @Body() dto: CreatePlanDto) { return this.plans.createForGym(gymId, dto, true); }
  @Patch('gyms/:gymId/plans/:id') updatePlan(@Param('gymId') gymId: string, @Param('id') id: string, @Body() dto: UpdatePlanDto) { return this.plans.updateForGym(gymId, id, dto, true); }
  @Delete('gyms/:gymId/plans/:id') deletePlan(@Param('gymId') gymId: string, @Param('id') id: string) { return this.plans.deleteForGym(gymId, id, true); }
  @Get('gyms/:gymId/members') gymMembers(@Param('gymId') gymId: string, @Query('search') search?: string) { return this.members.listForGym(gymId, search, true); }
  @Post('gyms/:gymId/members') createGymMember(@Param('gymId') gymId: string, @Body() dto: CreateMemberDto) { return this.members.createForGym(gymId, dto, { verifyGym: true }); }
  @Post('gyms/:gymId/members-with-membership') createGymMemberWithMembership(@Param('gymId') gymId: string, @Body() dto: CreateMemberWithMembershipDto, @CurrentUser() user: AuthUser) { return this.memberships.createMemberWithMembershipForGym(gymId, dto, user, false, true); }
  @Patch('gyms/:gymId/members/:id') updateGymMember(@Param('gymId') gymId: string, @Param('id') id: string, @Body() dto: UpdateMemberDto) { return this.members.updateForGym(gymId, id, dto); }
  @Delete('gyms/:gymId/members/:id') deleteGymMember(@Param('gymId') gymId: string, @Param('id') id: string) { return this.members.deleteForGym(gymId, id); }
  @Get('gyms/:gymId/members/:memberId/memberships') gymMemberships(@Param('gymId') gymId: string, @Param('memberId') memberId: string) { return this.memberships.listForGym(gymId, memberId, true); }
  @Post('gyms/:gymId/members/:memberId/memberships') assignGymMembership(@Param('gymId') gymId: string, @Param('memberId') memberId: string, @Body() dto: AssignGymMembershipDto, @CurrentUser() user: AuthUser) { return this.memberships.createForGym(gymId, memberId, dto, user, true); }
  @Patch('gyms/:gymId/members/:memberId/memberships/:id') updateGymMembership(@Param('gymId') gymId: string, @Param('memberId') memberId: string, @Param('id') id: string, @Body() dto: UpdateGymMembershipDto) { return this.memberships.updateForGym(gymId, memberId, id, dto, true); }
  @Delete('gyms/:gymId/members/:memberId/memberships/:id') deleteGymMembership(@Param('gymId') gymId: string, @Param('memberId') memberId: string, @Param('id') id: string) { return this.memberships.deleteForGym(gymId, memberId, id, true); }
  @Get('gyms/:gymId/payments') gymPayments(@Param('gymId') gymId: string) { return this.payments.listForGym(gymId, true); }
  @Post('gyms/:gymId/payments/:id/applications') applyGymPayment(@Param('gymId') gymId: string, @Param('id') id: string, @Body() dto: ApplyPaymentDto, @CurrentUser() user: AuthUser) { return this.payments.applyForGym(gymId, id, dto, user, true); }
  @Get('gyms/:gymId/finances') gymFinances(@Param('gymId') gymId: string) { return this.payments.financesForGym(gymId, true); }
}
