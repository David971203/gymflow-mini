export type Tab = 'INICIO' | 'MIEMBROS' | 'ASISTENCIA' | 'PLANES' | 'CAJA' | 'ESTADISTICAS' | 'PERSONAL' | 'CUENTA';
export type Currency = 'CUP' | 'USD';
export type GymSubscriptionPlan = 'TRIAL' | 'MONTHLY' | 'ANNUAL';
export type SubscriptionRequestAction = 'ACTIVATE' | 'RENEW' | 'CHANGE';
export type StaffRole = 'ADMIN' | 'RECEPTIONIST';
export type SubscriptionRequest = { id: string; code: string; plan: GymSubscriptionPlan; action: SubscriptionRequestAction; fromPlan?: GymSubscriptionPlan | null; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; requestedAt: string; resolvedAt?: string | null };
export type User = { id: string; email: string; phone?: string | null; phoneVerifiedAt?: string | null; name: string; role: StaffRole; gymId: string; gym: { name: string; province?: string | null; municipality?: string | null; currency: Currency; subscriptionPlan: GymSubscriptionPlan | null; subscriptionTrialDays: number; subscriptionStartedAt: string | null; subscriptionEndsAt: string | null; scheduledSubscriptionPlan?: GymSubscriptionPlan | null; scheduledSubscriptionStartsAt?: string | null; scheduledSubscriptionEndsAt?: string | null }; subscriptionRequest?: SubscriptionRequest | null; latestSubscriptionRequest?: SubscriptionRequest | null };
export type StaffAccount = { id: string; email: string; name: string; role: StaffRole; isActive: boolean; createdAt: string };
export type Dashboard = { members: number; activeMemberships: number; monthlyRevenue: number; pendingDebt: number; overdueDebt: number; futureDebt: number; recentPayments: Movement[] };
export type Plan = { id: string; name: string; description?: string; price: string; durationDays: number; isActive: boolean };
export type Payment = { id: string; amount: string; paidAmount: string; status: string; createdAt?: string; dueDate?: string | null; member: Member; membership: { id?: string; status?: string; startDate?: string; endDate?: string; plan: Plan; planName?: string; planPrice?: string; planDurationDays?: number; periodCount?: number }; movements: Movement[] };
export type Movement = { id: string; amount: string; occurredAt: string; payment?: { member: Member } };
export type Membership = { id: string; status: string; startDate: string; endDate: string; periodCount?: number; plan: Plan; planName?: string; planPrice?: string; planDurationDays?: number; payment?: Payment };
export type MemberSex = 'MALE' | 'FEMALE' | 'OTHER';
export type Member = { id: string; qrCode: string; ci: string; code?: string | null; firstName: string; lastName: string; age?: number | null; sex?: MemberSex | null; phone?: string; address?: string; status: string; joinedAt?: string; photoUpdatedAt?: string | null; memberships: Membership[] };

export type Attendance = { id: string; memberId: string; checkInAt: string; checkOutAt?: string | null; method: 'QR' | 'MANUAL'; member: Pick<Member, 'id' | 'firstName' | 'lastName' | 'status' | 'qrCode'> };

export type SyncOperationType = 'MEMBER_CREATE' | 'MEMBER_CREATE_WITH_MEMBERSHIP' | 'MEMBER_UPDATE' | 'MEMBER_DELETE' | 'PLAN_CREATE' | 'PLAN_UPDATE' | 'PLAN_DELETE' | 'MEMBERSHIP_ASSIGN' | 'MEMBERSHIP_UPDATE' | 'MEMBERSHIP_RENEW' | 'MEMBERSHIP_DELETE' | 'PAYMENT_APPLY' | 'ATTENDANCE_CHECK_IN' | 'ATTENDANCE_CHECK_OUT';
export type SyncOperation = { id: string; type: SyncOperationType; entityId: string; payload: Record<string, unknown>; occurredAt: string };
export type SyncResult = { id: string; type: SyncOperationType; entityId: string; status: 'APPLIED' | 'MERGED' | 'REJECTED'; result?: Record<string, unknown>; message?: string };
export type SyncSnapshot = { dashboard: Dashboard; members: Member[]; plans: Plan[]; payments: Payment[]; attendances: Attendance[]; serverTime: string };
export type SyncState = { phase: 'STARTING' | 'SYNCED' | 'SYNCING' | 'OFFLINE' | 'ERROR'; pending: number; rejected: number; lastSync?: string; message?: string };
export type SyncIssue = { id: string; type: SyncOperationType; entityId: string; payload: Record<string, unknown>; occurredAt: string; error: string };
