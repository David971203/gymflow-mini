import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, type BarcodeScanningResult, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { offline, syncNow } from './offline';
import type { Attendance, Member } from './types';

type Props = {
  scope: string;
  revision: number;
  dark: boolean;
  assertCanOperate: () => void;
  onError: (error: unknown) => void;
  onSuccess: (message: string) => void;
};

const fullName = (member: Pick<Member, 'firstName' | 'lastName'>) => `${member.firstName} ${member.lastName}`;
const formatTime = (value: string) => new Date(value).toLocaleTimeString('es-CU', { hour: '2-digit', minute: '2-digit' });

function hasCurrentMembership(member: Member, now: number) {
  return member.memberships.some((membership) => membership.status === 'ACTIVE'
    && new Date(membership.startDate).getTime() <= now
    && new Date(membership.endDate).getTime() >= now);
}

export function AttendanceScreen({ scope, revision, dark, assertCanOperate, onError, onSuccess }: Props) {
  const colors = dark ? darkColors : lightColors;
  const [members, setMembers] = useState<Member[]>([]);
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [qrMember, setQrMember] = useState<Member | null>(null);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextMembers, nextAttendances] = await Promise.all([offline.members(scope), offline.attendances(scope)]);
      setMembers(nextMembers);
      setAttendances(nextAttendances);
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }, [scope, onError]);

  useEffect(() => { void load(); }, [load, revision]);

  const refresh = useCallback(async () => {
    try { await syncNow(scope); } catch (error) { onError(error); }
    await load();
  }, [scope, load, onError]);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const today = attendances.filter((item) => new Date(item.checkInAt).getTime() >= startOfToday.getTime());
  const openByMember = useMemo(() => new Map(attendances.filter((item) => !item.checkOutAt).map((item) => [item.memberId, item])), [attendances]);
  const normalizedSearch = search.trim().toLocaleLowerCase('es-CU');
  const visibleMembers = members
    .filter((member) => !normalizedSearch || `${member.firstName} ${member.lastName} ${member.ci} ${member.code ?? ''}`.toLocaleLowerCase('es-CU').includes(normalizedSearch))
    .sort((left, right) => fullName(left).localeCompare(fullName(right), 'es-CU'))
    .slice(0, 30);

  const checkIn = async (member: Member, method: 'QR' | 'MANUAL' = 'MANUAL') => {
    setBusyMemberId(member.id);
    try {
      assertCanOperate();
      await offline.checkIn(scope, { memberId: member.id, method });
      onSuccess(`Entrada registrada para ${fullName(member)}.`);
      await load();
    } catch (error) {
      onError(error);
    } finally {
      setBusyMemberId(null);
    }
  };

  const checkOut = async (attendance: Attendance) => {
    setBusyMemberId(attendance.memberId);
    try {
      assertCanOperate();
      await offline.checkOut(scope, attendance.id);
      onSuccess(`Salida registrada para ${fullName(attendance.member)}.`);
      await load();
    } catch (error) {
      onError(error);
    } finally {
      setBusyMemberId(null);
    }
  };

  const checkInQr = async (value: string) => {
    try {
      assertCanOperate();
      const member = members.find((item) => item.qrCode?.toLowerCase() === value.trim().toLowerCase());
      if (!member) throw new Error('Este código QR no pertenece a un miembro del gimnasio');
      setBusyMemberId(member.id);
      await offline.checkInByQr(scope, value);
      setScannerOpen(false);
      onSuccess(`Entrada por QR registrada para ${fullName(member)}.`);
      await load();
    } catch (error) {
      onError(error);
      throw error;
    } finally {
      setBusyMemberId(null);
    }
  };

  return <>
    <ScrollView
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} colors={[colors.primary]} tintColor={colors.primary}/>}
      contentContainerStyle={[styles.scroll, { backgroundColor: colors.background }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.hero, { backgroundColor: colors.hero }]}>
        <View style={styles.heroTop}><View style={[styles.heroIcon, { backgroundColor: colors.heroIcon }]}><Ionicons name="scan" size={26} color={colors.heroText}/></View><View style={styles.flex}><Text style={[styles.heroTitle, { color: colors.heroText }]}>Control de acceso</Text><Text style={[styles.heroCopy, { color: colors.heroMuted }]}>Registra entradas incluso sin conexión</Text></View></View>
        <Pressable accessibilityRole="button" onPress={() => setScannerOpen(true)} style={({ pressed }) => [styles.scanButton, { backgroundColor: colors.accent }, pressed && styles.pressed]}><Ionicons name="qr-code-outline" size={21} color="#173f31"/><Text style={styles.scanButtonText}>Escanear código QR</Text></Pressable>
      </View>

      <View style={styles.metrics}>
        <Metric label="Entradas hoy" value={today.length} colors={colors}/>
        <Metric label="Dentro ahora" value={attendances.filter((item) => !item.checkOutAt).length} colors={colors}/>
        <Metric label="Salidas" value={today.filter((item) => !!item.checkOutAt).length} colors={colors}/>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Actividad de hoy</Text>
      <Text style={[styles.sectionCopy, { color: colors.muted }]}>Las entradas pendientes se enviarán cuando vuelva la conexión.</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {today.length ? today.map((attendance, index) => <View key={attendance.id} style={[styles.row, index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
          <View style={[styles.avatar, { backgroundColor: attendance.checkOutAt ? colors.neutralSoft : colors.successSoft }]}><Ionicons name={attendance.checkOutAt ? 'checkmark' : 'enter-outline'} size={20} color={attendance.checkOutAt ? colors.muted : colors.primary}/></View>
          <View style={styles.flex}><Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>{fullName(attendance.member)}</Text><Text style={[styles.rowCopy, { color: colors.muted }]}>Entrada {formatTime(attendance.checkInAt)} · {attendance.method === 'QR' ? 'QR' : 'Manual'}{attendance.checkOutAt ? ` · Salida ${formatTime(attendance.checkOutAt)}` : ''}</Text></View>
          {!attendance.checkOutAt ? <Pressable accessibilityRole="button" disabled={busyMemberId === attendance.memberId} onPress={() => void checkOut(attendance)} style={[styles.smallButton, { borderColor: colors.primary }]}>{busyMemberId === attendance.memberId ? <ActivityIndicator size="small" color={colors.primary}/> : <Text style={[styles.smallButtonText, { color: colors.primary }]}>Salida</Text>}</Pressable> : <View style={[styles.doneBadge, { backgroundColor: colors.neutralSoft }]}><Text style={[styles.doneText, { color: colors.muted }]}>Completada</Text></View>}
        </View>) : <Empty icon="walk-outline" text="Aún no hay entradas registradas hoy" colors={colors}/>}
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>Entrada manual y QR</Text>
      <Text style={[styles.sectionCopy, { color: colors.muted }]}>Busca un miembro para registrar su entrada o mostrarle su código.</Text>
      <View style={[styles.search, { backgroundColor: colors.card, borderColor: colors.border }]}><Ionicons name="search-outline" size={20} color={colors.muted}/><TextInput value={search} onChangeText={setSearch} placeholder="Nombre, CI o código" placeholderTextColor={colors.muted} style={[styles.input, { color: colors.text }]}/>{search ? <Pressable accessibilityRole="button" accessibilityLabel="Limpiar búsqueda" onPress={() => setSearch('')}><Ionicons name="close-circle" size={20} color={colors.muted}/></Pressable> : null}</View>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {visibleMembers.length ? visibleMembers.map((member, index) => {
          const open = openByMember.get(member.id);
          const eligible = member.status === 'ACTIVE' && hasCurrentMembership(member, Date.now());
          return <View key={member.id} style={[styles.memberRow, index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <View style={styles.flex}><Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>{fullName(member)}</Text><Text numberOfLines={1} style={[styles.rowCopy, { color: colors.muted }]}>{open ? `Dentro desde ${formatTime(open.checkInAt)}` : eligible ? 'Membresía vigente' : member.status !== 'ACTIVE' ? 'Miembro inactivo' : 'Sin membresía vigente'}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Mostrar QR de ${fullName(member)}`} disabled={!member.qrCode} onPress={() => setQrMember(member)} style={[styles.iconButton, { borderColor: colors.border }]}><Ionicons name="qr-code-outline" size={20} color={member.qrCode ? colors.primary : colors.muted}/></Pressable>
            {!open ? <Pressable accessibilityRole="button" disabled={!eligible || busyMemberId === member.id} onPress={() => void checkIn(member)} style={[styles.entryButton, { backgroundColor: eligible ? colors.primary : colors.disabled }]}>{busyMemberId === member.id ? <ActivityIndicator size="small" color="#fff"/> : <Text style={styles.entryButtonText}>Entrada</Text>}</Pressable> : null}
          </View>;
        }) : <Empty icon="people-outline" text="No se encontraron miembros" colors={colors}/>}
      </View>
    </ScrollView>
    <ScannerModal open={scannerOpen} dark={dark} onClose={() => setScannerOpen(false)} onCode={checkInQr}/>
    <QrModal member={qrMember} dark={dark} onClose={() => setQrMember(null)}/>
  </>;
}

function ScannerModal({ open, dark, onClose, onCode }: { open: boolean; dark: boolean; onClose: () => void; onCode: (value: string) => Promise<void> }) {
  const colors = dark ? darkColors : lightColors;
  const [permission, requestPermission] = useCameraPermissions();
  const locked = useRef(false);
  useEffect(() => { if (!open) locked.current = false; }, [open]);
  const scan = async ({ data }: BarcodeScanningResult) => {
    if (locked.current) return;
    locked.current = true;
    try { await onCode(data); } catch { setTimeout(() => { locked.current = false; }, 1200); }
  };
  return <Modal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}><SafeAreaView style={[styles.scanner, { backgroundColor: colors.background }]}>
    <View style={styles.modalHeader}><Pressable accessibilityRole="button" onPress={onClose} style={[styles.modalClose, { backgroundColor: colors.card }]}><Ionicons name="close" size={25} color={colors.text}/></Pressable><Text style={[styles.modalTitle, { color: colors.text }]}>Escanear entrada</Text><View style={styles.modalSpacer}/></View>
    {!permission ? <ActivityIndicator size="large" color={colors.primary}/> : !permission.granted ? <View style={styles.permission}><Ionicons name="camera-outline" size={48} color={colors.primary}/><Text style={[styles.permissionTitle, { color: colors.text }]}>Permiso de cámara</Text><Text style={[styles.permissionCopy, { color: colors.muted }]}>GymFlow Mini necesita la cámara para leer el QR del miembro.</Text><Pressable accessibilityRole="button" onPress={() => void requestPermission()} style={[styles.permissionButton, { backgroundColor: colors.primary }]}><Text style={styles.entryButtonText}>Permitir cámara</Text></Pressable></View> : <View style={styles.cameraWrap}><CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(result) => void scan(result)}/><View pointerEvents="none" style={styles.scanOverlay}><View style={styles.scanFrame}/><Text style={styles.scanHint}>Coloca el código dentro del recuadro</Text></View></View>}
  </SafeAreaView></Modal>;
}

function QrModal({ member, dark, onClose }: { member: Member | null; dark: boolean; onClose: () => void }) {
  const colors = dark ? darkColors : lightColors;
  return <Modal visible={!!member} transparent animationType="fade" onRequestClose={onClose}><View style={styles.qrBackdrop}><View style={[styles.qrCard, { backgroundColor: colors.card }]}>
    <Pressable accessibilityRole="button" accessibilityLabel="Cerrar código QR" onPress={onClose} style={styles.qrClose}><Ionicons name="close" size={24} color={colors.text}/></Pressable>
    <Text style={[styles.qrTitle, { color: colors.text }]}>Código de miembro</Text><Text style={[styles.qrName, { color: colors.primary }]}>{member ? fullName(member) : ''}</Text>
    {member?.qrCode ? <View style={styles.qrBox}><QRCode value={member.qrCode} size={220} backgroundColor="#ffffff" color="#173f31"/></View> : null}
    <Text style={[styles.qrCopy, { color: colors.muted }]}>Presenta este código en recepción para registrar la entrada.</Text>
  </View></View></Modal>;
}

type Colors = typeof lightColors;
function Metric({ label, value, colors }: { label: string; value: number; colors: Colors }) { return <View style={[styles.metric, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.metricValue, { color: colors.primary }]}>{value}</Text><Text numberOfLines={2} style={[styles.metricLabel, { color: colors.muted }]}>{label}</Text></View>; }
function Empty({ icon, text, colors }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string; colors: Colors }) { return <View style={styles.empty}><Ionicons name={icon} size={31} color={colors.muted}/><Text style={[styles.emptyText, { color: colors.muted }]}>{text}</Text></View>; }

const lightColors = { background: '#f4f6f3', card: '#ffffff', border: '#dce4de', text: '#14231d', muted: '#657169', primary: '#1d6b4d', accent: '#c9f47b', hero: '#173f31', heroIcon: '#295b49', heroText: '#ffffff', heroMuted: '#c7d6cf', successSoft: '#e8f5ce', neutralSoft: '#edf0ee', disabled: '#aeb7b1' };
const darkColors: typeof lightColors = { background: '#111612', card: '#1d241f', border: '#344039', text: '#f3f7f4', muted: '#aab5ae', primary: '#c9f47b', accent: '#c9f47b', hero: '#203d32', heroIcon: '#315746', heroText: '#ffffff', heroMuted: '#c7d6cf', successSoft: '#30482b', neutralSoft: '#303832', disabled: '#56615a' };

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 34, gap: 12 }, flex: { flex: 1 }, pressed: { opacity: .78 },
  hero: { borderRadius: 22, padding: 18, gap: 18 }, heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 }, heroIcon: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, heroTitle: { fontSize: 22, lineHeight: 27, fontWeight: '800' }, heroCopy: { marginTop: 3, fontSize: 13 },
  scanButton: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 }, scanButtonText: { color: '#173f31', fontSize: 15, fontWeight: '800' },
  metrics: { flexDirection: 'row', gap: 8 }, metric: { flex: 1, minHeight: 88, borderWidth: 1, borderRadius: 16, padding: 12, justifyContent: 'center' }, metricValue: { fontSize: 25, fontWeight: '900' }, metricLabel: { marginTop: 3, fontSize: 11, lineHeight: 14, fontWeight: '700' },
  sectionTitle: { marginTop: 7, fontSize: 18, fontWeight: '800' }, sectionCopy: { marginTop: -8, fontSize: 12, lineHeight: 17 }, card: { borderWidth: 1, borderRadius: 17, overflow: 'hidden' }, row: { minHeight: 72, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, memberRow: { minHeight: 69, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 8 }, avatar: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, rowTitle: { fontSize: 14, fontWeight: '800' }, rowCopy: { marginTop: 3, fontSize: 11, lineHeight: 15 },
  smallButton: { minWidth: 62, minHeight: 39, paddingHorizontal: 10, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, smallButtonText: { fontSize: 12, fontWeight: '800' }, doneBadge: { paddingHorizontal: 9, paddingVertical: 7, borderRadius: 9 }, doneText: { fontSize: 10, fontWeight: '700' },
  search: { minHeight: 50, borderWidth: 1, borderRadius: 14, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 8 }, input: { flex: 1, height: 48, fontSize: 14 }, iconButton: { width: 42, height: 42, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, entryButton: { minWidth: 67, height: 42, borderRadius: 12, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }, entryButtonText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  empty: { padding: 26, alignItems: 'center', gap: 8 }, emptyText: { textAlign: 'center', fontSize: 13 },
  scanner: { flex: 1 }, modalHeader: { height: 68, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, modalClose: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, modalTitle: { fontSize: 18, fontWeight: '800' }, modalSpacer: { width: 44 }, cameraWrap: { flex: 1, overflow: 'hidden' }, scanOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,.2)', alignItems: 'center', justifyContent: 'center', gap: 24 }, scanFrame: { width: 250, height: 250, borderWidth: 3, borderColor: '#c9f47b', borderRadius: 26 }, scanHint: { color: '#fff', fontSize: 14, fontWeight: '700', backgroundColor: 'rgba(0,0,0,.55)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  permission: { flex: 1, padding: 32, alignItems: 'center', justifyContent: 'center' }, permissionTitle: { marginTop: 18, fontSize: 22, fontWeight: '800' }, permissionCopy: { marginTop: 8, fontSize: 14, lineHeight: 20, textAlign: 'center' }, permissionButton: { marginTop: 22, minHeight: 48, borderRadius: 13, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  qrBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.62)', padding: 20, alignItems: 'center', justifyContent: 'center' }, qrCard: { width: '100%', maxWidth: 380, borderRadius: 24, padding: 24, alignItems: 'center' }, qrClose: { position: 'absolute', right: 14, top: 14, width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }, qrTitle: { marginTop: 10, fontSize: 14, fontWeight: '700' }, qrName: { marginTop: 5, fontSize: 22, fontWeight: '900', textAlign: 'center' }, qrBox: { marginTop: 22, padding: 16, borderRadius: 18, backgroundColor: '#fff' }, qrCopy: { marginTop: 19, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
