import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles, type AuthUser } from '../common/auth-context';
import { DashboardsService } from '../dashboards/dashboards.service';
import { MembersService } from '../members/members.service';
import { MembershipsService } from '../memberships/memberships.service';
import { CreateMemberDto, UpdateMemberDto } from '../members/members.dto';
import { CreateMembershipDto, RenewMembershipDto, UpdateGymMembershipDto } from '../memberships/memberships.dto';
import { ApplyPaymentDto } from '../payments/payments.dto';
import { CreatePlanDto, UpdatePlanDto } from '../plans/plans.dto';
import { CreateStaffAccountDto, UpdateStaffAccountDto } from '../staff/staff.dto';
import { PaymentsService } from '../payments/payments.service';
import { PlansService } from '../plans/plans.service';
import { StaffService } from '../staff/staff.service';

@ApiTags('admin')
@Controller()
@Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
export class AdminController {
  constructor(private readonly staff: StaffService, private readonly dashboards: DashboardsService, private readonly members: MembersService, private readonly memberships: MembershipsService, private readonly payments: PaymentsService, private readonly plans: PlansService) {}
  @Get('staff') @Roles(UserRole.ADMIN) listStaff(@CurrentUser() user: AuthUser) { return this.staff.list(user); }
  @Post('staff') @Roles(UserRole.ADMIN) createStaff(@Body() dto: CreateStaffAccountDto, @CurrentUser() user: AuthUser) { return this.staff.create(dto, user); }
  @Patch('staff/:id') @Roles(UserRole.ADMIN) updateStaff(@Param('id') id: string, @Body() dto: UpdateStaffAccountDto, @CurrentUser() user: AuthUser) { return this.staff.update(id, dto, user); }
  @Delete('staff/:id') @Roles(UserRole.ADMIN) deleteStaff(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.staff.delete(id, user); }
  @Get('dashboard') dashboard(@CurrentUser() user: AuthUser) { return this.dashboards.adminDashboard(user); }
  @Get('members') listMembers(@CurrentUser() user: AuthUser, @Query('search') search?: string) { return this.members.list(user, search); }
  @Post('members') createMember(@Body() dto: CreateMemberDto, @CurrentUser() user: AuthUser) { return this.members.create(dto, user); }
  @Patch('members/:id') updateMember(@Param('id') id: string, @Body() dto: UpdateMemberDto, @CurrentUser() user: AuthUser) { return this.members.update(id, dto, user); }
  @Delete('members/:id') @Roles(UserRole.ADMIN) deleteMember(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.members.delete(id, user); }
  @Post('members/:id/photo') @UseInterceptors(FileInterceptor('photo', { limits: { files: 1, fileSize: 250 * 1024 } }))
  uploadMemberPhoto(@Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: AuthUser) { return this.members.savePhoto(id, file, user); }
  @Get('members/:id/photo')
  async memberPhoto(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) response: Response) { const photo = await this.members.getPhoto(id, user); response.set({ 'Content-Type': photo.mimeType, 'Content-Length': String(photo.byteSize), 'Cache-Control': 'private, max-age=86400' }); return new StreamableFile(photo.data); }
  @Delete('members/:id/photo') deleteMemberPhoto(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.members.deletePhoto(id, user); }
  @Get('plans') listPlans(@CurrentUser() user: AuthUser) { return this.plans.list(user); }
  @Post('plans') @Roles(UserRole.ADMIN) createPlan(@Body() dto: CreatePlanDto, @CurrentUser() user: AuthUser) { return this.plans.create(dto, user); }
  @Patch('plans/:id') @Roles(UserRole.ADMIN) updatePlan(@Param('id') id: string, @Body() dto: UpdatePlanDto, @CurrentUser() user: AuthUser) { return this.plans.update(id, dto, user); }
  @Delete('plans/:id') @Roles(UserRole.ADMIN) deletePlan(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.plans.delete(id, user); }
  @Get('memberships') listMemberships(@CurrentUser() user: AuthUser, @Query('memberId') memberId?: string) { return this.memberships.list(user, memberId); }
  @Post('memberships') createMembership(@Body() dto: CreateMembershipDto, @CurrentUser() user: AuthUser) { return this.memberships.create(dto, user); }
  @Patch('memberships/:id') updateMembership(@Param('id') id: string, @Body() dto: UpdateGymMembershipDto, @CurrentUser() user: AuthUser) { return this.memberships.update(id, dto, user); }
  @Delete('memberships/:id') @Roles(UserRole.ADMIN) deleteMembership(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.memberships.delete(id, user); }
  @Post('memberships/:id/renew') renew(@Param('id') id: string, @Body() dto: RenewMembershipDto, @CurrentUser() user: AuthUser) { return this.memberships.renew(id, dto, user); }
  @Get('payments') listPayments(@CurrentUser() user: AuthUser) { return this.payments.list(user); }
  @Post('payments/:id/applications') applyPayment(@Param('id') id: string, @Body() dto: ApplyPaymentDto, @CurrentUser() user: AuthUser) { return this.payments.apply(id, dto, user); }
}
