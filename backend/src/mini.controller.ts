import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles, type AuthUser } from './common';
import { MiniService } from './mini.service';
import { ApplyPaymentDto, AssignGymMembershipDto, CreateGymAdminDto, CreateGymDto, CreateMemberDto, CreateMemberWithMembershipDto, CreateMembershipDto, CreatePlanDto, CreateStaffAccountDto, RenewMembershipDto, ResolveSubscriptionRequestDto, UpdateGymAdminDto, UpdateGymDto, UpdateGymMembershipDto, UpdateGymStatusDto, UpdateGymSubscriptionDto, UpdateMemberDto, UpdatePlanDto, UpdateStaffAccountDto } from './mini.dto';

@ApiTags('super-admin')
@Controller('platform')
@Roles(UserRole.SUPER_ADMIN)
export class PlatformController {
  constructor(private readonly mini: MiniService) {}
  @Get('overview') overview() { return this.mini.platformOverview(); }
  @Get('subscriptions') subscriptions() { return this.mini.listPlatformSubscriptions(); }
  @Get('subscription-requests') subscriptionRequests() { return this.mini.listSubscriptionRequests(); }
  @Patch('subscription-requests/:id') resolveSubscriptionRequest(@Param('id') id: string, @Body() dto: ResolveSubscriptionRequestDto) { return this.mini.resolveSubscriptionRequest(id, dto.status); }
  @Get('gyms') gyms() { return this.mini.listGyms(); }
  @Post('gyms') createGym(@Body() dto: CreateGymDto) { return this.mini.createGym(dto); }
  @Get('gyms/:id') gym(@Param('id') id: string) { return this.mini.getGym(id); }
  @Patch('gyms/:id') updateGym(@Param('id') id: string, @Body() dto: UpdateGymDto) { return this.mini.updateGym(id, dto); }
  @Patch('gyms/:id/status') status(@Param('id') id: string, @Body() dto: UpdateGymStatusDto) { return this.mini.updateGymStatus(id, dto.isActive); }
  @Patch('gyms/:id/subscription') subscription(@Param('id') id: string, @Body() dto: UpdateGymSubscriptionDto) { return this.mini.renewGymSubscription(id, dto.subscriptionPlan, dto.subscriptionTrialDays); }
  @Delete('gyms/:id/subscription') removeSubscription(@Param('id') id: string) { return this.mini.removeGymSubscription(id); }
  @Get('gyms/:gymId/admins') admins(@Param('gymId') gymId: string) { return this.mini.listGymAdmins(gymId); }
  @Get('gyms/:gymId/staff') staff(@Param('gymId') gymId: string) { return this.mini.listGymStaff(gymId); }
  @Post('gyms/:gymId/admins') createAdmin(@Param('gymId') gymId: string, @Body() dto: CreateGymAdminDto) { return this.mini.createGymAdmin(gymId, dto); }
  @Patch('gyms/:gymId/admins/:id') updateAdmin(@Param('gymId') gymId: string, @Param('id') id: string, @Body() dto: UpdateGymAdminDto) { return this.mini.updateGymAdmin(gymId, id, dto); }
  @Delete('gyms/:gymId/admins/:id') deleteAdmin(@Param('gymId') gymId: string, @Param('id') id: string) { return this.mini.deleteGymAdmin(gymId, id); }
  @Get('gyms/:gymId/plans') plans(@Param('gymId') gymId: string) { return this.mini.listGymPlans(gymId); }
  @Post('gyms/:gymId/plans') createPlan(@Param('gymId') gymId: string, @Body() dto: CreatePlanDto) { return this.mini.createGymPlan(gymId, dto); }
  @Patch('gyms/:gymId/plans/:id') updatePlan(@Param('gymId') gymId: string, @Param('id') id: string, @Body() dto: UpdatePlanDto) { return this.mini.updateGymPlan(gymId, id, dto); }
  @Delete('gyms/:gymId/plans/:id') deletePlan(@Param('gymId') gymId: string, @Param('id') id: string) { return this.mini.deleteGymPlan(gymId, id); }
  @Get('gyms/:gymId/members') gymMembers(@Param('gymId') gymId: string, @Query('search') search?: string) { return this.mini.listGymMembers(gymId, search); }
  @Post('gyms/:gymId/members') createGymMember(@Param('gymId') gymId: string, @Body() dto: CreateMemberDto) { return this.mini.createGymMember(gymId, dto); }
  @Post('gyms/:gymId/members-with-membership') createGymMemberWithMembership(@Param('gymId') gymId: string, @Body() dto: CreateMemberWithMembershipDto, @CurrentUser() user: AuthUser) { return this.mini.createGymMemberWithMembership(gymId, dto, user); }
  @Patch('gyms/:gymId/members/:id') updateGymMember(@Param('gymId') gymId: string, @Param('id') id: string, @Body() dto: UpdateMemberDto) { return this.mini.updateGymMember(gymId, id, dto); }
  @Delete('gyms/:gymId/members/:id') deleteGymMember(@Param('gymId') gymId: string, @Param('id') id: string) { return this.mini.deleteGymMember(gymId, id); }
  @Get('gyms/:gymId/members/:memberId/memberships') gymMemberships(@Param('gymId') gymId: string, @Param('memberId') memberId: string) { return this.mini.listGymMemberships(gymId, memberId); }
  @Post('gyms/:gymId/members/:memberId/memberships') assignGymMembership(@Param('gymId') gymId: string, @Param('memberId') memberId: string, @Body() dto: AssignGymMembershipDto, @CurrentUser() user: AuthUser) { return this.mini.createGymMembership(gymId, memberId, dto, user); }
  @Patch('gyms/:gymId/members/:memberId/memberships/:id') updateGymMembership(@Param('gymId') gymId: string, @Param('memberId') memberId: string, @Param('id') id: string, @Body() dto: UpdateGymMembershipDto) { return this.mini.updateGymMembership(gymId, memberId, id, dto); }
  @Delete('gyms/:gymId/members/:memberId/memberships/:id') deleteGymMembership(@Param('gymId') gymId: string, @Param('memberId') memberId: string, @Param('id') id: string) { return this.mini.deleteGymMembership(gymId, memberId, id); }
  @Get('gyms/:gymId/payments') gymPayments(@Param('gymId') gymId: string) { return this.mini.listGymPayments(gymId); }
  @Post('gyms/:gymId/payments/:id/applications') applyGymPayment(@Param('gymId') gymId: string, @Param('id') id: string, @Body() dto: ApplyPaymentDto, @CurrentUser() user: AuthUser) { return this.mini.applyGymPayment(gymId, id, dto, user); }
  @Get('gyms/:gymId/finances') gymFinances(@Param('gymId') gymId: string) { return this.mini.getGymFinances(gymId); }
}

