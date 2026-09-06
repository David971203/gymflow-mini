import * as SecureStore from 'expo-secure-store';

export const OFFLINE_SUBSCRIPTION_GRACE_MS = 72 * 60 * 60 * 1000;
export const SUBSCRIPTION_VALIDATION_MESSAGE = 'Conéctate a Internet para verificar la suscripción de tu gimnasio.';

const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;
const STORAGE_PREFIX = 'gymflow_mini_trusted_clock_';

type StoredClock = {
  serverTime: number;
  trustedTime: number;
  deviceTime: number;
  clockRollback: boolean;
};

type RuntimeClock = StoredClock & { performanceTime: number };

export type TrustedClockStatus = {
  now: number;
  allowedOffline: boolean;
  reason: 'OK' | 'UNVERIFIED' | 'GRACE_EXPIRED' | 'CLOCK_CHANGED';
};

const clocks = new Map<string, RuntimeClock>();
const storageKey = (scope: string) => `${STORAGE_PREFIX}${scope}`;
const monotonicNow = () => typeof performance !== 'undefined' ? performance.now() : 0;

function parseStoredClock(raw: string | null): StoredClock | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredClock>;
    if (![parsed.serverTime, parsed.trustedTime, parsed.deviceTime].every(value => typeof value === 'number' && Number.isFinite(value))) return null;
    return {
      serverTime: parsed.serverTime as number,
      trustedTime: parsed.trustedTime as number,
      deviceTime: parsed.deviceTime as number,
      clockRollback: parsed.clockRollback === true,
    };
  } catch {
    return null;
  }
}

function calculateTrustedNow(clock: RuntimeClock) {
  const deviceNow = Date.now();
  if (deviceNow + CLOCK_ROLLBACK_TOLERANCE_MS < clock.deviceTime) clock.clockRollback = true;
  const deviceElapsed = Math.max(0, deviceNow - clock.deviceTime);
  const monotonicElapsed = Math.max(0, monotonicNow() - clock.performanceTime);
  return clock.trustedTime + Math.max(deviceElapsed, monotonicElapsed);
}

export async function initializeTrustedClock(scope: string) {
  const stored = parseStoredClock(await SecureStore.getItemAsync(storageKey(scope)));
  if (!stored) {
    clocks.delete(scope);
    return;
  }
  const deviceNow = Date.now();
  clocks.set(scope, {
    serverTime: stored.serverTime,
    trustedTime: stored.trustedTime + Math.max(0, deviceNow - stored.deviceTime),
    deviceTime: deviceNow,
    performanceTime: monotonicNow(),
    clockRollback: stored.clockRollback || deviceNow + CLOCK_ROLLBACK_TOLERANCE_MS < stored.deviceTime,
  });
}

export async function recordServerTime(scope: string, serverTime: string) {
  const parsedServerTime = new Date(serverTime).getTime();
  if (!Number.isFinite(parsedServerTime)) return;
  const clock: RuntimeClock = {
    serverTime: parsedServerTime,
    trustedTime: parsedServerTime,
    deviceTime: Date.now(),
    performanceTime: monotonicNow(),
    clockRollback: false,
  };
  clocks.set(scope, clock);
  await SecureStore.setItemAsync(storageKey(scope), JSON.stringify({
    serverTime: clock.serverTime,
    trustedTime: clock.trustedTime,
    deviceTime: clock.deviceTime,
    clockRollback: clock.clockRollback,
  } satisfies StoredClock));
}

export async function persistTrustedClock(scope: string) {
  const clock = clocks.get(scope);
  if (!clock) return;
  const trustedTime = calculateTrustedNow(clock);
  const deviceTime = Date.now();
  clock.trustedTime = trustedTime;
  clock.deviceTime = deviceTime;
  clock.performanceTime = monotonicNow();
  await SecureStore.setItemAsync(storageKey(scope), JSON.stringify({
    serverTime: clock.serverTime,
    trustedTime,
    deviceTime,
    clockRollback: clock.clockRollback,
  } satisfies StoredClock));
}

export function getTrustedClockStatus(scope: string): TrustedClockStatus {
  const clock = clocks.get(scope);
  if (!clock) return { now: Date.now(), allowedOffline: false, reason: 'UNVERIFIED' };
  const now = calculateTrustedNow(clock);
  if (clock.clockRollback) return { now, allowedOffline: false, reason: 'CLOCK_CHANGED' };
  if (now - clock.serverTime > OFFLINE_SUBSCRIPTION_GRACE_MS) return { now, allowedOffline: false, reason: 'GRACE_EXPIRED' };
  return { now, allowedOffline: true, reason: 'OK' };
}
