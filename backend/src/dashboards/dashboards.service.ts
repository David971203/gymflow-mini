import { Injectable } from '@nestjs/common';
import { GymSubscriptionPlan, MembershipStatus, PaymentStatus, Prisma, SubscriptionRequestStatus } from '@prisma/client';
import type { AuthUser } from '../common/auth-context';
import { authenticatedGymId } from '../common/gym-scope';
import { membershipDayStart, nextMembershipDayStart } from '../memberships/membership-time';
import { summarizePaymentBalances } from '../payments/payment-balances';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class DashboardsService {
  constructor(private readonly prisma: PrismaService) {}

  async platformOverview() {
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const nextMonth = new Date(start); nextMonth.setMonth(nextMonth.getMonth() + 1);
    const trendMonths = Array.from({ length: 6 }, (_, index) => { const monthStart = new Date(start); monthStart.setMonth(monthStart.getMonth() - (5 - index)); const monthEnd = new Date(monthStart); monthEnd.setMonth(monthEnd.getMonth() + 1); return { monthStart, monthEnd }; });
    const today = membershipDayStart();
    const activeSubscriptionWhere = { isActive: true, subscriptionEndsAt: { gte: today } } satisfies Prisma.GymWhereInput;
    const [gyms, activeGyms, members, newMembers, revenue, debtRows, subscriptionMonthlyRevenue, subscriptionTotalRevenue, activeTrialSubscriptions, activeMonthlySubscriptions, activeAnnualSubscriptions, expiredSubscriptions, withoutSubscriptions, pendingSubscriptionRequests, ...memberTrendCounts] = await Promise.all([
      this.prisma.gym.count(), this.prisma.gym.count({ where: { isActive: true } }), this.prisma.member.count({ where: { status: 'ACTIVE' } }),
      this.prisma.member.count({ where: { joinedAt: { gte: start, lt: nextMonth } } }),
      this.prisma.paymentMovement.aggregate({ where: { occurredAt: { gte: start, lt: nextMonth } }, _sum: { amount: true } }),
      this.prisma.payment.findMany({ where: { status: { not: PaymentStatus.PAID } }, select: { amount: true, paidAmount: true, dueDate: true } }),
      this.prisma.platformSubscription.aggregate({ where: { activatedAt: { gte: start, lt: nextMonth } }, _sum: { amount: true } }), this.prisma.platformSubscription.aggregate({ _sum: { amount: true } }),
      this.prisma.gym.count({ where: { ...activeSubscriptionWhere, subscriptionPlan: GymSubscriptionPlan.TRIAL } }), this.prisma.gym.count({ where: { ...activeSubscriptionWhere, subscriptionPlan: GymSubscriptionPlan.MONTHLY } }), this.prisma.gym.count({ where: { ...activeSubscriptionWhere, subscriptionPlan: GymSubscriptionPlan.ANNUAL } }),
      this.prisma.gym.count({ where: { subscriptionEndsAt: { lt: today } } }), this.prisma.gym.count({ where: { subscriptionPlan: null } }), this.prisma.subscriptionRequest.count({ where: { status: SubscriptionRequestStatus.PENDING } }),
      ...trendMonths.map(({ monthStart, monthEnd }) => this.prisma.member.count({ where: { joinedAt: { gte: monthStart, lt: monthEnd } } })),
    ]);
    const balances = summarizePaymentBalances(debtRows);
    return { gyms, activeGyms, members, newMembers, monthlyRevenue: Number(revenue._sum.amount ?? 0), pendingDebt: balances.dueBalance, overdueDebt: balances.overdueBalance, futureDebt: balances.futureBalance, memberTrend: trendMonths.map(({ monthStart }, index) => ({ month: monthStart.toISOString().slice(0, 7), members: memberTrendCounts[index] })), subscriptionMonthlyRevenue: Number(subscriptionMonthlyRevenue._sum.amount ?? 0), subscriptionTotalRevenue: Number(subscriptionTotalRevenue._sum.amount ?? 0), activeTrialSubscriptions, activeMonthlySubscriptions, activeAnnualSubscriptions, expiredSubscriptions, withoutSubscriptions, pendingSubscriptionRequests };
  }

  async adminDashboard(user: AuthUser) {
    const gymId = authenticatedGymId(user);
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const nextMonth = new Date(start); nextMonth.setMonth(nextMonth.getMonth() + 1);
    const [members, activeMemberships, revenue, debtRows, recent] = await Promise.all([
      this.prisma.member.count({ where: { gymId } }), this.prisma.membership.count({ where: { status: MembershipStatus.ACTIVE, endDate: { gte: nextMembershipDayStart() }, member: { gymId } } }),
      this.prisma.paymentMovement.aggregate({ where: { payment: { gymId }, occurredAt: { gte: start, lt: nextMonth } }, _sum: { amount: true } }), this.prisma.payment.findMany({ where: { gymId, status: { not: PaymentStatus.PAID } }, select: { amount: true, paidAmount: true, dueDate: true } }),
      this.prisma.paymentMovement.findMany({ where: { payment: { gymId }, occurredAt: { gte: start, lt: nextMonth } }, include: { payment: { include: { member: true } } }, orderBy: { occurredAt: 'desc' }, take: 5 }),
    ]);
    const balances = summarizePaymentBalances(debtRows);
    return { members, activeMemberships, monthlyRevenue: Number(revenue._sum.amount ?? 0), pendingDebt: balances.dueBalance, overdueDebt: balances.overdueBalance, futureDebt: balances.futureBalance, recentPayments: recent };
  }
}
