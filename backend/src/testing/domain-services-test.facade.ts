import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GymSubscriptionPlan, MembershipStatus } from '@prisma/client';
import type { AuthUser } from '../common/auth-context';
import { DashboardsService } from '../dashboards/dashboards.service';
import { MembersService } from '../members/members.service';
import { MembershipsService } from '../memberships/memberships.service';
import type { CreateMemberDto, UpdateMemberDto } from '../members/members.dto';
import type { AssignGymMembershipDto, CreateMemberWithMembershipDto, CreateMembershipDto, RenewMembershipDto, UpdateGymMembershipDto } from '../memberships/memberships.dto';
import type { ApplyPaymentDto } from '../payments/payments.dto';
import type { CreatePlanDto, UpdatePlanDto } from '../plans/plans.dto';
import type { CreateGymAdminDto, CreateGymDto, UpdateGymAdminDto, UpdateGymDto } from '../platform/platform.dto';
import type { CreateStaffAccountDto, UpdateStaffAccountDto } from '../staff/staff.dto';
import { PaymentsService } from '../payments/payments.service';
import { PlansService } from '../plans/plans.service';
import { PlatformService } from '../platform/platform.service';
import { PrismaService } from '../database/prisma.service';
import { StaffService } from '../staff/staff.service';

/**
 * Compatibility facade for legacy callers and characterization tests.
 * New production code injects the feature services directly.
 */
@Injectable()
export class DomainServicesTestFacade {
  private readonly platform: PlatformService;
  private readonly staff: StaffService;
  private readonly dashboards: DashboardsService;
  private readonly members: MembersService;
  private readonly memberships: MembershipsService;
  private readonly payments: PaymentsService;
  private readonly plans: PlansService;

  constructor(private readonly prisma: PrismaService) {
    this.platform = new PlatformService(prisma);
    this.staff = new StaffService(prisma);
    this.dashboards = new DashboardsService(prisma);
    this.members = new MembersService(prisma);
    this.memberships = new MembershipsService(prisma);
    this.payments = new PaymentsService(prisma);
    this.plans = new PlansService(prisma);
  }

  createGym(dto: CreateGymDto) { return this.platform.createGym(dto); }
  listGyms() { return this.platform.listGyms(); }
  listPlatformSubscriptions() { return this.platform.listSubscriptions(); }
  listSubscriptionRequests() { return this.platform.listSubscriptionRequests(); }
  resolveSubscriptionRequest(id: string, status: 'APPROVED' | 'REJECTED') { return this.platform.resolveSubscriptionRequest(id, status); }
  getGym(id: string) { return this.platform.getGym(id); }
  updateGym(id: string, dto: UpdateGymDto) { return this.platform.updateGym(id, dto); }
  updateGymStatus(id: string, isActive: boolean) { return this.platform.updateGymStatus(id, isActive); }
  renewGymSubscription(id: string, plan: GymSubscriptionPlan, trialDays?: number) { return this.platform.renewGymSubscription(id, plan, trialDays); }
  removeGymSubscription(id: string) { return this.platform.removeGymSubscription(id); }
  listGymAdmins(gymId: string) { return this.platform.listGymAdmins(gymId); }
  createGymAdmin(gymId: string, dto: CreateGymAdminDto) { return this.platform.createGymAdmin(gymId, dto); }
  updateGymAdmin(gymId: string, id: string, dto: UpdateGymAdminDto) { return this.platform.updateGymAdmin(gymId, id, dto); }
  deleteGymAdmin(gymId: string, id: string) { return this.platform.deleteGymAdmin(gymId, id); }
  listGymStaff(gymId: string) { return this.platform.listGymStaff(gymId); }

  listStaff(user: AuthUser) { return this.staff.list(user); }
  createStaff(dto: CreateStaffAccountDto, user: AuthUser) { return this.staff.create(dto, user); }
  updateStaff(id: string, dto: UpdateStaffAccountDto, user: AuthUser) { return this.staff.update(id, dto, user); }
  deleteStaff(id: string, user: AuthUser) { return this.staff.delete(id, user); }

  platformOverview() { return this.dashboards.platformOverview(); }
  adminDashboard(user: AuthUser) { return this.dashboards.adminDashboard(user); }

