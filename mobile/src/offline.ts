import * as Network from 'expo-network';
import * as SQLite from 'expo-sqlite';
import { api, ApiError } from './api';
import { initializeTrustedClock, recordServerTime } from './trustedClock';
import type { Dashboard, Member, Membership, Movement, Payment, Plan, SyncIssue, SyncOperation, SyncOperationType, SyncSnapshot, SyncState } from './types';

const dbPromise = SQLite.openDatabaseAsync('gymflow-mini-offline.db');
const listeners = new Set<() => void>();
const states = new Map<string, SyncState>();
const running = new Map<string, Promise<SyncState>>();

async function waitForActiveSync(scope: string) {
  const active = running.get(scope);
  if (active) await active.catch(() => undefined);
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

async function db() { return dbPromise; }

export async function initializeOffline(scope: string) {
  await initializeTrustedClock(scope);
  const database = await db();
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS local_cache (
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope, key)
    );
    CREATE TABLE IF NOT EXISTS sync_outbox (
      scope TEXT NOT NULL,
      id TEXT NOT NULL,
      type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (scope, id)
    );
    CREATE INDEX IF NOT EXISTS sync_outbox_scope_status_idx ON sync_outbox(scope, status, occurred_at);
  `);
  for (const [key, fallback] of [['members', []], ['plans', []], ['payments', []]] as const) {
    const existing = await readCache<unknown>(scope, key, null);
    if (existing === null) await writeCache(scope, key, fallback);
  }
  await updateState(scope, 'STARTING');
}

export function subscribeOffline(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() { listeners.forEach((listener) => listener()); }

export function getSyncState(scope: string): SyncState {
  return states.get(scope) ?? { phase: 'STARTING', pending: 0, rejected: 0 };
}

async function updateState(scope: string, phase: SyncState['phase'], extra: Partial<SyncState> = {}) {
  const database = await db();
  const counts = await database.getAllAsync<{ status: string; count: number }>(
    'SELECT status, COUNT(*) AS count FROM sync_outbox WHERE scope = ? GROUP BY status', scope,
  );
  const count = (status: string) => counts.find((row) => row.status === status)?.count ?? 0;
  const previous = getSyncState(scope);
  states.set(scope, { ...previous, phase, pending: count('PENDING'), rejected: count('REJECTED'), ...extra });
  emit();
  return getSyncState(scope);
}

async function readCache<T>(scope: string, key: string, fallback: T): Promise<T> {
  const row = await (await db()).getFirstAsync<{ value: string }>('SELECT value FROM local_cache WHERE scope = ? AND key = ?', scope, key);
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return fallback; }
}

async function writeCache(scope: string, key: string, value: unknown) {
  await (await db()).runAsync(
    `INSERT INTO local_cache(scope, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    scope, key, JSON.stringify(value), new Date().toISOString(),
  );
}

async function enqueue(scope: string, operation: SyncOperation) {
  await (await db()).runAsync(
    'INSERT INTO sync_outbox(scope, id, type, entity_id, payload, occurred_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    scope, operation.id, operation.type, operation.entityId, JSON.stringify(operation.payload), operation.occurredAt, 'PENDING',
  );
}

