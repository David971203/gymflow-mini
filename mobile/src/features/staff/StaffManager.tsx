import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Keyboard, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { api } from '../../api';
import { RENEWAL_WHATSAPP } from '../../core/config';
import type { StaffAccount } from '../../types';
import { BottomSheet, FormField } from '../../components/BottomSheet';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { darkPalette, palette } from '../../theme/colors';
import { styles } from '../../theme/appStyles';

type StaffSection = 'RECEPTIONIST' | 'ADMIN' | 'TRAINER';
type IconName = React.ComponentProps<typeof Ionicons>['name'];

const staffSections: { id: StaffSection; label: string; icon: IconName }[] = [
  { id: 'RECEPTIONIST', label: 'Recepción', icon: 'person-outline' },
  { id: 'ADMIN', label: 'Administración', icon: 'shield-checkmark-outline' },
  { id: 'TRAINER', label: 'Entrenadores', icon: 'barbell-outline' },
];

type StaffManagerProps = {
  currentUserId: string;
  requesterName: string;
  gymName: string;
  dark: boolean;
  subscriptionIsActive: () => boolean;
  subscriptionErrorMessage: () => string;
  withActiveSubscription: (action: () => void) => void;
  ensureActiveSubscription: () => void;
  hasInternetConnection: () => Promise<boolean>;
  onError: (error: unknown) => void;
  onSuccess: (message: string) => void;
  renderModalOverlay?: (active: boolean) => ReactNode;
};

