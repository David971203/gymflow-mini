import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import type { AuthUser } from '../common/auth-context';
import { authenticatedGymId, requireGym } from '../common/gym-scope';
import { membershipDayStart } from '../memberships/membership-time';
import type { ApplyPaymentDto } from './payments.dto';
import { PrismaService } from '../database/prisma.service';
import { summarizePaymentBalances } from './payment-balances';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForGym(gymId: string, verifyGym = false) {
    if (verifyGym) await requireGym(this.prisma, gymId);
    await this.prisma.payment.updateMany({ where: { gymId, status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL] }, dueDate: { lt: membershipDayStart() } }, data: { status: PaymentStatus.OVERDUE } });
    return this.prisma.payment.findMany({ where: { gymId }, include: { member: true, membership: { include: { plan: true } }, movements: { orderBy: { occurredAt: 'desc' } } }, orderBy: { createdAt: 'desc' } });
  }

  async applyForGym(gymId: string, id: string, dto: ApplyPaymentDto, user: AuthUser, verifyGym = false) {
    if (verifyGym) await requireGym(this.prisma, gymId);
    if (dto.clientMutationId) {
      const repeated = await this.prisma.paymentMovement.findUnique({ where: { clientMutationId: dto.clientMutationId }, include: { payment: { include: { member: true, membership: { include: { plan: true } }, movements: true } } } });
      if (repeated) {
        if (repeated.payment.gymId !== gymId) throw new ConflictException('La operación pertenece a otro gimnasio');
        return repeated.payment;
      }
    }
    const current = await this.prisma.payment.findFirst({ where: { id, gymId } });
    if (!current) throw new NotFoundException('Cobro no encontrado');
    const balance = Number(current.amount) - Number(current.paidAmount);
    if (dto.amount > balance) throw new BadRequestException(`El abono supera el saldo de ${balance.toFixed(2)}`);
    const paidAmount = Number(current.paidAmount) + dto.amount;
    const status = paidAmount >= Number(current.amount) ? PaymentStatus.PAID : PaymentStatus.PARTIAL;
    const operationTime = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payment.updateMany({ where: { id, paidAmount: current.paidAmount }, data: { paidAmount, status, paidAt: status === PaymentStatus.PAID ? operationTime : null } });
      if (updated.count !== 1) throw new ConflictException('El cobro cambió; vuelve a intentarlo');
      await tx.paymentMovement.create({ data: { paymentId: id, actorUserId: user.id, amount: dto.amount, method: dto.method, reference: dto.reference, occurredAt: operationTime, clientMutationId: dto.clientMutationId } });
      return tx.payment.findUniqueOrThrow({ where: { id }, include: { member: true, membership: { include: { plan: true } }, movements: true } });
    });
  }

  async financesForGym(gymId: string, verifyGym = false) {
    if (verifyGym) await requireGym(this.prisma, gymId);
    await this.prisma.payment.updateMany({ where: { gymId, status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL] }, dueDate: { lt: membershipDayStart() } }, data: { status: PaymentStatus.OVERDUE } });
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const [payments, monthlyRevenue, recentMovements] = await Promise.all([
      this.prisma.payment.findMany({ where: { gymId }, select: { amount: true, paidAmount: true, status: true, dueDate: true } }),
      this.prisma.paymentMovement.aggregate({ where: { payment: { gymId }, occurredAt: { gte: monthStart } }, _sum: { amount: true } }),
      this.prisma.paymentMovement.findMany({ where: { payment: { gymId } }, include: { payment: { include: { member: true, membership: { include: { plan: true } } } }, actor: { select: { id: true, name: true } } }, orderBy: { occurredAt: 'desc' }, take: 20 }),
    ]);
    const totalBilled = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const totalCollected = payments.reduce((sum, payment) => sum + Number(payment.paidAmount), 0);
    const balances = summarizePaymentBalances(payments);
    return {
      totalBilled: Number(totalBilled.toFixed(2)), totalCollected: Number(totalCollected.toFixed(2)),
      pendingBalance: balances.outstandingBalance, dueBalance: balances.dueBalance,
      overdueBalance: balances.overdueBalance, futureBalance: balances.futureBalance,
      monthlyRevenue: Number(monthlyRevenue._sum.amount ?? 0), pendingPayments: balances.outstandingPayments,
      duePayments: balances.duePayments, futurePayments: balances.futurePayments, recentMovements,
    };
  }

  list(user: AuthUser) { return this.listForGym(authenticatedGymId(user)); }
  apply(id: string, dto: ApplyPaymentDto, user: AuthUser) { return this.applyForGym(authenticatedGymId(user), id, dto, user); }
}
