import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { discardSyncIssue, getSyncIssues } from '../../offline';
import type { SyncIssue, SyncState } from '../../types';
import { BottomSheet } from '../../components/BottomSheet';
import { styles } from '../../theme/appStyles';

export function SyncBar({ state, onPress }: { state: SyncState; onPress: () => void }) {
  const labels: Record<SyncState['phase'], string> = { STARTING: 'Preparando datos', SYNCED: 'Datos al día', SYNCING: 'Sincronizando', OFFLINE: 'Modo sin conexión', ERROR: 'No se pudo sincronizar' };
  const detail = state.rejected > 0 ? `${state.rejected} cambio${state.rejected === 1 ? '' : 's'} requiere revisión` : state.pending > 0 ? `${state.pending} cambio${state.pending === 1 ? '' : 's'} pendiente` : state.message;
  return <Pressable onPress={onPress} style={[styles.syncBar, state.phase === 'OFFLINE' && styles.syncOffline, state.phase === 'ERROR' && styles.syncError]}>
    {state.phase === 'SYNCING' ? <ActivityIndicator size="small" color="#173f31" /> : <View style={[styles.syncDot, state.phase === 'SYNCED' && styles.syncDotOk]} />}
    <View style={styles.syncMain}><Text style={styles.syncTitle}>{labels[state.phase]}</Text>{detail ? <Text style={styles.syncDetail}>{detail}</Text> : null}</View>
    <Text style={styles.syncAction}>{state.rejected > 0 ? 'Revisar' : state.phase === 'SYNCING' ? '' : 'Sincronizar'}</Text>
  </Pressable>;
}

type SyncIssuesProps = {
  open: boolean;
  scope: string;
  revision: number;
  dark: boolean;
  onClose: () => void;
  onError: (error: unknown) => void;
  renderModalOverlay?: (active: boolean) => ReactNode;
};

export function SyncIssues({ open, scope, revision, dark, onClose, onError, renderModalOverlay }: SyncIssuesProps) {
  const [issues, setIssues] = useState<SyncIssue[]>([]);
  const load = useCallback(() => { void getSyncIssues(scope).then(setIssues).catch(onError); }, [onError, scope]);
  useEffect(() => { if (open) load(); }, [open, revision, load]);
  const names: Record<SyncIssue['type'], string> = { MEMBER_CREATE: 'Registrar miembro', MEMBER_CREATE_WITH_MEMBERSHIP: 'Registrar miembro con membresía', MEMBER_UPDATE: 'Editar miembro', MEMBER_DELETE: 'Eliminar miembro', PLAN_CREATE: 'Crear plan', PLAN_UPDATE: 'Editar plan', PLAN_DELETE: 'Eliminar plan', MEMBERSHIP_ASSIGN: 'Asignar o renovar membresía', MEMBERSHIP_UPDATE: 'Cancelar membresía', MEMBERSHIP_RENEW: 'Renovar membresía', MEMBERSHIP_DELETE: 'Eliminar renovación', PAYMENT_APPLY: 'Registrar cobro', ATTENDANCE_CHECK_IN: 'Registrar entrada', ATTENDANCE_CHECK_OUT: 'Registrar salida' };
  return <BottomSheet open={open} title="Cambios por revisar" onClose={onClose} dark={dark} overlay={renderModalOverlay?.(open)}>
    <Text style={styles.sheetCopy}>El servidor rechazó estos cambios. Los datos válidos ya fueron sincronizados.</Text>
    {issues.map(issue => <View key={issue.id} style={styles.issueCard}><Text style={styles.issueTitle}>{names[issue.type]}</Text><Text style={styles.issueDate}>{new Date(issue.occurredAt).toLocaleString('es-CU')}</Text><Text style={styles.issueError}>{issue.error}</Text><Pressable onPress={() => discardSyncIssue(scope, issue.id).then(load).catch(onError)}><Text style={styles.discard}>Descartar aviso</Text></Pressable></View>)}
    {!issues.length ? <Text style={styles.empty}>No hay cambios pendientes de revisión</Text> : null}
  </BottomSheet>;
}