export function StaffManager({ currentUserId, requesterName, gymName, dark, subscriptionIsActive, subscriptionErrorMessage, withActiveSubscription, ensureActiveSubscription, hasInternetConnection, onError, onSuccess, renderModalOverlay }: StaffManagerProps) {
  const [section, setSection] = useState<StaffSection>('RECEPTIONIST');
  const [loadError, setLoadError] = useState(false);
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [selected, setSelected] = useState<StaffAccount | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    api.staff().then(setAccounts).catch(error => { setLoadError(true); onError(error); }).finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const begin = (account: StaffAccount | null) => {
    if (account && account.role !== 'RECEPTIONIST') return;
    withActiveSubscription(() => {
      setSelected(account);
      setName(account?.name ?? '');
      setEmail(account?.email ?? '');
      setPassword('');
      setIsActive(account?.isActive ?? true);
      setFormOpen(true);
    });
  };
  const close = () => {
    if (saving) return;
    Keyboard.dismiss();
    setFormOpen(false);
    setSelected(null);
  };
  const save = async () => {
    setSaving(true);
    try {
      ensureActiveSubscription();
      if (!await hasInternetConnection()) throw new Error('Conéctate a internet para gestionar las cuentas del personal');
      const input = { name: name.trim(), email: email.trim(), ...(password ? { password } : {}), ...(selected ? { isActive } : {}) };
      if (selected) await api.updateStaff(selected.id, input);
      else await api.createStaff({ ...input, password });
      onSuccess(selected ? 'Recepcionista actualizado.' : 'Recepcionista creado.');
      setFormOpen(false);
      setSelected(null);
      load();
    } catch (error) { onError(error); }
    finally { setSaving(false); }
  };
  const requestAdministrator = () => {
    if (!RENEWAL_WHATSAPP) { onError(new Error('Configura el número de soporte de GymFlow Mini.')); return; }
    const message = `Hola, soy ${requesterName}, administrador de ${gymName}. Necesito solicitar otra cuenta de administrador para mi gimnasio.`;
    void Linking.openURL(`https://wa.me/${RENEWAL_WHATSAPP}?text=${encodeURIComponent(message)}`).catch(() => onError(new Error('Comprueba que WhatsApp esté instalado.')));
  };
  const remove = () => {
    if (!selected || saving) return;
    if (!subscriptionIsActive()) { onError(new Error(subscriptionErrorMessage())); return; }
    Alert.alert('Eliminar cuenta', `¿Deseas eliminar la cuenta de ${selected.name}? Si tiene cobros registrados se desactivará para conservar el historial.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => {
        if (!subscriptionIsActive()) { onError(new Error(subscriptionErrorMessage())); return; }
        setSaving(true);
        void api.deleteStaff(selected.id).then(result => {
          onSuccess(result.disposition === 'DELETED' ? 'Cuenta eliminada.' : 'Cuenta desactivada para conservar el historial.');
          setFormOpen(false);
          setSelected(null);
          load();
        }).catch(onError).finally(() => setSaving(false));
      } },
    ]);
  };

  const valid = !!name.trim() && /^\S+@\S+\.\S+$/.test(email.trim()) && (selected ? !password || password.length >= 8 : password.length >= 8);
  const sectionAccounts = accounts.filter(account => account.role === section);

  return <>
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <Text style={styles.sheetCopy}>Organiza el equipo y controla quién tiene acceso a tu gimnasio.</Text>
      <View accessibilityRole="tablist" style={styles.statisticsTabs}>{staffSections.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: section === item.id }} onPress={() => setSection(item.id)} style={({ pressed }) => [styles.statisticsTab, section === item.id && styles.statisticsTabActive, pressed && styles.tabPressed]}><Ionicons name={item.icon} size={17} color={section === item.id ? (dark ? palette.accent : palette.action) : (dark ? darkPalette.secondary : palette.secondary)} /><Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statisticsTabText, section === item.id && styles.statisticsTabTextActive]}>{item.label}</Text></Pressable>)}</View>
      {section === 'TRAINER' ? <View style={[styles.statisticsCard, { marginBottom: 16 }]}><Text style={styles.securityTitle}>Entrenadores · Próximamente</Text><Text style={styles.sheetCopy}>Aquí podrás gestionar el equipo de entrenamiento cuando esta función esté disponible.</Text><Text style={styles.registrationNote}>Las cuentas de entrenador todavía no están habilitadas.</Text></View> : <>
        <View style={[styles.statisticsCard, { marginBottom: 16 }]}><Text style={styles.securityTitle}>{section === 'RECEPTIONIST' ? 'Acceso de recepción' : 'Acceso de administración'}</Text><Text style={styles.sheetCopy}>{section === 'RECEPTIONIST' ? 'Cada recepcionista entra con su propio correo y contraseña. Puede registrar y editar miembros, gestionar membresías, registrar cobros y asistencia, y consultar planes.' : 'Los administradores gestionan la operación del gimnasio, los planes, las estadísticas, la suscripción y las cuentas de recepción.'}</Text><Text style={styles.registrationNote}>{section === 'RECEPTIONIST' ? 'No puede eliminar miembros, modificar planes, ver estadísticas ni gestionar la suscripción o el personal.' : 'Las cuentas de administrador se gestionan mediante soporte.'}</Text></View>
        <View style={styles.memberListHeading}><Text style={styles.sectionHeading}>{section === 'RECEPTIONIST' ? 'Recepcionistas' : 'Administradores'}{!loading && !loadError ? ` · ${sectionAccounts.length}` : ''}</Text><Pressable accessibilityRole="button" accessibilityLabel="Actualizar personal" disabled={loading} onPress={load}><Ionicons name="refresh-outline" size={22} color={palette.action} /></Pressable></View>
        {loading ? <LoadingSkeleton rows={3} dark={dark} /> : sectionAccounts.map(account => <Pressable key={account.id} accessibilityRole="button" disabled={account.role !== 'RECEPTIONIST'} onPress={() => begin(account)} style={({ pressed }) => [styles.memberActionCard, pressed && styles.memberActionCardPressed]}><View style={styles.memberActionIcon}><Ionicons name={account.role === 'ADMIN' ? 'shield-checkmark-outline' : 'person-outline'} size={20} color={palette.action} /></View><View style={styles.rowMain}><Text style={styles.memberActionTitle}>{account.name}{account.id === currentUserId ? ' · Tú' : ''}</Text><Text style={styles.memberActionCopy}>{account.email}</Text><Text style={[styles.memberActionCopy, !account.isActive && styles.memberActionDeleteText]}>{account.role === 'ADMIN' ? 'Administrador · Gestionado por soporte' : 'Recepcionista'} · {account.isActive ? 'Activa' : 'Inactiva'}</Text></View>{account.role === 'RECEPTIONIST' ? <Ionicons name="chevron-forward" size={21} color={palette.secondary} /> : null}</Pressable>)}
        {loadError ? <><Empty text="No se pudo cargar el personal. Conéctate a internet e inténtalo de nuevo." /><PrimaryButton label="Reintentar" onPress={load} disabled={loading} /></> : !loading && !sectionAccounts.length ? <Empty text={section === 'RECEPTIONIST' ? 'Aún no hay recepcionistas. Añade la primera cuenta para tu equipo.' : 'No hay administradores para mostrar.'} /> : null}
        {section === 'RECEPTIONIST' ? <View style={{ marginTop: 20, marginBottom: 8 }}><PrimaryButton label="Añadir recepcionista" icon="person-add-outline" onPress={() => begin(null)} disabled={!subscriptionIsActive()} /></View> : <Pressable accessibilityRole="link" accessibilityLabel="Solicitar otro administrador por WhatsApp" onPress={requestAdministrator} style={({ pressed }) => [styles.supportButton, pressed && styles.tabPressed]}><View style={styles.supportIcon}><Ionicons name="logo-whatsapp" size={23} color={palette.white} /></View><View style={styles.rowMain}><Text style={styles.supportTitle}>Solicitar otro administrador</Text><Text style={styles.supportCopy}>Contacta con soporte para verificar la solicitud</Text></View><Ionicons name="open-outline" size={19} color={palette.white} /></Pressable>}
      </>}
    </ScrollView>
    <BottomSheet liftAboveKeyboard open={formOpen} title={selected ? 'Editar recepcionista' : 'Nuevo recepcionista'} onClose={close} dark={dark} overlay={renderModalOverlay?.(formOpen)} footer={<PrimaryButton label={saving ? 'Guardando…' : selected ? 'Guardar cambios' : 'Crear recepcionista'} icon="checkmark" disabled={!valid || saving} onPress={() => void save()} />}>
      <Text style={styles.sheetCopy}>El recepcionista entra con sus propias credenciales y tiene acceso a la operación diaria del gimnasio.</Text>
      <FormField dark={dark} label="Nombre" value={name} onChangeText={setName} /><FormField dark={dark} label="Correo" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" /><FormField dark={dark} label={selected ? 'Nueva contraseña (opcional)' : 'Contraseña'} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
      <Text style={styles.registrationNote}>Puede gestionar miembros, membresías, cobros y asistencia. No puede cambiar planes, suscripción ni cuentas.</Text>
      {selected ? <><Text style={styles.fieldLabel}>Estado</Text><View style={styles.statusChoices}><Pressable onPress={() => setIsActive(true)} style={[styles.statusChoice, isActive && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, isActive && styles.statusChoiceTextActive]}>Activa</Text></Pressable><Pressable disabled={selected.id === currentUserId} onPress={() => setIsActive(false)} style={[styles.statusChoice, !isActive && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, !isActive && styles.statusChoiceTextActive]}>Inactiva</Text></Pressable></View>{selected.id !== currentUserId ? <Pressable accessibilityRole="button" disabled={saving} onPress={remove} style={({ pressed }) => [styles.memberActionCard, styles.memberActionCardDelete, pressed && styles.memberActionCardPressed]}><View style={[styles.memberActionIcon, styles.memberActionIconDelete]}><Ionicons name="trash-outline" size={20} color={palette.danger} /></View><View style={styles.rowMain}><Text style={[styles.memberActionTitle, styles.memberActionDeleteText]}>Eliminar cuenta</Text><Text style={styles.memberActionCopy}>Revoca el acceso y conserva la trazabilidad</Text></View></Pressable> : null}</> : null}
    </BottomSheet>
  </>;
}

function PrimaryButton({ label, icon, onPress, disabled }: { label: string; icon?: IconName; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.primary, disabled && styles.disabled, pressed && styles.tabPressed]}>{icon ? <Ionicons name={icon} size={20} color={palette.white} /> : null}<Text maxFontSizeMultiplier={1.3} style={styles.primaryText}>{label}</Text></Pressable>;
}

function Empty({ text }: { text: string }) { return <Text style={styles.empty}>{text}</Text>; }