export const offline = {
  members: (scope: string) => readCache<Member[]>(scope, 'members', []),
  plans: (scope: string) => readCache<Plan[]>(scope, 'plans', []),
  payments: (scope: string) => readCache<Payment[]>(scope, 'payments', []),

  async dashboard(scope: string): Promise<Dashboard> {
    const [members, payments] = await Promise.all([offline.members(scope), offline.payments(scope)]);
    const now = new Date();
    const duePayments = payments.filter((payment) => {
      if (payment.status === 'CANCELLED') return false;
      if (!payment.dueDate) return true;
      const dueAt = new Date(payment.dueDate).getTime();
      return Number.isNaN(dueAt) || dueAt <= now.getTime();
    });
    const movements = payments.filter((payment) => payment.status !== 'CANCELLED').flatMap((payment) => payment.movements.map((movement) => ({ ...movement, payment: { member: payment.member } })));
    const monthly = movements.filter((movement) => { const date = new Date(movement.occurredAt); return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth(); });
    const activeMemberships = members.reduce((total, member) => total + member.memberships.filter((membership) => membership.status === 'ACTIVE' && new Date(membership.endDate) >= now).length, 0);
    return {
      members: members.length,
      activeMemberships,
      monthlyRevenue: Number(monthly.reduce((sum, movement) => sum + Number(movement.amount), 0).toFixed(2)),
      pendingDebt: Number(duePayments.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount) - Number(payment.paidAmount)), 0).toFixed(2)),
      recentPayments: monthly.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 5),
    };
  },

  async createMember(scope: string, input: Pick<Member, 'ci' | 'firstName' | 'lastName'> & Partial<Pick<Member, 'code' | 'age' | 'sex' | 'phone' | 'address'>>) {
    await waitForActiveSync(scope);
    const database = await db();
    const id = uuid(); const operationId = uuid(); const occurredAt = new Date().toISOString();
    await database.withTransactionAsync(async () => {
      const members = await offline.members(scope);
      if (members.some((member) => member.ci === input.ci)) throw new Error('Ya existe un miembro local con ese carnet de identidad');
      if (input.code && members.some((member) => member.code === input.code)) throw new Error('Ya existe un miembro local con ese código interno');
      members.unshift({ id, ...input, status: 'ACTIVE', joinedAt: occurredAt, memberships: [] });
      await writeCache(scope, 'members', members);
      await enqueue(scope, { id: operationId, type: 'MEMBER_CREATE', entityId: id, payload: input, occurredAt });
    });
    await updateState(scope, 'OFFLINE'); emit(); void syncNow(scope);
    return id;
  },

  async updateMember(scope: string, id: string, input: Partial<Pick<Member, 'ci' | 'code' | 'firstName' | 'lastName' | 'age' | 'sex' | 'phone' | 'address' | 'status'>>) {
    await waitForActiveSync(scope);
    const database = await db(); const operationId = uuid(); const occurredAt = new Date().toISOString();
    await database.withTransactionAsync(async () => {
      const members = await offline.members(scope);
      if (input.ci && members.some((member) => member.id !== id && member.ci === input.ci)) throw new Error('Ya existe un miembro local con ese carnet de identidad');
      if (input.code && members.some((member) => member.id !== id && member.code === input.code)) throw new Error('Ya existe un miembro local con ese código interno');
      await writeCache(scope, 'members', members.map((member) => member.id === id ? { ...member, ...input } : member));
      await enqueue(scope, { id: operationId, type: 'MEMBER_UPDATE', entityId: id, payload: input, occurredAt });
    });
    await updateState(scope, 'OFFLINE'); emit(); void syncNow(scope);
  },

  async deleteMember(scope: string, id: string) {
    await waitForActiveSync(scope);
    const database = await db(); const operationId = uuid(); const occurredAt = new Date().toISOString();
    await database.withTransactionAsync(async () => {
      const [members, payments] = await Promise.all([offline.members(scope), offline.payments(scope)]);
      const member = members.find((item) => item.id === id);
      if (!member) throw new Error('Miembro no encontrado en este dispositivo');
      const hasHistory = member.memberships.length > 0 || payments.some((payment) => payment.member.id === id);
      if (hasHistory) {
        const membershipsToCancel = member.memberships.filter((membership) => membership.status === 'ACTIVE' || membership.status === 'SCHEDULED');
        const membershipIds = new Set(membershipsToCancel.map((membership) => membership.id));
        const paymentIds = new Set(membershipsToCancel.flatMap((membership) => membership.payment?.id ? [membership.payment.id] : []));
        member.status = 'INACTIVE';
        member.memberships = member.memberships.map((membership) => membershipIds.has(membership.id)
          ? { ...membership, status: 'CANCELLED', ...(membership.payment ? { payment: { ...membership.payment, status: 'CANCELLED' } } : {}) }
          : membership);
        const archivedPayments = payments.map((payment) => membershipIds.has(payment.membership.id ?? '') || paymentIds.has(payment.id)
          ? { ...payment, status: 'CANCELLED', member: { ...payment.member, status: 'INACTIVE' } }
          : payment);
        await writeCache(scope, 'members', members);
        await writeCache(scope, 'payments', archivedPayments);
      } else {
        await writeCache(scope, 'members', members.filter((item) => item.id !== id));
      }
      await enqueue(scope, { id: operationId, type: 'MEMBER_DELETE', entityId: id, payload: {}, occurredAt });
    });
    await updateState(scope, 'OFFLINE'); emit(); void syncNow(scope);
  },

  async createPlan(scope: string, input: { name: string; price: number; durationDays: number }) {
    await waitForActiveSync(scope);
    const database = await db(); const id = uuid(); const operationId = uuid(); const occurredAt = new Date().toISOString();
    await database.withTransactionAsync(async () => {
      const plans = await offline.plans(scope);
      if (plans.some((plan) => plan.name.trim().toLowerCase() === input.name.trim().toLowerCase())) throw new Error('Ya existe un plan local con ese nombre');
      plans.push({ id, ...input, price: String(input.price), isActive: true });
      await writeCache(scope, 'plans', plans);
      await enqueue(scope, { id: operationId, type: 'PLAN_CREATE', entityId: id, payload: input, occurredAt });
    });
    await updateState(scope, 'OFFLINE'); emit(); void syncNow(scope);
    return id;
  },

  async updatePlan(scope: string, id: string, input: Partial<Pick<Plan, 'name' | 'description' | 'durationDays' | 'isActive'> & { price: number }>) {
    await waitForActiveSync(scope);
    const database = await db(); const operationId = uuid(); const occurredAt = new Date().toISOString();
    await database.withTransactionAsync(async () => {
      const plans = await offline.plans(scope);
      if (input.name && plans.some((plan) => plan.id !== id && plan.name.trim().toLowerCase() === input.name!.trim().toLowerCase())) throw new Error('Ya existe un plan local con ese nombre');
      await writeCache(scope, 'plans', plans.map((plan) => plan.id === id ? { ...plan, ...input, ...(input.price !== undefined ? { price: String(input.price) } : {}) } : plan));
      await enqueue(scope, { id: operationId, type: 'PLAN_UPDATE', entityId: id, payload: input, occurredAt });
    });
    await updateState(scope, 'OFFLINE'); emit(); void syncNow(scope);
  },

  async deletePlan(scope: string, id: string) {
    await waitForActiveSync(scope);
    const database = await db(); const operationId = uuid(); const occurredAt = new Date().toISOString();
    await database.withTransactionAsync(async () => {
      const [plans, members] = await Promise.all([offline.plans(scope), offline.members(scope)]);
      const plan = plans.find((item) => item.id === id);
      if (!plan) throw new Error('Plan no encontrado en este dispositivo');
      const memberships = members.flatMap((member) => member.memberships).filter((membership) => membership.plan.id === id);
      const now = Date.now();
      if (memberships.some((membership) => membership.status === 'ACTIVE' && new Date(membership.endDate).getTime() >= now)) throw new Error('No se puede eliminar un plan con membresías activas');
      await writeCache(scope, 'plans', memberships.length ? plans.map((item) => item.id === id ? { ...item, isActive: false } : item) : plans.filter((item) => item.id !== id));
      await enqueue(scope, { id: operationId, type: 'PLAN_DELETE', entityId: id, payload: {}, occurredAt });
    });
    await updateState(scope, 'OFFLINE'); emit(); void syncNow(scope);
  },

  async assignPlan(scope: string, input: { memberId: string; planId: string; periodCount?: number; initialPayment?: number; paymentMethod?: string }) {
    await waitForActiveSync(scope);
    const database = await db();
    const membershipId = uuid(); const paymentId = uuid(); const operationId = uuid(); const occurredAt = new Date().toISOString();
    await database.withTransactionAsync(async () => {
      const [members, plans, payments] = await Promise.all([offline.members(scope), offline.plans(scope), offline.payments(scope)]);
      const member = members.find((item) => item.id === input.memberId); const plan = plans.find((item) => item.id === input.planId && item.isActive);
      if (!member || !plan) throw new Error('No se encontró el miembro o plan en este dispositivo');
      if (member.memberships.some((membership) => membership.status === 'ACTIVE' && new Date(membership.endDate) >= new Date())) throw new Error('El miembro ya tiene una membresía activa');
      const periodCount = input.periodCount ?? 1;
      if (!Number.isInteger(periodCount) || periodCount < 1 || periodCount > 24) throw new Error('La cantidad de períodos debe ser un número entero entre 1 y 24');
      const startDate = new Date(); const endDate = new Date(startDate); endDate.setDate(endDate.getDate() + plan.durationDays * periodCount);
      const initial = input.initialPayment ?? 0; const total = Number(plan.price) * periodCount;
      if (initial > total) throw new Error('El abono inicial supera el precio del plan');
      const status = initial === 0 ? 'PENDING' : initial >= total ? 'PAID' : 'PARTIAL';
      const movements: Movement[] = initial > 0 ? [{ id: operationId, amount: String(initial), occurredAt }] : [];
      const membership: Membership = { id: membershipId, status: 'ACTIVE', startDate: startDate.toISOString(), endDate: endDate.toISOString(), periodCount, plan, planName:plan.name, planPrice:plan.price, planDurationDays:plan.durationDays };
      member.status = 'ACTIVE';
      const payment: Payment = { id: paymentId, amount: String(total), paidAmount: String(initial), status, createdAt: occurredAt, dueDate: startDate.toISOString(), member, membership: { id:membershipId, status:'ACTIVE', startDate:startDate.toISOString(), endDate:endDate.toISOString(), plan, planName:plan.name, planPrice:plan.price, planDurationDays:plan.durationDays, periodCount }, movements };
      member.memberships.unshift(membership); payments.unshift(payment);
      await writeCache(scope, 'members', members); await writeCache(scope, 'payments', payments);
      await enqueue(scope, { id: operationId, type: 'MEMBERSHIP_ASSIGN', entityId: membershipId, payload: { ...input, clientPaymentId: paymentId }, occurredAt });
    });
    await updateState(scope, 'OFFLINE'); emit(); void syncNow(scope);
    return membershipId;
  },

  async updateMembership(scope: string, memberId: string, membershipId: string, input: { planId: string; status: string }) {
    await waitForActiveSync(scope);
    const database = await db(); const operationId = uuid(); const occurredAt = new Date().toISOString();
    await database.withTransactionAsync(async () => {
      const [members, plans, payments] = await Promise.all([offline.members(scope), offline.plans(scope), offline.payments(scope)]);
      const member = members.find((item) => item.id === memberId); const membership = member?.memberships.find((item) => item.id === membershipId);
      if (!member || !membership) throw new Error('Membresía no encontrada en este dispositivo');
      if (membership.status === 'ACTIVE' && new Date(membership.endDate).getTime() >= Date.now() && input.planId !== membership.plan.id) throw new Error('No se puede cambiar el plan de una membresía mientras esté activa. Puedes cancelarla o esperar a que venza.');
      const plan = plans.find((item) => item.id === input.planId && (item.isActive || item.id === membership.plan.id));
      if (!plan) throw new Error('Plan no encontrado o inactivo');
      const oldPlanId = membership.plan.id;
      const payment = payments.find((item) => item.membership.id === membershipId) ?? payments.find((item) => item.member.id === memberId && item.membership.plan.id === oldPlanId);
      if (payment && Number(payment.paidAmount) > Number(plan.price)) throw new Error('El importe abonado supera el precio del nuevo plan');
      if (plan.id !== oldPlanId) membership.endDate = new Date(new Date(membership.startDate).getTime() + plan.durationDays * (membership.periodCount ?? 1) * 86_400_000).toISOString();
      if (plan.id !== oldPlanId) {
        membership.planName = plan.name; membership.planPrice = plan.price; membership.planDurationDays = plan.durationDays;
      }
      membership.plan = plan; membership.status = input.status;
      if (payment) {
        payment.membership.plan = plan;
        payment.membership.status = input.status;
        payment.membership.startDate = membership.startDate;
        payment.membership.endDate = membership.endDate;
        if (plan.id !== oldPlanId) {
          payment.membership.planName = plan.name; payment.membership.planPrice = plan.price; payment.membership.planDurationDays = plan.durationDays;
        }
        payment.amount = String(Number(plan.price) * (membership.periodCount ?? 1));
        payment.status = input.status === 'CANCELLED' ? 'CANCELLED' : Number(payment.paidAmount) === 0 ? 'PENDING' : Number(payment.paidAmount) >= Number(plan.price) ? 'PAID' : 'PARTIAL';
      }
      if (input.status === 'ACTIVE') member.status = 'ACTIVE';
      else if (input.status === 'CANCELLED' && !member.memberships.some((item) => item.id !== membershipId && item.status === 'ACTIVE' && new Date(item.endDate).getTime() >= Date.now())) member.status = 'INACTIVE';
      if (payment) payment.member.status = member.status;
      await writeCache(scope, 'members', members); await writeCache(scope, 'payments', payments);
      await enqueue(scope, { id: operationId, type: 'MEMBERSHIP_UPDATE', entityId: membershipId, payload: input, occurredAt });
    });
    await updateState(scope, 'OFFLINE'); emit(); void syncNow(scope);
  },

  async renewMembership(scope: string, memberId: string, currentMembershipId: string, input: { planId: string; periodCount?: number; initialPayment?: number; paymentMethod?: string }) {
    await waitForActiveSync(scope);
    const database = await db();
    const membershipId = uuid(); const paymentId = uuid(); const operationId = uuid(); const occurredAt = new Date().toISOString();
    await database.withTransactionAsync(async () => {
      const [members, plans, payments] = await Promise.all([offline.members(scope), offline.plans(scope), offline.payments(scope)]);
      const member = members.find((item) => item.id === memberId); const current = member?.memberships.find((item) => item.id === currentMembershipId);
      const plan = plans.find((item) => item.id === input.planId && item.isActive);
      if (!member || !current || !plan) throw new Error('No se encontró la membresía actual o el plan en este dispositivo');
      if (member.memberships.some((membership) => membership.status === 'SCHEDULED')) throw new Error('El miembro ya tiene una renovación programada');
      const periodCount = input.periodCount ?? 1;
      if (!Number.isInteger(periodCount) || periodCount < 1 || periodCount > 24) throw new Error('La cantidad de períodos debe ser un número entero entre 1 y 24');
      const now = new Date(); const currentEnd = new Date(current.endDate); const startDate = currentEnd > now ? currentEnd : now;
      const endDate = new Date(startDate); endDate.setDate(endDate.getDate() + plan.durationDays * periodCount);
      const initial = input.initialPayment ?? 0; const total = Number(plan.price) * periodCount;
      if (initial > total) throw new Error('El abono inicial supera el precio del plan');
      const paymentStatus = initial === 0 ? 'PENDING' : initial >= total ? 'PAID' : 'PARTIAL';
      const movements: Movement[] = initial > 0 ? [{ id: operationId, amount: String(initial), occurredAt }] : [];
      const membership: Membership = { id:membershipId, status:startDate > now ? 'SCHEDULED' : 'ACTIVE', startDate:startDate.toISOString(), endDate:endDate.toISOString(), periodCount, plan, planName:plan.name, planPrice:plan.price, planDurationDays:plan.durationDays };
      const payment: Payment = { id:paymentId, amount:String(total), paidAmount:String(initial), status:paymentStatus, createdAt:occurredAt, dueDate:startDate.toISOString(), member, membership:{ id:membershipId, status:startDate > now ? 'SCHEDULED' : 'ACTIVE', startDate:startDate.toISOString(), endDate:endDate.toISOString(), plan, planName:plan.name, planPrice:plan.price, planDurationDays:plan.durationDays, periodCount }, movements };
      member.memberships.unshift(membership); payments.unshift(payment);
      await writeCache(scope, 'members', members); await writeCache(scope, 'payments', payments);
      await enqueue(scope, { id: operationId, type: 'MEMBERSHIP_RENEW', entityId: currentMembershipId, payload: { ...input, clientMembershipId: membershipId, clientPaymentId: paymentId }, occurredAt });
    });
    await updateState(scope, 'OFFLINE'); emit(); void syncNow(scope);
    return membershipId;
  },

  async deleteScheduledMembership(scope: string, memberId: string, membershipId: string) {
    await waitForActiveSync(scope);
    const database = await db(); const operationId = uuid(); const occurredAt = new Date().toISOString();
    await database.withTransactionAsync(async () => {
      const [members, payments] = await Promise.all([offline.members(scope), offline.payments(scope)]);
      const member = members.find((item) => item.id === memberId); const membership = member?.memberships.find((item) => item.id === membershipId);
      if (!member || !membership) throw new Error('Renovación programada no encontrada en este dispositivo');
      if (membership.status !== 'SCHEDULED') throw new Error('Solo se pueden eliminar renovaciones programadas');
      member.memberships = member.memberships.filter((item) => item.id !== membershipId);
      await writeCache(scope, 'members', members);
      await writeCache(scope, 'payments', payments.filter((payment) => payment.membership.id !== membershipId));
      await enqueue(scope, { id: operationId, type: 'MEMBERSHIP_DELETE', entityId: membershipId, payload: {}, occurredAt });
    });
    await updateState(scope, 'OFFLINE'); emit(); void syncNow(scope);
  },

  async applyPayment(scope: string, paymentId: string, input: { amount: number; method: string }) {
    await waitForActiveSync(scope);
    const database = await db(); const operationId = uuid(); const occurredAt = new Date().toISOString();
    await database.withTransactionAsync(async () => {
      const payments = await offline.payments(scope); const payment = payments.find((item) => item.id === paymentId);
      if (!payment) throw new Error('Cobro no encontrado en este dispositivo');
      const balance = Number(payment.amount) - Number(payment.paidAmount);
      if (input.amount > balance) throw new Error(`El abono supera el saldo de ${balance.toFixed(2)}`);
      payment.paidAmount = String(Number(payment.paidAmount) + input.amount);
      payment.status = Number(payment.paidAmount) >= Number(payment.amount) ? 'PAID' : 'PARTIAL';
      payment.movements.unshift({ id: operationId, amount: String(input.amount), occurredAt });
      await writeCache(scope, 'payments', payments);
      await enqueue(scope, { id: operationId, type: 'PAYMENT_APPLY', entityId: paymentId, payload: input, occurredAt });
    });
    await updateState(scope, 'OFFLINE'); emit(); void syncNow(scope);
  },
};