  listGymMembers(gymId: string, search?: string) { return this.members.listForGym(gymId, search, true); }
  createGymMember(gymId: string, dto: CreateMemberDto) { return this.members.createForGym(gymId, dto, { verifyGym: true }); }
  updateGymMember(gymId: string, id: string, dto: UpdateMemberDto) { return this.members.updateForGym(gymId, id, dto); }
  deleteGymMember(gymId: string, id: string) { return this.members.deleteForGym(gymId, id); }
  createMember(dto: CreateMemberDto, user: AuthUser) { return this.members.create(dto, user); }
  listMembers(user: AuthUser, search?: string) { return this.members.list(user, search); }
  updateMember(id: string, dto: UpdateMemberDto, user: AuthUser) { return this.members.update(id, dto, user); }
  deleteMember(id: string, user: AuthUser) { return this.members.delete(id, user); }
  saveMemberPhoto(id: string, file: Express.Multer.File | undefined, user: AuthUser) { return this.members.savePhoto(id, file, user); }
  getMemberPhoto(id: string, user: AuthUser) { return this.members.getPhoto(id, user); }
  deleteMemberPhoto(id: string, user: AuthUser) { return this.members.deletePhoto(id, user); }
  findMemberByCi(ci: string, user: AuthUser) { return this.members.findByCi(ci, user); }

  listGymPlans(gymId: string) { return this.plans.listForGym(gymId, true); }
  createGymPlan(gymId: string, dto: CreatePlanDto) { return this.plans.createForGym(gymId, dto, true); }
  updateGymPlan(gymId: string, id: string, dto: UpdatePlanDto) { return this.plans.updateForGym(gymId, id, dto, true); }
  deleteGymPlan(gymId: string, id: string) { return this.plans.deleteForGym(gymId, id, true); }
  createPlan(dto: CreatePlanDto, user: AuthUser) { return this.plans.create(dto, user); }
  listPlans(user: AuthUser) { return this.plans.list(user); }
  updatePlan(id: string, dto: UpdatePlanDto, user: AuthUser) { return this.plans.update(id, dto, user); }
  deletePlan(id: string, user: AuthUser) { return this.plans.delete(id, user); }
  findPlanByName(name: string, user: AuthUser) { return this.plans.findByName(name, user); }

  createGymMemberWithMembership(gymId: string, dto: CreateMemberWithMembershipDto, user: AuthUser) { return this.memberships.createMemberWithMembershipForGym(gymId, dto, user, false, true); }
  createMemberWithMembership(dto: CreateMemberWithMembershipDto, user: AuthUser, mergeByCi = false) { return this.memberships.createMemberWithMembership(dto, user, mergeByCi); }
  createGymMembership(gymId: string, memberId: string, dto: AssignGymMembershipDto, user: AuthUser) { return this.memberships.createForGym(gymId, memberId, dto, user, true); }
  listGymMemberships(gymId: string, memberId: string) { return this.memberships.listForGym(gymId, memberId, true); }
  updateGymMembership(gymId: string, memberId: string, id: string, dto: UpdateGymMembershipDto) { return this.memberships.updateForGym(gymId, memberId, id, dto, true); }
  deleteGymMembership(gymId: string, memberId: string, id: string) { return this.memberships.deleteForGym(gymId, memberId, id, true); }
  listMemberships(user: AuthUser, memberId?: string) { return this.memberships.list(user, memberId); }
  createMembership(dto: CreateMembershipDto, user: AuthUser) { return this.memberships.create(dto, user); }
  updateMembership(id: string, dto: UpdateGymMembershipDto, user: AuthUser) { return this.memberships.update(id, dto, user); }
  renewMembership(id: string, dto: RenewMembershipDto, user: AuthUser) { return this.memberships.renew(id, dto, user); }
  async deleteMembership(id: string, user: AuthUser) {
    if (!user.gymId) throw new BadRequestException('Se requiere una cuenta del gimnasio');
    const membership = await this.prisma.membership.findFirst({ where: { id, member: { gymId: user.gymId } }, select: { memberId: true, status: true } });
    if (!membership) throw new NotFoundException('Membresía no encontrada');
    if (membership.status !== MembershipStatus.SCHEDULED) throw new BadRequestException('Solo se pueden eliminar renovaciones programadas');
    return this.deleteGymMembership(user.gymId, membership.memberId, id);
  }

  listGymPayments(gymId: string) { return this.payments.listForGym(gymId, true); }
  applyGymPayment(gymId: string, id: string, dto: ApplyPaymentDto, user: AuthUser) { return this.payments.applyForGym(gymId, id, dto, user, true); }
  getGymFinances(gymId: string) { return this.payments.financesForGym(gymId, true); }
  listPayments(user: AuthUser) { return this.payments.list(user); }
  applyPayment(id: string, dto: ApplyPaymentDto, user: AuthUser) { return this.payments.apply(id, dto, user); }
}
