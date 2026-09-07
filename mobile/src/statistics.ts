import type { Member, Payment, Plan } from './types';
import { isMembershipDayBefore, isMembershipDayOnOrBefore, membershipIsCurrent } from './membershipDates';

export type StatisticBar = { id: string; label: string; value: number };
export type PlanStatistic = { id: string; name: string; contracted: number; active: number; revenue: number; averagePrice: number };
export type ClientPaymentStatistic = { id: string; name: string; amount: number; operations: number };
export type ClientDebtStatistic = { id: string; name: string; amount: number; payments: number; overdue: boolean };
export type GymStatistics = {
  growth: { currentMonth: number; previousMonth: number; variation: number | null; activeMembers: number; inactiveMembers: number; validMemberships: number; monthly: StatisticBar[] };
  plans: PlanStatistic[];
  clients: { ages: StatisticBar[]; sexes: StatisticBar[]; withoutAge: number; topPayments: ClientPaymentStatistic[]; debts: ClientDebtStatistic[]; totalDebt: number; futureDebt: number };
};

function finite(value: string | number | undefined | null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function validDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function planSnapshot(payment: Payment): Plan {
  return {
    ...payment.membership.plan,
    name: payment.membership.planName ?? payment.membership.plan.name,
    price: payment.membership.planPrice ?? payment.membership.plan.price,
    durationDays: payment.membership.planDurationDays ?? payment.membership.plan.durationDays,
  };
}

function membershipIsValid(payment: Payment, now: Date) {
  return membershipIsCurrent(payment.membership, now);
}

export function calculateGymStatistics(members: Member[], payments: Payment[], now = new Date()): GymStatistics {
  const currentKey = monthKey(now);
  const previousDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousKey = monthKey(previousDate);
  const joinedCounts = new Map<string, number>();
  for (const member of members) {
    const joined = validDate(member.joinedAt);
    if (joined) joinedCounts.set(monthKey(joined), (joinedCounts.get(monthKey(joined)) ?? 0) + 1);
  }
  const currentMonth = joinedCounts.get(currentKey) ?? 0;
  const previousMonth = joinedCounts.get(previousKey) ?? 0;
  const variation = previousMonth === 0 ? (currentMonth === 0 ? 0 : null) : ((currentMonth - previousMonth) / previousMonth) * 100;
  const monthly = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const id = monthKey(date);
    const label = new Intl.DateTimeFormat('es-CU', { month:'short' }).format(date).replace('.', '');
    return { id, label:label.charAt(0).toUpperCase() + label.slice(1), value:joinedCounts.get(id) ?? 0 };
  });

  const uniqueMemberships = new Map<string, Payment>();
  for (const payment of payments) uniqueMemberships.set(payment.membership.id ?? payment.id, payment);
  const planRows = new Map<string, PlanStatistic>();
  for (const payment of uniqueMemberships.values()) {
    const plan = planSnapshot(payment);
    const row = planRows.get(plan.id) ?? { id:plan.id, name:plan.name, contracted:0, active:0, revenue:0, averagePrice:0 };
    row.contracted += 1;
    row.active += membershipIsValid(payment, now) ? 1 : 0;
    row.averagePrice += finite(plan.price);
    planRows.set(plan.id, row);
  }
  for (const payment of payments) {
    const plan = planSnapshot(payment);
    const row = planRows.get(plan.id) ?? { id:plan.id, name:plan.name, contracted:0, active:0, revenue:0, averagePrice:0 };
    row.revenue += payment.movements.reduce((sum, movement) => sum + finite(movement.amount), 0);
    planRows.set(plan.id, row);
  }
  const plans = [...planRows.values()].map(row => ({ ...row, averagePrice:row.contracted ? row.averagePrice / row.contracted : 0 })).sort((left, right) => right.contracted - left.contracted || right.revenue - left.revenue);

  const ageDefinitions = [
    { id:'UNDER_18', label:'Menos de 18', test:(age:number) => age < 18 },
    { id:'18_24', label:'18–24', test:(age:number) => age >= 18 && age <= 24 },
    { id:'25_34', label:'25–34', test:(age:number) => age >= 25 && age <= 34 },
    { id:'35_44', label:'35–44', test:(age:number) => age >= 35 && age <= 44 },
    { id:'45_54', label:'45–54', test:(age:number) => age >= 45 && age <= 54 },
    { id:'55_PLUS', label:'55 o más', test:(age:number) => age >= 55 },
  ];
  const ages = ageDefinitions.map(definition => ({ id:definition.id, label:definition.label, value:members.filter(member => finite(member.age) > 0 && definition.test(finite(member.age))).length }));
  const withoutAge = members.filter(member => !member.age || finite(member.age) <= 0).length;
  const sexes = [
    { id:'MALE', label:'Masculino', value:members.filter(member => member.sex === 'MALE').length },
    { id:'FEMALE', label:'Femenino', value:members.filter(member => member.sex === 'FEMALE').length },
    { id:'OTHER', label:'Otro', value:members.filter(member => member.sex === 'OTHER').length },
    { id:'UNSPECIFIED', label:'Sin especificar', value:members.filter(member => !member.sex).length },
  ];
  const paymentHistory = new Map<string, ClientPaymentStatistic>();
  const debtHistory = new Map<string, ClientDebtStatistic>();
  let futureDebt = 0;
  for (const payment of payments) {
    const name = `${payment.member.firstName} ${payment.member.lastName}`.trim();
    const paid = payment.movements.reduce((sum, movement) => sum + finite(movement.amount), 0);
    const history = paymentHistory.get(payment.member.id) ?? { id:payment.member.id, name, amount:0, operations:0 };
    history.amount += paid;
    history.operations += payment.movements.length;
    paymentHistory.set(payment.member.id, history);
    const balance = Math.max(0, finite(payment.amount) - finite(payment.paidAmount));
    if (balance <= 0) continue;
    if (payment.dueDate && !isMembershipDayOnOrBefore(payment.dueDate, now)) {
      futureDebt += balance;
      continue;
    }
    const debt = debtHistory.get(payment.member.id) ?? { id:payment.member.id, name, amount:0, payments:0, overdue:false };
    debt.amount += balance;
    debt.payments += 1;
    debt.overdue ||= payment.status === 'OVERDUE' || (!!payment.dueDate && isMembershipDayBefore(payment.dueDate, now));
    debtHistory.set(payment.member.id, debt);
  }
  const topPayments = [...paymentHistory.values()].filter(row => row.amount > 0).sort((left, right) => right.amount - left.amount).slice(0, 8);
  const debts = [...debtHistory.values()].sort((left, right) => Number(right.overdue) - Number(left.overdue) || right.amount - left.amount);
  return {
    growth:{ currentMonth, previousMonth, variation, activeMembers:members.filter(member => member.status === 'ACTIVE').length, inactiveMembers:members.filter(member => member.status !== 'ACTIVE').length, validMemberships:[...uniqueMemberships.values()].filter(payment => membershipIsValid(payment, now)).length, monthly },
    plans,
    clients:{ ages, sexes, withoutAge, topPayments, debts, totalDebt:debts.reduce((sum, row) => sum + row.amount, 0), futureDebt },
  };
}