export async function getSyncIssues(scope: string): Promise<SyncIssue[]> {
  const rows = await (await db()).getAllAsync<{ id: string; type: SyncOperationType; entity_id: string; payload: string; occurred_at: string; error: string }>(
    `SELECT id, type, entity_id, payload, occurred_at, COALESCE(error, 'Operación rechazada') AS error
     FROM sync_outbox WHERE scope = ? AND status = 'REJECTED' ORDER BY occurred_at DESC`, scope,
  );
  return rows.map((row) => ({ id: row.id, type: row.type, entityId: row.entity_id, payload: JSON.parse(row.payload) as Record<string, unknown>, occurredAt: row.occurred_at, error: row.error }));
}

export async function discardSyncIssue(scope: string, id: string) {
  await (await db()).runAsync('DELETE FROM sync_outbox WHERE scope = ? AND id = ? AND status = ?', scope, id, 'REJECTED');
  await updateState(scope, getSyncState(scope).phase); emit();
}

async function pendingOperations(scope: string): Promise<SyncOperation[]> {
  const rows = await (await db()).getAllAsync<{ id: string; type: SyncOperationType; entity_id: string; payload: string; occurred_at: string }>(
    `SELECT id, type, entity_id, payload, occurred_at FROM sync_outbox
     WHERE scope = ? AND status = 'PENDING' ORDER BY occurred_at ASC LIMIT 100`, scope,
  );
  return rows.map((row) => ({ id: row.id, type: row.type, entityId: row.entity_id, payload: JSON.parse(row.payload) as Record<string, unknown>, occurredAt: row.occurred_at }));
}