@ApiTags('admin')
@Controller()
@Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
export class AdminController {
  constructor(private readonly mini: MiniService) {}
  @Get('staff') @Roles(UserRole.ADMIN) staff(@CurrentUser() user: AuthUser) { return this.mini.listStaff(user); }
  @Post('staff') @Roles(UserRole.ADMIN) createStaff(@Body() dto: CreateStaffAccountDto, @CurrentUser() user: AuthUser) { return this.mini.createStaff(dto, user); }
  @Patch('staff/:id') @Roles(UserRole.ADMIN) updateStaff(@Param('id') id: string, @Body() dto: UpdateStaffAccountDto, @CurrentUser() user: AuthUser) { return this.mini.updateStaff(id, dto, user); }
  @Delete('staff/:id') @Roles(UserRole.ADMIN) deleteStaff(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.mini.deleteStaff(id, user); }
  @Get('dashboard') dashboard(@CurrentUser() user: AuthUser) { return this.mini.adminDashboard(user); }

  @Get('members') members(@CurrentUser() user: AuthUser, @Query('search') search?: string) { return this.mini.listMembers(user, search); }
  @Post('members') createMember(@Body() dto: CreateMemberDto, @CurrentUser() user: AuthUser) { return this.mini.createMember(dto, user); }
  @Patch('members/:id') updateMember(@Param('id') id: string, @Body() dto: UpdateMemberDto, @CurrentUser() user: AuthUser) { return this.mini.updateMember(id, dto, user); }
  @Delete('members/:id') @Roles(UserRole.ADMIN) deleteMember(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.mini.deleteMember(id, user); }
  @Post('members/:id/photo')
  @UseInterceptors(FileInterceptor('photo', { limits: { files: 1, fileSize: 250 * 1024 } }))
  uploadMemberPhoto(@Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: AuthUser) { return this.mini.saveMemberPhoto(id, file, user); }
  @Get('members/:id/photo')
  async memberPhoto(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) response: Response) {
    const photo = await this.mini.getMemberPhoto(id, user);
    response.set({ 'Content-Type': photo.mimeType, 'Content-Length': String(photo.byteSize), 'Cache-Control': 'private, max-age=86400' });
    return new StreamableFile(photo.data);
  }
  @Delete('members/:id/photo') deleteMemberPhoto(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.mini.deleteMemberPhoto(id, user); }

  @Get('plans') plans(@CurrentUser() user: AuthUser) { return this.mini.listPlans(user); }
  @Post('plans') @Roles(UserRole.ADMIN) createPlan(@Body() dto: CreatePlanDto, @CurrentUser() user: AuthUser) { return this.mini.createPlan(dto, user); }
  @Patch('plans/:id') @Roles(UserRole.ADMIN) updatePlan(@Param('id') id: string, @Body() dto: UpdatePlanDto, @CurrentUser() user: AuthUser) { return this.mini.updatePlan(id, dto, user); }
  @Delete('plans/:id') @Roles(UserRole.ADMIN) deletePlan(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.mini.deletePlan(id, user); }

  @Get('memberships') memberships(@CurrentUser() user: AuthUser, @Query('memberId') memberId?: string) { return this.mini.listMemberships(user, memberId); }
  @Post('memberships') createMembership(@Body() dto: CreateMembershipDto, @CurrentUser() user: AuthUser) { return this.mini.createMembership(dto, user); }
  @Patch('memberships/:id') updateMembership(@Param('id') id: string, @Body() dto: UpdateGymMembershipDto, @CurrentUser() user: AuthUser) { return this.mini.updateMembership(id, dto, user); }
  @Delete('memberships/:id') @Roles(UserRole.ADMIN) deleteMembership(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.mini.deleteMembership(id, user); }
  @Post('memberships/:id/renew') renew(@Param('id') id: string, @Body() dto: RenewMembershipDto, @CurrentUser() user: AuthUser) { return this.mini.renewMembership(id, dto, user); }

  @Get('payments') payments(@CurrentUser() user: AuthUser) { return this.mini.listPayments(user); }
  @Post('payments/:id/applications') apply(@Param('id') id: string, @Body() dto: ApplyPaymentDto, @CurrentUser() user: AuthUser) { return this.mini.applyPayment(id, dto, user); }
}
