import { isMembershipDayOnOrBefore, membershipRemainingDays } from '../membershipDates';
import type { Currency, MemberSex, Payment, Plan } from '../types';

export type PaymentMonthFilter = 'ALL' | number;
export type PaymentYearFilter = 'ALL' | number;

export const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const;

export function formatMoney(value: number | string, currency: Currency) {
  return `${Number(value).toLocaleString('es-CU', { maximumFractionDigits: 2 })} ${currency}`;
}

export function contractedPlan(membership: {
  plan: Plan;
  planName?: string;
  planPrice?: string;
  planDurationDays?: number;
}): Plan {
  return {
    ...membership.plan,
    name: membership.planName ?? membership.plan.name,
    price: membership.planPrice ?? membership.plan.price,
    durationDays: membership.planDurationDays ?? membership.plan.durationDays,
  };
}

export function paymentCreatedDate(payment: Payment) {
  const fallback = payment.movements.map((movement) => movement.occurredAt).sort()[0];
  const value = payment.createdAt ?? fallback;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function paymentIsDue(payment: Payment, now = Date.now()) {
  if (!payment.dueDate) return true;
  return isMembershipDayOnOrBefore(payment.dueDate, now);
}

export function paymentPeriodLabel(month: PaymentMonthFilter, year: PaymentYearFilter) {
  if (month === 'ALL' && year === 'ALL') return 'Todos los períodos';
  if (month === 'ALL') return `Año ${year}`;
  if (year === 'ALL') return MONTH_NAMES[month];
  return `${MONTH_NAMES[month]} ${year}`;
}

export function membershipStatusLabel(status: string) {
  return ({ ACTIVE: 'Activa', SCHEDULED: 'Programada', EXPIRED: 'Vencida', CANCELLED: 'Cancelada' } as Record<string, string>)[status] ?? status;
}

export function sexLabel(sex?: MemberSex | null) {
  return sex ? ({ MALE: 'Masculino', FEMALE: 'Femenino', OTHER: 'Otro' } as Record<MemberSex, string>)[sex] : '';
}

export function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString('es-CU', { timeZone: 'America/Havana', day: '2-digit', month: 'short', year: 'numeric' }) : 'Sin fecha';
}

export function formatDateTime(value: string) {
  return new Date(value).toLocaleString('es-CU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function remainingDaysLabel(value: string) {
  const days = membershipRemainingDays(value);
  return `${days} día${days === 1 ? '' : 's'} restante${days === 1 ? '' : 's'}`;
}

export function addDays(value: string, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}