async function remapPendingReference(scope: string, fromId: string, toId: string) {
  if (fromId === toId) return;
  const database = await db();
  const rows = await database.getAllAsync<{ id: string; entity_id: string; payload: string }>(
    `SELECT id, entity_id, payload FROM sync_outbox WHERE scope = ? AND status = 'PENDING'`, scope,
  );
  for (const row of rows) {
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    for (const key of ['memberId', 'planId']) if (payload[key] === fromId) payload[key] = toId;
    await database.runAsync(
      'UPDATE sync_outbox SET entity_id = ?, payload = ? WHERE scope = ? AND id = ?',
      row.entity_id === fromId ? toId : row.entity_id, JSON.stringify(payload), scope, row.id,
    );
  }
}

async function applySnapshot(scope: string, snapshot: SyncSnapshot) {
  const database = await db();
  await database.withTransactionAsync(async () => {
    await writeCache(scope, 'members', snapshot.members);
    await writeCache(scope, 'plans', snapshot.plans);
    await writeCache(scope, 'payments', snapshot.payments);
    await writeCache(scope, 'serverDashboard', snapshot.dashboard);
  });
}

export function syncNow(scope: string): Promise<SyncState> {
  const active = running.get(scope); if (active) return active;
  const task = performSync(scope).finally(() => running.delete(scope));
  running.set(scope, task); return task;
}

