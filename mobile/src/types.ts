export type Tab = 'INICIO' | 'MIEMBROS' | 'PLANES' | 'CAJA' | 'CUENTA';
export type Currency = 'CUP' | 'USD';
export type GymSubscriptionPlan = 'TRIAL' | 'MONTHLY' | 'ANNUAL';
export type User = { id: string; email: string; name: string; role: 'ADMIN'; gymId: string; gym: { name: string; currency: Currency; subscriptionPlan: GymSubscriptionPlan; subscriptionTrialDays: number; subscriptionStartedAt: string; subscriptionEndsAt: string } };
export type Dashboard = { members: number; activeMemberships: number; monthlyRevenue: number; pendingDebt: number; recentPayments: Movement[] };
export type Plan = { id: string; name: string; description?: string; price: string; durationDays: number; isActive: boolean };
export type Payment = { id: string; amount: string; paidAmount: string; status: string; createdAt?: string; dueDate?: string | null; member: Member; membership: { id?: string; plan: Plan }; movements: Movement[] };
export type Movement = { id: string; amount: string; occurredAt: string; payment?: { member: Member } };
export type Membership = { id: string; status: string; startDate: string; endDate: string; plan: Plan; payment?: Payment };
export type MemberSex = 'MALE' | 'FEMALE' | 'OTHER';
export type Member = { id: string; ci: string; code?: string | null; firstName: string; lastName: string; age?: number | null; sex?: MemberSex | null; phone?: string; address?: string; status: string; memberships: Membership[] };

export type SyncOperationType = 'MEMBER_CREATE' | 'MEMBER_UPDATE' | 'MEMBER_DELETE' | 'PLAN_CREATE' | 'PLAN_UPDATE' | 'PLAN_DELETE' | 'MEMBERSHIP_ASSIGN' | 'MEMBERSHIP_UPDATE' | 'MEMBERSHIP_RENEW' | 'PAYMENT_APPLY';
export type SyncOperation = { id: string; type: SyncOperationType; entityId: string; payload: Record<string, unknown>; occurredAt: string };
export type SyncResult = { id: string; type: SyncOperationType; entityId: string; status: 'APPLIED' | 'MERGED' | 'REJECTED'; result?: Record<string, unknown>; message?: string };
export type SyncSnapshot = { dashboard: Dashboard; members: Member[]; plans: Plan[]; payments: Payment[]; serverTime: string };
export type SyncState = { phase: 'STARTING' | 'SYNCED' | 'SYNCING' | 'OFFLINE' | 'ERROR'; pending: number; rejected: number; lastSync?: string; message?: string };
export type SyncIssue = { id: string; type: SyncOperationType; entityId: string; payload: Record<string, unknown>; occurredAt: string; error: string };
