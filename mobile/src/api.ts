import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import type { Dashboard, Member, Payment, Plan, SyncOperation, SyncResult, SyncSnapshot, User } from './types';

const BASE_URL = `${process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3100'}/api`;
const TOKEN_KEY = 'gymflow_mini_token';
const SESSION_KEY = 'gymflow_mini_offline_session';
const DEVICE_KEY = 'gymflow_mini_installation_id';
const OFFLINE_SESSION_MS = 14 * 24 * 60 * 60 * 1000;

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  const multipart = typeof FormData !== 'undefined' && options?.body instanceof FormData;
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...(!multipart ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options?.headers },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(Array.isArray(data?.message) ? data.message.join(', ') : data?.message ?? 'No se pudo completar la operación', response.status);
  return data as T;
}

async function deviceId() {
  if (Platform.OS === 'android') {
    const androidId = Application.getAndroidId();
    if (androidId) return `android:${androidId}`;
  }
  if (Platform.OS === 'ios') {
    const iosId = await Application.getIosIdForVendorAsync();
    if (iosId) return `ios:${iosId}`;
  }
  const existing = await SecureStore.getItemAsync(DEVICE_KEY);
  if (existing) return existing;
  const generated = `install:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}:${Math.random().toString(36).slice(2)}`;
  await SecureStore.setItemAsync(DEVICE_KEY, generated);
  return generated;
}

async function persistSession(result: { accessToken?: string; user: User }) {
  if (result.accessToken) await SecureStore.setItemAsync(TOKEN_KEY, result.accessToken);
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify({ user: result.user, lastOnlineAt: Date.now() }));
  return result.user;
}

export const api = {
  login: async (email: string, password: string) => {
    const result = await request<{ accessToken: string; user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (result.user.role !== 'ADMIN') throw new Error('Esta aplicación es exclusiva para administradores de gimnasio');
    return persistSession(result);
  },
  googleLogin: async (idToken: string) => {
    const result = await request<{ accessToken: string; user: User }>('/auth/google', { method: 'POST', body: JSON.stringify({ idToken }) });
    if (result.user.role !== 'ADMIN') throw new Error('Esta aplicación es exclusiva para administradores de gimnasio');
    return persistSession(result);
  },
  forgotPassword: (email: string) => request<{ message: string }>('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (input: { email: string; code: string; newPassword: string }) => request<{ message: string }>('/auth/password/reset', { method: 'POST', body: JSON.stringify(input) }),
  changePassword: async (input: { currentPassword: string; newPassword: string }) => {
    const result = await request<{ accessToken: string; user: User }>('/auth/password/change', { method: 'POST', body: JSON.stringify(input) });
    return persistSession(result);
  },
  register: async (input: { ownerName: string; gymName: string; province?: string; phone: string; email: string; password: string }) => {
    const result = await request<{ accessToken: string; user: User }>('/auth/register', { method: 'POST', body: JSON.stringify({ ...input, deviceId: await deviceId() }) });
    return persistSession(result);
  },
  selectSubscription: async (plan: 'TRIAL' | 'MONTHLY' | 'ANNUAL') => {
    const result = await request<{ user: User }>('/auth/subscription', { method: 'POST', body: JSON.stringify({ plan, deviceId: await deviceId() }) });
    return persistSession(result);
  },
  refreshProfile: async () => persistSession({ user: await request<User>('/auth/me') }),
  restore: async () => {
    const cachedRaw = await SecureStore.getItemAsync(SESSION_KEY);
    const cached = cachedRaw ? JSON.parse(cachedRaw) as { user: User; lastOnlineAt: number } : null;
    try {
      const user = await request<User>('/auth/me');
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify({ user, lastOnlineAt: Date.now() }));
      return user;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        await SecureStore.deleteItemAsync(SESSION_KEY);
        throw error;
      }
      if (cached && Date.now() - cached.lastOnlineAt <= OFFLINE_SESSION_MS) return cached.user;
      throw new Error('Necesitas conexión para renovar la sesión de este dispositivo');
    }
  },
  logout: async () => { await SecureStore.deleteItemAsync(TOKEN_KEY); await SecureStore.deleteItemAsync(SESSION_KEY); },
  dashboard: () => request<Dashboard>('/dashboard'),
  members: () => request<Member[]>('/members'),
  createMember: (input: Pick<Member, 'ci' | 'firstName' | 'lastName'> & Partial<Pick<Member, 'code' | 'age' | 'sex' | 'phone' | 'address'>>) => request<Member>('/members', { method: 'POST', body: JSON.stringify(input) }),
  memberPhotoSource: async (member: Pick<Member, 'id' | 'photoUpdatedAt'>) => {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    return { uri:`${BASE_URL}/members/${member.id}/photo?v=${encodeURIComponent(member.photoUpdatedAt ?? '')}`, ...(token ? { headers:{ Authorization:`Bearer ${token}` } } : {}) };
  },
  uploadMemberPhoto: (id: string, uri: string) => {
    const form = new FormData();
    form.append('photo', { uri, name:'member-photo.jpg', type:'image/jpeg' } as unknown as Blob);
    return request<{ photoUpdatedAt: string }>(`/members/${id}/photo`, { method:'POST', body:form });
  },
  deleteMemberPhoto: (id: string) => request<{ id: string; photoUpdatedAt: null }>(`/members/${id}/photo`, { method:'DELETE' }),
  plans: () => request<Plan[]>('/plans'),
  createPlan: (input: { name: string; description?: string; price: number; durationDays: number }) => request<Plan>('/plans', { method: 'POST', body: JSON.stringify(input) }),
  updatePlan: (id: string, input: { name?: string; description?: string; price?: number; durationDays?: number; isActive?: boolean }) => request<Plan>(`/plans/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deletePlan: (id: string) => request<{ id: string; disposition: 'DELETED' | 'ARCHIVED' }>(`/plans/${id}`, { method: 'DELETE' }),
  assignPlan: (input: { memberId: string; planId: string; periodCount?: number; initialPayment?: number; paymentMethod?: string }) => request('/memberships', { method: 'POST', body: JSON.stringify(input) }),
  payments: () => request<Payment[]>('/payments'),
  applyPayment: (id: string, input: { amount: number; method: string }) => request(`/payments/${id}/applications`, { method: 'POST', body: JSON.stringify(input) }),
  syncPush: (operations: SyncOperation[]) => request<{ results: SyncResult[]; serverTime: string }>('/sync/push', { method: 'POST', body: JSON.stringify({ operations }) }),
  syncSnapshot: () => request<SyncSnapshot>('/sync/snapshot'),
};