async function performSync(scope: string): Promise<SyncState> {
  const network = await Network.getNetworkStateAsync().catch(() => null);
  if (network?.isConnected === false) return updateState(scope, 'OFFLINE', { message: 'Trabajando sin conexión' });
  await updateState(scope, 'SYNCING', { message: 'Enviando cambios…' });
  try {
    while (true) {
      const operations = await pendingOperations(scope);
      if (!operations.length) break;
      const response = await api.syncPush(operations);
      const database = await db();
      for (const result of response.results) {
        if (result.status === 'MERGED') {
          const canonicalId = result.result && typeof result.result === 'object' && !Array.isArray(result.result)
            ? result.result.id : undefined;
          if (typeof canonicalId === 'string') await remapPendingReference(scope, result.entityId, canonicalId);
        }
        await database.withTransactionAsync(async () => {
          if (result.status === 'REJECTED') {
            await database.runAsync('UPDATE sync_outbox SET status = ?, error = ?, attempts = attempts + 1 WHERE scope = ? AND id = ?', 'REJECTED', result.message ?? 'Operación rechazada', scope, result.id);
          } else {
            await database.runAsync('DELETE FROM sync_outbox WHERE scope = ? AND id = ?', scope, result.id);
          }
        });
      }
    }
    const snapshot = await api.syncSnapshot();
    await recordServerTime(scope, snapshot.serverTime);
    await applySnapshot(scope, snapshot);
    emit();
    return updateState(scope, 'SYNCED', { lastSync: snapshot.serverTime, message: undefined });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return updateState(scope, 'ERROR', { message: 'Conéctate e inicia sesión otra vez para sincronizar' });
    if (error instanceof ApiError) return updateState(scope, 'ERROR', { message: error.message });
    return updateState(scope, 'OFFLINE', { message: 'Cambios guardados; se enviarán al recuperar conexión' });
  }
}
