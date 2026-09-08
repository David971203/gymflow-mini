import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { styles } from '../theme/appStyles';

type ToastTone = 'error' | 'success' | 'warning' | 'rejected';
type ToastMessage = { message: string; tone: ToastTone };
type ToastSubscriber = { priority: number; show: (toast: ToastMessage) => void };

const toastSubscribers = new Map<symbol, ToastSubscriber>();
let pendingToast: ToastMessage | null = null;

function publishToast(message: string, tone: ToastTone) {
  const toast = { message, tone };
  const subscribers = [...toastSubscribers.values()].sort((left, right) => right.priority - left.priority);
  const subscriber = tone === 'error' || tone === 'rejected' ? subscribers[0] : subscribers[subscribers.length - 1];
  if (subscriber) subscriber.show(toast);
  else pendingToast = toast;
}

export function showError(error: unknown) {
  publishToast(error instanceof Error ? error.message : typeof error === 'string' ? error : 'Ocurrió un error', 'error');
}

export function showSuccess(message: string) { publishToast(message, 'success'); }
export function showPending(message: string) { publishToast(message, 'warning'); }
export function showRejected(message: string) { publishToast(message, 'rejected'); }

export function ToastHost({ active = true, priority = 0 }: { active?: boolean; priority?: number }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) return;
    const id = Symbol('toast-host');
    const show = (nextToast: ToastMessage) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setToast(nextToast);
      hideTimer.current = setTimeout(() => setToast(null), nextToast.tone === 'warning' ? 5200 : nextToast.tone === 'error' || nextToast.tone === 'rejected' ? 4500 : 3200);
    };
    toastSubscribers.set(id, { priority, show });
    if (pendingToast) {
      const queuedToast = pendingToast;
      pendingToast = null;
      show(queuedToast);
    }
    return () => {
      toastSubscribers.delete(id);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = null;
    };
  }, [active, priority]);

  if (!active || !toast) return null;
  const success = toast.tone === 'success';
  const warning = toast.tone === 'warning';
  const rejected = toast.tone === 'rejected';
  return <View pointerEvents="box-none" style={styles.errorToastLayer}>
    <View accessibilityRole="alert" accessibilityLiveRegion={toast.tone === 'error' || rejected ? 'assertive' : 'polite'} style={[styles.errorToast, success && styles.successToast, warning && styles.warningToast]}>
      <Ionicons name={success ? 'checkmark-circle' : warning ? 'time' : 'alert-circle'} size={23} color="#fff" />
      <View style={styles.errorToastBody}><Text style={styles.errorToastTitle}>{success ? 'Aprobada' : warning ? 'Pendiente' : rejected ? 'Rechazada' : 'No se pudo completar'}</Text><Text style={styles.errorToastMessage}>{toast.message}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Cerrar mensaje" onPress={() => setToast(null)} style={styles.errorToastClose}><Ionicons name="close" size={20} color="#fff" /></Pressable>
    </View>
  </View>;
}
