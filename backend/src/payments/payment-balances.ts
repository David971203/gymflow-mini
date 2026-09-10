import { Prisma } from '@prisma/client';
import { membershipDayStart, nextMembershipDayStart } from '../memberships/membership-time';

export type PaymentBalanceRow = { amount: Prisma.Decimal | number | string; paidAmount: Prisma.Decimal | number | string; dueDate?: Date | null };

export function summarizePaymentBalances(payments: PaymentBalanceRow[], today = membershipDayStart()) {
  let outstandingBalance = 0;
  let dueBalance = 0;
  let overdueBalance = 0;
  let futureBalance = 0;
  let outstandingPayments = 0;
  let duePayments = 0;
  let futurePayments = 0;
  for (const payment of payments) {
    const balance = Math.max(0, Number(payment.amount) - Number(payment.paidAmount));
    if (balance <= 0) continue;
    outstandingBalance += balance;
    outstandingPayments += 1;
    if (payment.dueDate && payment.dueDate >= nextMembershipDayStart(today)) {
      futureBalance += balance;
      futurePayments += 1;
      continue;
    }
    dueBalance += balance;
    duePayments += 1;
    if (payment.dueDate && payment.dueDate < today) overdueBalance += balance;
  }
  return {
    outstandingBalance: Number(outstandingBalance.toFixed(2)), dueBalance: Number(dueBalance.toFixed(2)),
    overdueBalance: Number(overdueBalance.toFixed(2)), futureBalance: Number(futureBalance.toFixed(2)),
    outstandingPayments, duePayments, futurePayments,
  };
}
