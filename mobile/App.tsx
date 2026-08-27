import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Modal, Pressable, RefreshControl, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Network from 'expo-network';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { api } from './src/api';
import { discardSyncIssue, getSyncIssues, getSyncState, initializeOffline, offline, subscribeOffline, syncNow } from './src/offline';
import type { Dashboard, Member, Payment, Plan, SyncIssue, SyncState, Tab, User } from './src/types';

const money = (value: number | string) => `$${Number(value).toLocaleString('es-CU')} CUP`;
const tabs: { id: Tab; icon: string; label: string }[] = [
  { id: 'INICIO', icon: '⌂', label: 'Inicio' }, { id: 'MIEMBROS', icon: '◉', label: 'Miembros' },
  { id: 'PLANES', icon: '▣', label: 'Planes' }, { id: 'CAJA', icon: '$', label: 'Caja' }, { id: 'CUENTA', icon: '●', label: 'Cuenta' },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);
  useEffect(() => { api.restore().then(setUser).catch(() => undefined).finally(() => setRestoring(false)); }, []);
  if (restoring) return <View style={styles.center}><ActivityIndicator color="#c9f47b" size="large" /></View>;
  if (!user) return <Login onLogin={setUser} />;
  return <AdminApp user={user} onLogout={async () => { await api.logout(); setUser(null); }} />;
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState('admin@habanafitness.cu');
  const [password, setPassword] = useState('AdminMini123!');
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true);
    try { onLogin(await api.login(email.trim(), password)); }
    catch (error) { Alert.alert('No pudimos entrar', (error as Error).message); }
    finally { setLoading(false); }
  };
  return <SafeAreaView style={styles.loginPage}>
    <ExpoStatusBar style="light" />
    <Image accessibilityLabel="Logo de GymFlow Mini" source={require('./assets/icon.png')} style={styles.logo} />
    <Text style={styles.loginBrand}>GymFlow <Text style={styles.mini}>MINI</Text></Text>
    <Text style={styles.loginTitle}>Tu gimnasio, bajo control.</Text>
    <Text style={styles.loginCopy}>Miembros, planes y caja en una aplicación simple.</Text>
    <View style={styles.loginCard}>
      <Field label="Correo" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <Field label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry />
      <PrimaryButton label={loading ? 'Entrando…' : 'Entrar'} onPress={submit} disabled={loading} />
    </View>
    <Text style={styles.version}>PILOTO CUBA · V0.1</Text>
  </SafeAreaView>;
}

function AdminApp({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('INICIO');
  const [ready, setReady] = useState(false); const [revision, setRevision] = useState(0); const [issuesOpen, setIssuesOpen] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>({ phase: 'STARTING', pending: 0, rejected: 0 });
  const scope = user.gymId;
  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeOffline(() => { if (mounted) { setRevision((value) => value + 1); setSyncState(getSyncState(scope)); } });
    void initializeOffline(scope).then(() => { if (mounted) { setReady(true); setSyncState(getSyncState(scope)); } return syncNow(scope); });
    const networkSubscription = Network.addNetworkStateListener((state) => { if (state.isConnected && state.isInternetReachable !== false) void syncNow(scope); });
    const appSubscription = AppState.addEventListener('change', (state) => { if (state === 'active') void syncNow(scope); });
    return () => { mounted = false; unsubscribe(); networkSubscription.remove(); appSubscription.remove(); };
  }, [scope]);
  if (!ready) return <View style={styles.center}><ActivityIndicator color="#c9f47b" size="large" /></View>;
  return <SafeAreaView style={styles.app}><StatusBar barStyle="dark-content" />
    <View style={styles.topbar}>
      <View><Text style={styles.kicker}>{user.gym.name.toUpperCase()}</Text><Text style={styles.screenTitle}>{tabs.find((item) => item.id === tab)?.label}</Text></View>
    </View>
    <SyncBar state={syncState} onPress={() => syncState.rejected > 0 ? setIssuesOpen(true) : void syncNow(scope)} />
    <View style={styles.content}>
      {tab === 'INICIO' && <DashboardScreen scope={scope} revision={revision} />}
      {tab === 'MIEMBROS' && <MembersScreen scope={scope} revision={revision} />}
      {tab === 'PLANES' && <PlansScreen scope={scope} revision={revision} />}
      {tab === 'CAJA' && <PaymentsScreen scope={scope} revision={revision} />}
      {tab === 'CUENTA' && <AccountScreen user={user} onLogout={onLogout} />}
    </View>
    <View style={styles.tabbar}>{tabs.map((item) => <Pressable key={item.id} onPress={() => setTab(item.id)} style={styles.tab}>
      <Text style={[styles.tabIcon, tab === item.id && styles.tabActive]}>{item.icon}</Text><Text style={[styles.tabLabel, tab === item.id && styles.tabActive]}>{item.label}</Text>
    </Pressable>)}</View>
    <SyncIssues open={issuesOpen} scope={scope} revision={revision} onClose={() => setIssuesOpen(false)} />
  </SafeAreaView>;
}

type ScreenProps = { scope: string; revision: number };

function DashboardScreen({ scope, revision }: ScreenProps) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => { setLoading(true); offline.dashboard(scope).then(setData).catch(showError).finally(() => setLoading(false)); }, [scope]);
  const refresh = useCallback(() => { setLoading(true); syncNow(scope).then(() => offline.dashboard(scope)).then(setData).catch(showError).finally(() => setLoading(false)); }, [scope]);
  useEffect(load, [load, revision]);
  return <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />} contentContainerStyle={styles.scroll}>
    <View style={styles.hero}><Text style={styles.heroLabel}>INGRESOS DE AGOSTO</Text><Text style={styles.heroValue}>{money(data?.monthlyRevenue ?? 0)}</Text><Text style={styles.heroHint}>Dinero realmente cobrado</Text></View>
    <View style={styles.metricGrid}><Metric label="Miembros" value={data?.members ?? 0} /><Metric label="Membresías activas" value={data?.activeMemberships ?? 0} /><Metric label="Por cobrar" value={money(data?.pendingDebt ?? 0)} wide /></View>
    <SectionTitle title="Últimos cobros" subtitle="Movimientos registrados por el gimnasio" />
    <View style={styles.card}>{data?.recentPayments.length ? data.recentPayments.map((movement) => <Row key={movement.id} title={`${movement.payment?.member.firstName} ${movement.payment?.member.lastName}`} subtitle={new Date(movement.occurredAt).toLocaleDateString('es-CU')} value={`+ ${money(movement.amount)}`} />) : <Empty text="Aún no hay cobros este mes" />}</View>
  </ScrollView>;
}

function AccountScreen({ user, onLogout }: { user: User; onLogout: () => void }) {
  const confirmLogout = () => Alert.alert('Cerrar sesión', '¿Deseas salir de GymFlow Mini en este dispositivo?', [{ text:'Cancelar', style:'cancel' }, { text:'Cerrar sesión', style:'destructive', onPress:onLogout }]);
  return <ScrollView contentContainerStyle={styles.accountScroll}><View style={styles.accountHero}><Text style={styles.accountHeroLabel}>GIMNASIO</Text><Text style={styles.accountHeroGym}>{user.gym.name}</Text></View><View style={styles.accountCard}><AccountRow label="Correo" value={user.email}/><AccountRow label="Gimnasio" value={user.gym.name}/><AccountRow label="Moneda" value={user.gym.currency}/><AccountRow label="Rol" value="Administrador" last/></View><Pressable accessibilityRole="button" onPress={confirmLogout} style={({pressed}) => [styles.logoutButton, pressed && styles.logoutButtonPressed]}><View style={styles.logoutIcon}><Text style={styles.logoutIconText}>↪</Text></View><View style={styles.rowMain}><Text style={styles.logoutTitle}>Cerrar sesión</Text><Text style={styles.logoutCopy}>Salir de esta cuenta en el dispositivo</Text></View></Pressable><Text style={styles.accountVersion}>GYMFLOW MINI · PILOTO CUBA · V0.1</Text></ScrollView>;
}

function AccountRow({ label, value, last }: { label: string; value: string; last?: boolean }) { return <View style={[styles.accountRow,last&&styles.accountRowLast]}><Text style={styles.accountLabel}>{label}</Text><Text style={styles.accountValue}>{value}</Text></View>; }

function MembersScreen({ scope, revision }: ScreenProps) {
  const [members, setMembers] = useState<Member[]>([]); const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true); const [search, setSearch] = useState(''); const [addOpen, setAddOpen] = useState(false); const [selected, setSelected] = useState<Member | null>(null); const [editing, setEditing] = useState<Member | null>(null); const [assigning, setAssigning] = useState<Member | null>(null);
  const load = useCallback(() => { setLoading(true); Promise.all([offline.members(scope), offline.plans(scope)]).then(([m, p]) => { setMembers(m); setPlans(p); }).catch(showError).finally(() => setLoading(false)); }, [scope]);
  const refresh = useCallback(() => { void syncNow(scope).then(load); }, [scope, load]);
  const confirmDelete = (member: Member) => Alert.alert('Eliminar miembro', `¿Deseas eliminar a ${member.firstName} ${member.lastName}? Si tiene historial, se archivará como inactivo.`, [{ text:'Cancelar', style:'cancel' }, { text:'Eliminar', style:'destructive', onPress:() => { void offline.deleteMember(scope, member.id).then(() => { setSelected(null); load(); }).catch(showError); } }]);
  const query=search.trim().toLocaleLowerCase('es'); const visibleMembers=query ? members.filter(member => `${member.firstName} ${member.lastName} ${member.ci} ${member.phone ?? ''} ${member.address ?? ''}`.toLocaleLowerCase('es').includes(query)) : members;
  useEffect(load, [load, revision]);
  return <>
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />} contentContainerStyle={styles.scroll}>
      <PrimaryButton label="+ Registrar miembro" onPress={() => setAddOpen(true)} />
      <View style={styles.memberSearch}><Text style={styles.memberSearchIcon}>⌕</Text><TextInput accessibilityLabel="Buscar miembros" value={search} onChangeText={setSearch} placeholder="Nombre, CI, teléfono o dirección" placeholderTextColor="#97a19b" autoCorrect={false} style={styles.memberSearchInput}/>{search ? <Pressable accessibilityRole="button" accessibilityLabel="Limpiar búsqueda" onPress={() => setSearch('')} style={styles.memberSearchClear}><Text style={styles.memberSearchClearText}>×</Text></Pressable> : null}</View>
      <SectionTitle title={query ? `${visibleMembers.length} resultado${visibleMembers.length === 1 ? '' : 's'}` : `${members.length} miembros`} subtitle={query ? `Búsqueda dinámica entre ${members.length} miembros` : "Toca un miembro para ver sus opciones"} />
      <View style={styles.card}>{visibleMembers.map(member => { const current = editableMembership(member) ?? member.memberships[0]; return <Pressable accessibilityRole="button" accessibilityLabel={`Opciones de ${member.firstName} ${member.lastName}`} onPress={() => setSelected(member)} key={member.id} style={({pressed}) => [styles.memberRow, pressed && styles.memberRowPressed]}>
        <View style={styles.memberAvatar}><Text style={styles.memberAvatarText}>{member.firstName[0]}{member.lastName[0]}</Text></View><View style={styles.rowMain}><Text style={styles.rowTitle}>{member.firstName} {member.lastName}</Text><Text style={styles.rowSubtitle}>CI {member.ci}</Text><View style={styles.memberPlanLine}><View style={[styles.memberPlanDot, current && styles.memberPlanDotActive]}/><Text style={styles.memberPlanText}>{current ? `${current.plan.name} · ${membershipStatusLabel(current.status)}` : 'Sin plan asignado'}</Text></View></View><Text style={styles.memberChevron}>›</Text>
      </Pressable>; })}{!visibleMembers.length && <Empty text={query ? "No se encontraron miembros" : "Registra tu primer miembro"} />}</View>
    </ScrollView>
    <MemberActions member={selected} onClose={() => setSelected(null)} onEdit={() => { if (selected) setEditing(selected); setSelected(null); }} onPlan={() => { if (selected) setAssigning(selected); setSelected(null); }} onDelete={() => { if (selected) confirmDelete(selected); }} />
    <MemberForm scope={scope} open={addOpen || !!editing} member={editing} onClose={() => { setAddOpen(false); setEditing(null); }} onSaved={() => { setAddOpen(false); setEditing(null); load(); }} />
    <AssignPlanForm scope={scope} member={assigning} plans={plans} onClose={() => setAssigning(null)} onSaved={() => { setAssigning(null); load(); }} />
  </>;
}

function MemberActions({ member, onClose, onEdit, onPlan, onDelete }: { member: Member | null; onClose: () => void; onEdit: () => void; onPlan: () => void; onDelete: () => void }) {
  const editable = member ? editableMembership(member) : undefined; const membership = editable ?? member?.memberships[0];
  return <Sheet open={!!member} title="Opciones del miembro" onClose={onClose}><View style={styles.memberProfile}><View style={styles.memberProfileAvatar}><Text style={styles.memberProfileInitials}>{member ? `${member.firstName[0]}${member.lastName[0]}` : ''}</Text></View><View style={styles.rowMain}><Text style={styles.memberProfileName}>{member?.firstName} {member?.lastName}</Text><Text style={styles.memberProfileMeta}>CI {member?.ci}{member?.phone ? ` · ${member.phone}` : ''}</Text><Text style={styles.memberProfilePlan}>{membership ? `${membership.plan.name} · ${membershipStatusLabel(membership.status)}` : 'Sin membresía vigente'}</Text></View></View><View style={styles.memberActionGrid}><Pressable accessibilityRole="button" onPress={onEdit} style={({pressed}) => [styles.memberActionCard, pressed && styles.memberActionCardPressed]}><View style={styles.memberActionIcon}><Text style={styles.memberActionIconText}>✎</Text></View><View style={styles.rowMain}><Text style={styles.memberActionTitle}>Editar datos</Text><Text style={styles.memberActionCopy}>Nombre, CI, teléfono, dirección y estado</Text></View><Text style={styles.memberActionChevron}>›</Text></Pressable><Pressable accessibilityRole="button" onPress={onPlan} style={({pressed}) => [styles.memberActionCard, styles.memberActionCardPlan, pressed && styles.memberActionCardPressed]}><View style={[styles.memberActionIcon, styles.memberActionIconPlan]}><Text style={styles.memberActionIconText}>◆</Text></View><View style={styles.rowMain}><Text style={styles.memberActionTitle}>{editable ? 'Gestionar plan' : 'Asignar plan'}</Text><Text style={styles.memberActionCopy}>{editable ? 'Cambiar plan o estado de la membresía' : 'Crear una nueva membresía para este miembro'}</Text></View><Text style={styles.memberActionChevron}>›</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Eliminar miembro" onPress={onDelete} style={({pressed}) => [styles.memberActionCard, styles.memberActionCardDelete, pressed && styles.memberActionCardPressed]}><View style={[styles.memberActionIcon, styles.memberActionIconDelete]}><Text style={[styles.memberActionIconText, styles.memberActionDeleteText]}>×</Text></View><View style={styles.rowMain}><Text style={[styles.memberActionTitle, styles.memberActionDeleteText]}>Eliminar miembro</Text><Text style={styles.memberActionCopy}>Elimina el registro o lo archiva si tiene historial</Text></View></Pressable></View></Sheet>;
}

function PlansScreen({ scope, revision }: ScreenProps) {
  const [plans, setPlans] = useState<Plan[]>([]); const [loading, setLoading] = useState(true); const [open, setOpen] = useState(false); const [selected, setSelected] = useState<Plan | null>(null); const [editing, setEditing] = useState<Plan | null>(null);
  const load = useCallback(() => { setLoading(true); offline.plans(scope).then(setPlans).catch(showError).finally(() => setLoading(false)); }, [scope]);
  const refresh = useCallback(() => { void syncNow(scope).then(load); }, [scope, load]);
  const onlineAction = async (action: () => void) => { if (!await hasInternetConnection()) { showOnlineRequired(); return; } action(); };
  const confirmDelete = (plan: Plan) => { void onlineAction(() => Alert.alert('Eliminar plan', `¿Deseas eliminar el plan ${plan.name}? No podrá eliminarse si tiene membresías activas.`, [{ text:'Cancelar', style:'cancel' }, { text:'Eliminar', style:'destructive', onPress:() => { void api.deletePlan(plan.id).then(() => syncNow(scope)).then(() => { setSelected(null); load(); }).catch(showError); } }])); };
  useEffect(load, [load, revision]);
  return <><ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />} contentContainerStyle={styles.scroll}>
    <PrimaryButton label="+ Crear plan" onPress={() => { void onlineAction(() => setOpen(true)); }} />
    <SectionTitle title="Planes del gimnasio" subtitle="Crear, editar y eliminar requieren conexión" />
    {plans.map(plan => <Pressable accessibilityRole="button" onPress={() => setSelected(plan)} key={plan.id} style={({pressed}) => [styles.planCard, pressed && styles.planCardPressed]}><View style={styles.rowMain}><View style={styles.planTitleLine}><Text style={styles.planName}>{plan.name}</Text><View style={[styles.planState, plan.isActive && styles.planStateActive]}><Text style={[styles.planStateText, plan.isActive && styles.planStateTextActive]}>{plan.isActive ? 'Activo' : 'Inactivo'}</Text></View></View><Text style={styles.rowSubtitle}>{plan.durationDays} días{plan.description ? ` · ${plan.description}` : ''}</Text></View><Text style={styles.planPrice}>{money(plan.price)}</Text><Text style={styles.memberChevron}>›</Text></Pressable>)}
  </ScrollView><PlanActions plan={selected} onClose={() => setSelected(null)} onEdit={() => { void onlineAction(() => { if (selected) setEditing(selected); setSelected(null); }); }} onDelete={() => { if (selected) confirmDelete(selected); }}/><PlanForm scope={scope} open={open || !!editing} plan={editing} onClose={() => { setOpen(false); setEditing(null); }} onSaved={() => { setOpen(false); setEditing(null); load(); }} /></>;
}

function PaymentsScreen({ scope, revision }: ScreenProps) {
  const [payments, setPayments] = useState<Payment[]>([]); const [loading, setLoading] = useState(true); const [selected, setSelected] = useState<Payment | null>(null);
  const load = useCallback(() => { setLoading(true); offline.payments(scope).then(setPayments).catch(showError).finally(() => setLoading(false)); }, [scope]);
  const refresh = useCallback(() => { void syncNow(scope).then(load); }, [scope, load]);
  useEffect(load, [load, revision]);
  const debt = payments.reduce((sum, payment) => payment.status === 'CANCELLED' ? sum : sum + Math.max(0, Number(payment.amount) - Number(payment.paidAmount)), 0);
  return <><ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />} contentContainerStyle={styles.scroll}>
    <View style={styles.debtCard}><Text style={styles.heroLabel}>TOTAL POR COBRAR</Text><Text style={styles.debtValue}>{money(debt)}</Text></View>
    <SectionTitle title="Cobros" subtitle="Registra abonos parciales o pagos completos" />
    <View style={styles.card}>{payments.map(payment => {
      const total = Number(payment.amount);
      const paid = Math.min(total, Math.max(0, Number(payment.paidAmount)));
      const balance = Math.max(0, total - paid);
      const status = paymentDisplayStatus(payment, total, paid, balance);
      const disabled = balance <= 0 || payment.status === 'CANCELLED';
      const progress = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
      return <Pressable disabled={disabled} onPress={() => setSelected(payment)} key={payment.id} style={({pressed}) => [styles.paymentDetailRow, pressed && styles.paymentDetailRowPressed]}>
        <View style={styles.paymentDetailHead}><View style={styles.rowMain}><Text style={styles.rowTitle}>{payment.member.firstName} {payment.member.lastName}</Text><Text style={styles.rowSubtitle}>{payment.membership.plan.name}</Text></View><View style={[styles.paymentBadge, status.tone === 'success' && styles.paymentBadgeSuccess, status.tone === 'danger' && styles.paymentBadgeDanger]}><Text style={[styles.paymentBadgeText, status.tone === 'success' && styles.paymentBadgeTextSuccess, status.tone === 'danger' && styles.paymentBadgeTextDanger]}>{status.label}</Text></View></View>
        <View style={styles.paymentAmounts}><View><Text style={styles.paymentAmountLabel}>PAGADO</Text><Text style={styles.paymentPaid}>{money(paid)}</Text></View><View><Text style={[styles.paymentAmountLabel, styles.paymentAmountRight]}>TOTAL</Text><Text style={styles.paymentTotal}>{money(total)}</Text></View></View>
        <View style={styles.paymentProgress}><View style={[styles.paymentProgressFill, { width: `${progress}%` }]} /></View>
        {!disabled ? <Text style={styles.paymentBalanceCopy}>Saldo pendiente: {money(balance)} · Toca para cobrar</Text> : null}
      </Pressable>;
    })}</View>
  </ScrollView><PaymentForm scope={scope} payment={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); load(); }} /></>;
}

function MemberForm({ scope, open, member, onClose, onSaved }: FormProps & { member: Member | null }) {
  const [ci, setCi] = useState(''); const [firstName, setFirstName] = useState(''); const [lastName, setLastName] = useState(''); const [phone, setPhone] = useState(''); const [address, setAddress] = useState(''); const [status, setStatus] = useState('ACTIVE'); const [saving, setSaving] = useState(false);
  useEffect(() => { if (!open) return; setCi(member?.ci ?? ''); setFirstName(member?.firstName ?? ''); setLastName(member?.lastName ?? ''); setPhone(member?.phone ?? ''); setAddress(member?.address ?? ''); setStatus(member?.status ?? 'ACTIVE'); }, [open, member]);
  const save = async () => { setSaving(true); try { const input = { ci, firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim(), address: address.trim(), status }; if (member) await offline.updateMember(scope, member.id, input); else await offline.createMember(scope, { ci, firstName: input.firstName, lastName: input.lastName, phone: input.phone }); onSaved(); } catch (error) { showError(error); } finally { setSaving(false); } };
  return <Sheet open={open} title={member ? "Editar miembro" : "Nuevo miembro"} onClose={onClose}><Field label="Carnet de identidad (11 dígitos)" value={ci} onChangeText={(value) => setCi(value.replace(/\D/g, '').slice(0, 11))} keyboardType="number-pad" maxLength={11} /><Field label="Nombre" value={firstName} onChangeText={setFirstName} /><Field label="Apellidos" value={lastName} onChangeText={setLastName} /><Field label="Teléfono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />{member && <><Field label="Dirección" value={address} onChangeText={setAddress} /><Text style={styles.fieldLabel}>Estado</Text><View style={styles.statusChoices}><Pressable onPress={() => setStatus('ACTIVE')} style={[styles.statusChoice, status === 'ACTIVE' && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, status === 'ACTIVE' && styles.statusChoiceTextActive]}>Activo</Text></Pressable><Pressable onPress={() => setStatus('INACTIVE')} style={[styles.statusChoice, status === 'INACTIVE' && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, status === 'INACTIVE' && styles.statusChoiceTextActive]}>Inactivo</Text></Pressable></View></>}<PrimaryButton label={saving ? "Guardando…" : member ? "Guardar cambios" : "Guardar miembro"} onPress={() => void save()} disabled={saving || ci.length !== 11 || !firstName.trim() || !lastName.trim()} /></Sheet>;
}

function PlanActions({ plan, onClose, onEdit, onDelete }: { plan: Plan | null; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  return <Sheet open={!!plan} title="Opciones del plan" onClose={onClose}><View style={styles.planProfile}><View style={styles.planProfileIcon}><Text style={styles.planProfileIconText}>◆</Text></View><View style={styles.rowMain}><Text style={styles.memberProfileName}>{plan?.name}</Text><Text style={styles.memberProfileMeta}>{plan?.durationDays} días · {plan ? money(plan.price) : ''}</Text><Text style={[styles.planProfileState, !plan?.isActive && styles.planProfileStateInactive]}>{plan?.isActive ? 'Disponible para nuevas membresías' : 'Plan inactivo'}</Text></View></View><View style={styles.memberActionGrid}><Pressable accessibilityRole="button" onPress={onEdit} style={({pressed}) => [styles.memberActionCard, pressed && styles.memberActionCardPressed]}><View style={styles.memberActionIcon}><Text style={styles.memberActionIconText}>✎</Text></View><View style={styles.rowMain}><Text style={styles.memberActionTitle}>Editar plan</Text><Text style={styles.memberActionCopy}>Nombre, precio, duración, descripción y estado</Text></View><Text style={styles.memberActionChevron}>›</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Eliminar plan" onPress={onDelete} style={({pressed}) => [styles.memberActionCard, styles.memberActionCardDelete, pressed && styles.memberActionCardPressed]}><View style={[styles.memberActionIcon, styles.memberActionIconDelete]}><Text style={[styles.memberActionIconText, styles.memberActionDeleteText]}>×</Text></View><View style={styles.rowMain}><Text style={[styles.memberActionTitle, styles.memberActionDeleteText]}>Eliminar plan</Text><Text style={styles.memberActionCopy}>Se archivará si conserva historial de membresías</Text></View></Pressable></View></Sheet>;
}

function PlanForm({ scope, open, plan, onClose, onSaved }: FormProps & { plan: Plan | null }) {
  const [name, setName] = useState(''); const [price, setPrice] = useState(''); const [days, setDays] = useState('30'); const [description, setDescription] = useState(''); const [isActive, setIsActive] = useState(true); const [saving, setSaving] = useState(false);
  useEffect(() => { if (!open) return; setName(plan?.name ?? ''); setPrice(plan?.price ? String(plan.price) : ''); setDays(plan ? String(plan.durationDays) : '30'); setDescription(plan?.description ?? ''); setIsActive(plan?.isActive ?? true); }, [open, plan]);
  const save = async () => { setSaving(true); try { if (!await hasInternetConnection()) { showOnlineRequired(); return; } const input={ name:name.trim(), price:Number(price), durationDays:Number(days), description:description.trim(), isActive }; if (plan) await api.updatePlan(plan.id, input); else await api.createPlan(input); await syncNow(scope); onSaved(); } catch(error) { showError(error); } finally { setSaving(false); } };
  return <Sheet open={open} title={plan ? "Editar plan" : "Nuevo plan"} onClose={onClose}><Field label="Nombre del plan" value={name} onChangeText={setName} /><Field label="Precio en CUP" value={price} onChangeText={setPrice} keyboardType="numeric" /><Field label="Duración en días" value={days} onChangeText={setDays} keyboardType="numeric" />{plan && <><Field label="Descripción" value={description} onChangeText={setDescription} multiline /><Text style={styles.fieldLabel}>Disponibilidad</Text><View style={styles.statusChoices}><Pressable onPress={() => setIsActive(true)} style={[styles.statusChoice, isActive && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, isActive && styles.statusChoiceTextActive]}>Activo</Text></Pressable><Pressable onPress={() => setIsActive(false)} style={[styles.statusChoice, !isActive && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, !isActive && styles.statusChoiceTextActive]}>Inactivo</Text></Pressable></View></>}<PrimaryButton label={saving ? "Guardando…" : plan ? "Guardar cambios" : "Crear plan"} onPress={() => void save()} disabled={saving || !name.trim() || !price || Number(price) <= 0 || !days || Number(days) <= 0} /></Sheet>;
}

function AssignPlanForm({ scope, member, plans, onClose, onSaved }: { scope: string; member: Member | null; plans: Plan[]; onClose: () => void; onSaved: () => void }) {
  const membership = member ? editableMembership(member) : undefined;
  const availablePlans = plans.filter(plan => plan.isActive || plan.id === membership?.plan.id);
  const [planId, setPlanId] = useState(''); const [amount, setAmount] = useState(''); const [status, setStatus] = useState('ACTIVE'); const [saving, setSaving] = useState(false);
  useEffect(() => { setPlanId(membership?.plan.id ?? availablePlans.find(plan => plan.isActive)?.id ?? ''); setStatus(membership?.status ?? 'ACTIVE'); setAmount(''); }, [member, membership?.id, membership?.plan.id, membership?.status, plans]);
  const save = async () => { if (!member || !planId) return; setSaving(true); try { if (membership) await offline.updateMembership(scope, member.id, membership.id, { planId, status }); else await offline.assignPlan(scope, { memberId: member.id, planId, ...(Number(amount) > 0 ? { initialPayment: Number(amount), paymentMethod: 'CASH' } : {}) }); onSaved(); } catch (error) { showError(error); } finally { setSaving(false); } };
  return <Sheet open={!!member} title={`${membership ? 'Editar membresía' : 'Plan'} de ${member?.firstName ?? ''}`} onClose={onClose}>
    {membership && <Text style={styles.sheetCopy}>Plan actual: <Text style={styles.bold}>{membership.plan.name}</Text></Text>}
    <Text style={styles.fieldLabel}>Selecciona el plan</Text><View style={styles.choices}>{availablePlans.map(plan => <Pressable key={plan.id} onPress={() => setPlanId(plan.id)} style={[styles.choice, planId === plan.id && styles.choiceActive]}><Text style={styles.choiceTitle}>{plan.name}{plan.id === membership?.plan.id ? ' · Actual' : ''}</Text><Text style={styles.choicePrice}>{money(plan.price)}</Text></Pressable>)}</View>
    {membership ? <><Text style={styles.fieldLabel}>Estado de la membresía</Text><View style={styles.statusChoices}>{['ACTIVE','SCHEDULED','EXPIRED','CANCELLED'].map(value=><Pressable key={value} onPress={() => setStatus(value)} style={[styles.statusChoice, status === value && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, status === value && styles.statusChoiceTextActive]}>{membershipStatusLabel(value)}</Text></Pressable>)}</View></> : <Field label="Abono inicial (opcional)" value={amount} onChangeText={setAmount} keyboardType="numeric" />}
    <PrimaryButton label={saving ? "Guardando…" : membership ? "Guardar membresía" : "Asignar plan"} disabled={saving || !planId} onPress={() => void save()} />
  </Sheet>;
}

function PaymentForm({ scope, payment, onClose, onSaved }: { scope: string; payment: Payment | null; onClose: () => void; onSaved: () => void }) {
  const balance = payment ? Number(payment.amount) - Number(payment.paidAmount) : 0; const [amount, setAmount] = useState('');
  useEffect(() => setAmount(payment ? String(balance) : ''), [payment, balance]);
  return <Sheet open={!!payment} title="Registrar abono" onClose={onClose}><Text style={styles.sheetCopy}>Saldo de {payment?.member.firstName}: <Text style={styles.bold}>{money(balance)}</Text></Text><Field label="Importe recibido en efectivo" value={amount} onChangeText={setAmount} keyboardType="numeric" /><PrimaryButton label="Confirmar cobro" disabled={!amount || Number(amount) <= 0 || Number(amount) > balance} onPress={() => payment && offline.applyPayment(scope, payment.id, { amount: Number(amount), method: 'CASH' }).then(onSaved).catch(showError)} /></Sheet>;
}

function SyncBar({ state, onPress }: { state: SyncState; onPress: () => void }) {
  const labels: Record<SyncState['phase'], string> = { STARTING: 'Preparando datos', SYNCED: 'Datos al día', SYNCING: 'Sincronizando', OFFLINE: 'Modo sin conexión', ERROR: 'Debes iniciar sesión online' };
  const detail = state.rejected > 0 ? `${state.rejected} cambio${state.rejected === 1 ? '' : 's'} requiere revisión` : state.pending > 0 ? `${state.pending} cambio${state.pending === 1 ? '' : 's'} pendiente` : state.message;
  return <Pressable onPress={onPress} style={[styles.syncBar, state.phase === 'OFFLINE' && styles.syncOffline, state.phase === 'ERROR' && styles.syncError]}>
    {state.phase === 'SYNCING' ? <ActivityIndicator size="small" color="#173f31" /> : <View style={[styles.syncDot, state.phase === 'SYNCED' && styles.syncDotOk]} />}
    <View style={styles.syncMain}><Text style={styles.syncTitle}>{labels[state.phase]}</Text>{detail ? <Text style={styles.syncDetail}>{detail}</Text> : null}</View>
    <Text style={styles.syncAction}>{state.rejected > 0 ? 'Revisar' : state.phase === 'SYNCING' ? '' : 'Sincronizar'}</Text>
  </Pressable>;
}

function SyncIssues({ open, scope, revision, onClose }: { open: boolean; scope: string; revision: number; onClose: () => void }) {
  const [issues, setIssues] = useState<SyncIssue[]>([]);
  const load = useCallback(() => { void getSyncIssues(scope).then(setIssues).catch(showError); }, [scope]);
  useEffect(() => { if (open) load(); }, [open, revision, load]);
  const names: Record<SyncIssue['type'], string> = { MEMBER_CREATE: 'Registrar miembro', MEMBER_UPDATE: 'Editar miembro', MEMBER_DELETE: 'Eliminar miembro', PLAN_CREATE: 'Crear plan', PLAN_UPDATE: 'Editar plan', PLAN_DELETE: 'Eliminar plan', MEMBERSHIP_ASSIGN: 'Asignar plan', MEMBERSHIP_UPDATE: 'Editar membresía', MEMBERSHIP_RENEW: 'Renovar plan', PAYMENT_APPLY: 'Registrar cobro' };
  return <Sheet open={open} title="Cambios por revisar" onClose={onClose}>
    <Text style={styles.sheetCopy}>El servidor rechazó estos cambios. Los datos válidos ya fueron sincronizados.</Text>
    {issues.map((issue) => <View key={issue.id} style={styles.issueCard}><Text style={styles.issueTitle}>{names[issue.type]}</Text><Text style={styles.issueDate}>{new Date(issue.occurredAt).toLocaleString('es-CU')}</Text><Text style={styles.issueError}>{issue.error}</Text><Pressable onPress={() => discardSyncIssue(scope, issue.id).then(load).catch(showError)}><Text style={styles.discard}>Descartar aviso</Text></Pressable></View>)}
    {!issues.length && <Empty text="No hay cambios pendientes de revisión" />}
  </Sheet>;
}

type FormProps = { scope: string; open: boolean; onClose: () => void; onSaved: () => void };
function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) { return <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}><Pressable style={styles.backdrop} onPress={onClose} /><View style={styles.sheet}><View style={styles.sheetHead}><Text style={styles.sheetTitle}>{title}</Text><Pressable onPress={onClose}><Text style={styles.close}>×</Text></Pressable></View><ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView></View></Modal>; }
function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) { const { label, ...input } = props; return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput placeholderTextColor="#9ca59f" style={styles.input} {...input} /></View>; }
function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) { return <Pressable onPress={onPress} disabled={disabled} style={[styles.primary, disabled && styles.disabled]}><Text style={styles.primaryText}>{label}</Text></Pressable>; }
function Metric({ label, value, wide }: { label: string; value: string | number; wide?: boolean }) { return <View style={[styles.metric, wide && styles.metricWide]}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>; }
function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) { return <View style={styles.sectionTitle}><Text style={styles.sectionHeading}>{title}</Text><Text style={styles.sectionCopy}>{subtitle}</Text></View>; }
function Row({ title, subtitle, value }: { title: string; subtitle: string; value: string }) { return <View style={styles.paymentRow}><View style={styles.rowMain}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowSubtitle}>{subtitle}</Text></View><Text style={styles.income}>{value}</Text></View>; }
function Empty({ text }: { text: string }) { return <Text style={styles.empty}>{text}</Text>; }
function showError(error: unknown) { Alert.alert('Atención', error instanceof Error ? error.message : 'Ocurrió un error'); }
async function hasInternetConnection() { const state=await Network.getNetworkStateAsync().catch(() => null); return state?.isConnected === true && state.isInternetReachable !== false; }
function showOnlineRequired() { Alert.alert('Conexión requerida', 'Debes conectarte a internet para crear, editar o eliminar planes.'); }
function editableMembership(member: Member) { const now=Date.now(); return member.memberships.find(membership => (membership.status === 'ACTIVE' && new Date(membership.endDate).getTime() >= now) || membership.status === 'SCHEDULED'); }
function membershipStatusLabel(status: string) { return ({ ACTIVE:'Activa', SCHEDULED:'Programada', EXPIRED:'Vencida', CANCELLED:'Cancelada' } as Record<string,string>)[status] ?? status; }
function paymentDisplayStatus(payment: Payment, total: number, paid: number, balance: number) {
  if (payment.status === 'CANCELLED') return { label:'Cancelado', tone:'danger' } as const;
  if (total <= 0) return { label:'Sin importe', tone:'danger' } as const;
  if (paid >= total && balance === 0) return { label:'Pagado', tone:'success' } as const;
  if (paid > 0) return { label:'Parcial', tone:'warning' } as const;
  if (payment.status === 'OVERDUE') return { label:'Vencido', tone:'danger' } as const;
  return { label:'Pendiente', tone:'warning' } as const;
}

const styles = StyleSheet.create({
  center:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:'#173f31'}, app:{flex:1,backgroundColor:'#f5f5ef'}, content:{flex:1},
  loginPage:{flex:1,backgroundColor:'#173f31',paddingHorizontal:24,paddingTop:70},logo:{width:64,height:64,borderRadius:18},loginBrand:{marginTop:16,color:'#fff',fontSize:22,fontWeight:'800'},mini:{color:'#c9f47b',fontSize:11,letterSpacing:2},loginTitle:{marginTop:44,color:'#fff',fontSize:34,fontWeight:'800',letterSpacing:-1.2},loginCopy:{marginTop:10,color:'#b8cec4',fontSize:15,lineHeight:22},loginCard:{marginTop:34,padding:20,borderRadius:20,backgroundColor:'#fff'},version:{marginTop:'auto',marginBottom:24,textAlign:'center',color:'#769387',fontSize:10,letterSpacing:2},
  topbar:{paddingTop:18,paddingHorizontal:20,paddingBottom:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:'#f5f5ef'},kicker:{color:'#397458',fontSize:9,fontWeight:'800',letterSpacing:1.5},screenTitle:{marginTop:3,fontSize:27,fontWeight:'800',color:'#17221d',letterSpacing:-.8},avatar:{width:39,height:39,borderRadius:20,alignItems:'center',justifyContent:'center',backgroundColor:'#c9f47b'},
  syncBar:{minHeight:44,marginHorizontal:16,marginBottom:4,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:9,borderRadius:12,backgroundColor:'#e5f2d1'},syncOffline:{backgroundColor:'#fff0d9'},syncError:{backgroundColor:'#ffe4df'},syncDot:{width:9,height:9,borderRadius:5,backgroundColor:'#e28d36'},syncDotOk:{backgroundColor:'#1d7b53'},syncMain:{flex:1},syncTitle:{color:'#24342c',fontSize:11,fontWeight:'800'},syncDetail:{marginTop:1,color:'#657169',fontSize:9},syncAction:{color:'#1d6b4d',fontSize:10,fontWeight:'800'},
  accountScroll:{padding:16,paddingBottom:40},accountHero:{padding:26,alignItems:'center',borderRadius:22,backgroundColor:'#173f31'},accountHeroLabel:{color:'#a9c3b7',fontSize:9,fontWeight:'800',letterSpacing:1.3},accountHeroGym:{marginTop:8,color:'#fff',fontSize:23,fontWeight:'900',textAlign:'center'},accountCard:{marginTop:12,paddingHorizontal:17,borderWidth:1,borderColor:'#e2e7e3',borderRadius:17,backgroundColor:'#fff'},accountRow:{minHeight:61,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:18,borderBottomWidth:1,borderBottomColor:'#edf0ee'},accountRowLast:{borderBottomWidth:0},accountLabel:{color:'#7a857f',fontSize:10,fontWeight:'700'},accountValue:{flex:1,color:'#24342c',fontSize:12,fontWeight:'800',textAlign:'right'},logoutButton:{minHeight:69,marginTop:18,padding:13,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:'#efcec9',borderRadius:15,backgroundColor:'#fff9f8'},logoutButtonPressed:{opacity:.7},logoutIcon:{width:42,height:42,marginRight:12,alignItems:'center',justifyContent:'center',borderRadius:13,backgroundColor:'#fee5e1'},logoutIconText:{color:'#a8453c',fontSize:20,fontWeight:'900'},logoutTitle:{color:'#a8453c',fontSize:13,fontWeight:'900'},logoutCopy:{marginTop:4,color:'#8b7774',fontSize:9},accountVersion:{marginTop:28,color:'#929b96',fontSize:9,letterSpacing:1.2,textAlign:'center'},
  scroll:{padding:16,paddingBottom:35},hero:{padding:24,borderRadius:20,backgroundColor:'#173f31'},heroLabel:{color:'#a9c3b7',fontSize:10,fontWeight:'700',letterSpacing:1.3},heroValue:{marginTop:9,color:'#fff',fontSize:30,fontWeight:'800',letterSpacing:-1},heroHint:{marginTop:7,color:'#c9f47b',fontSize:11},metricGrid:{marginTop:12,flexDirection:'row',flexWrap:'wrap',gap:10},metric:{width:'48.3%',padding:17,borderWidth:1,borderColor:'#e2e7e3',borderRadius:15,backgroundColor:'#fff'},metricWide:{width:'100%'},metricLabel:{color:'#78827d',fontSize:11},metricValue:{marginTop:9,color:'#1c2b24',fontSize:21,fontWeight:'800'},
  sectionTitle:{marginTop:26,marginBottom:10},sectionHeading:{fontSize:18,fontWeight:'800',color:'#17221d'},sectionCopy:{marginTop:3,color:'#7b8680',fontSize:11},card:{overflow:'hidden',borderWidth:1,borderColor:'#e2e7e3',borderRadius:16,backgroundColor:'#fff'},paymentRow:{minHeight:65,padding:14,flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderBottomColor:'#edf0ee'},rowMain:{flex:1},rowTitle:{fontSize:13,fontWeight:'700',color:'#24342c'},rowSubtitle:{marginTop:4,color:'#7d8882',fontSize:10},income:{color:'#1d7b53',fontSize:12,fontWeight:'800'},empty:{padding:26,textAlign:'center',color:'#7d8882'},logoutHint:{marginTop:28,textAlign:'center',color:'#929b96',fontSize:10},
  paymentDetailRow:{padding:15,borderBottomWidth:1,borderBottomColor:'#edf0ee'},paymentDetailRowPressed:{backgroundColor:'#f5f8f6'},paymentDetailHead:{flexDirection:'row',alignItems:'flex-start',gap:10},paymentBadge:{paddingVertical:4,paddingHorizontal:8,borderRadius:10,backgroundColor:'#fff0d8'},paymentBadgeSuccess:{backgroundColor:'#e1f4e8'},paymentBadgeDanger:{backgroundColor:'#fee6e2'},paymentBadgeText:{color:'#996018',fontSize:8,fontWeight:'900'},paymentBadgeTextSuccess:{color:'#1d754f'},paymentBadgeTextDanger:{color:'#a33f36'},paymentAmounts:{marginTop:14,flexDirection:'row',justifyContent:'space-between'},paymentAmountLabel:{color:'#8a958f',fontSize:8,fontWeight:'800',letterSpacing:.8},paymentAmountRight:{textAlign:'right'},paymentPaid:{marginTop:4,color:'#1d754f',fontSize:14,fontWeight:'900'},paymentTotal:{marginTop:4,color:'#27372f',fontSize:14,fontWeight:'900',textAlign:'right'},paymentProgress:{height:5,marginTop:12,overflow:'hidden',borderRadius:3,backgroundColor:'#e8ece9'},paymentProgressFill:{height:'100%',borderRadius:3,backgroundColor:'#58a878'},paymentBalanceCopy:{marginTop:8,color:'#7b6a42',fontSize:9,fontWeight:'700'},
  memberSearch:{height:50,marginTop:14,paddingHorizontal:13,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:'#dce3de',borderRadius:14,backgroundColor:'#fff'},memberSearchIcon:{marginRight:9,color:'#658071',fontSize:21},memberSearchInput:{height:'100%',flex:1,color:'#17221d',fontSize:12},memberSearchClear:{width:30,height:30,alignItems:'center',justifyContent:'center',borderRadius:10,backgroundColor:'#eef2ef'},memberSearchClearText:{color:'#68766e',fontSize:20,lineHeight:22},
  primary:{minHeight:49,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:'#1d6b4d'},primaryText:{color:'#fff',fontSize:14,fontWeight:'800'},disabled:{opacity:.45},memberRow:{minHeight:80,padding:12,flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderBottomColor:'#edf0ee'},memberRowPressed:{backgroundColor:'#f3f8f4'},memberAvatar:{width:44,height:44,marginRight:11,borderRadius:14,alignItems:'center',justifyContent:'center',backgroundColor:'#e5f2d1'},memberAvatarText:{color:'#31543f',fontSize:12,fontWeight:'900'},memberPlanLine:{marginTop:6,flexDirection:'row',alignItems:'center',gap:5},memberPlanDot:{width:6,height:6,borderRadius:3,backgroundColor:'#c0c7c3'},memberPlanDotActive:{backgroundColor:'#58a878'},memberPlanText:{color:'#69766f',fontSize:9},memberChevron:{marginLeft:8,color:'#93a098',fontSize:28,fontWeight:'300'},memberProfile:{marginBottom:20,padding:16,flexDirection:'row',alignItems:'center',borderRadius:16,backgroundColor:'#f3f7f3'},memberProfileAvatar:{width:52,height:52,marginRight:13,alignItems:'center',justifyContent:'center',borderRadius:17,backgroundColor:'#c9f47b'},memberProfileInitials:{color:'#244433',fontSize:15,fontWeight:'900'},memberProfileName:{color:'#17221d',fontSize:16,fontWeight:'900'},memberProfileMeta:{marginTop:4,color:'#748079',fontSize:10},memberProfilePlan:{marginTop:6,color:'#1d6b4d',fontSize:10,fontWeight:'700'},memberActionGrid:{gap:10},memberActionCard:{minHeight:76,padding:13,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:'#dfe7e1',borderRadius:15,backgroundColor:'#fbfcfb'},memberActionCardPlan:{borderColor:'#dce8ca',backgroundColor:'#fbfdf7'},memberActionCardDelete:{minHeight:64,borderColor:'#f0d8d4',backgroundColor:'#fffafa'},memberActionCardPressed:{opacity:.72,transform:[{scale:.99}]},memberActionIcon:{width:43,height:43,marginRight:12,alignItems:'center',justifyContent:'center',borderRadius:13,backgroundColor:'#e6f1ea'},memberActionIconPlan:{backgroundColor:'#e8f5ce'},memberActionIconDelete:{backgroundColor:'#fee9e5'},memberActionIconText:{color:'#1d6b4d',fontSize:19,fontWeight:'900'},memberActionDeleteText:{color:'#a8453c'},memberActionTitle:{color:'#24342c',fontSize:13,fontWeight:'900'},memberActionCopy:{marginTop:4,color:'#7a867f',fontSize:9,lineHeight:13},memberActionChevron:{marginLeft:8,color:'#8e9a93',fontSize:25},planCard:{marginBottom:10,padding:18,flexDirection:'row',justifyContent:'space-between',alignItems:'center',borderWidth:1,borderColor:'#e2e7e3',borderRadius:16,backgroundColor:'#fff'},planName:{fontSize:15,fontWeight:'800',color:'#213129'},planPrice:{fontSize:15,fontWeight:'800',color:'#1d6b4d'},debtCard:{padding:22,borderRadius:18,backgroundColor:'#f0a866'},debtValue:{marginTop:8,fontSize:28,fontWeight:'900',color:'#48290f'},balance:{textAlign:'right',color:'#27372f',fontSize:12,fontWeight:'800'},balanceLabel:{marginTop:3,textAlign:'right',color:'#8b958f',fontSize:9},
  backdrop:{flex:1,backgroundColor:'#13251d88'},sheet:{maxHeight:'82%',padding:22,paddingBottom:32,borderTopLeftRadius:25,borderTopRightRadius:25,backgroundColor:'#fff'},sheetHead:{marginBottom:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},sheetTitle:{fontSize:22,fontWeight:'800',color:'#17221d'},close:{fontSize:30,color:'#77817c'},field:{marginBottom:14},fieldLabel:{marginBottom:7,color:'#536159',fontSize:11,fontWeight:'700'},input:{height:48,paddingHorizontal:14,borderWidth:1,borderColor:'#dce2de',borderRadius:11,color:'#17221d',backgroundColor:'#fafbf9'},sheetCopy:{marginBottom:18,color:'#657169',fontSize:13},bold:{fontWeight:'800',color:'#17221d'},choices:{marginBottom:15,gap:8},choice:{padding:13,borderWidth:1,borderColor:'#dfe4e1',borderRadius:12},choiceActive:{borderColor:'#1d6b4d',backgroundColor:'#eef7e1'},choiceTitle:{fontWeight:'800',color:'#23332b'},choicePrice:{marginTop:3,color:'#728078',fontSize:11},statusChoices:{marginBottom:18,flexDirection:'row',gap:8},statusChoice:{flex:1,padding:11,alignItems:'center',borderWidth:1,borderColor:'#dfe4e1',borderRadius:10},statusChoiceActive:{borderColor:'#1d6b4d',backgroundColor:'#eef7e1'},statusChoiceText:{color:'#728078',fontSize:11,fontWeight:'700'},statusChoiceTextActive:{color:'#1d6b4d'},
  planCardPressed:{opacity:.72,transform:[{scale:.99}]},planTitleLine:{flexDirection:'row',alignItems:'center',gap:7},planState:{paddingVertical:3,paddingHorizontal:7,borderRadius:8,backgroundColor:'#f1e8df'},planStateActive:{backgroundColor:'#e4f3e9'},planStateText:{color:'#94643a',fontSize:8,fontWeight:'800'},planStateTextActive:{color:'#277453'},planProfile:{marginBottom:20,padding:16,flexDirection:'row',alignItems:'center',borderRadius:16,backgroundColor:'#f6f9f2'},planProfileIcon:{width:52,height:52,marginRight:13,alignItems:'center',justifyContent:'center',borderRadius:17,backgroundColor:'#e8f5ce'},planProfileIconText:{color:'#1d6b4d',fontSize:20,fontWeight:'900'},planProfileState:{marginTop:6,color:'#277453',fontSize:10,fontWeight:'700'},planProfileStateInactive:{color:'#94643a'},
  issueCard:{marginBottom:10,padding:14,borderWidth:1,borderColor:'#ead7d2',borderRadius:13,backgroundColor:'#fff8f6'},issueTitle:{color:'#24342c',fontSize:13,fontWeight:'800'},issueDate:{marginTop:3,color:'#7d8882',fontSize:9},issueError:{marginTop:9,color:'#8a3f31',fontSize:11,lineHeight:16},discard:{marginTop:12,color:'#1d6b4d',fontSize:11,fontWeight:'800'},
  tabbar:{paddingTop:8,paddingBottom:10,flexDirection:'row',borderTopWidth:1,borderTopColor:'#dfe4e1',backgroundColor:'#fff'},tab:{flex:1,alignItems:'center'},tabIcon:{color:'#929b96',fontSize:18,fontWeight:'700'},tabLabel:{marginTop:2,color:'#929b96',fontSize:8,fontWeight:'700'},tabActive:{color:'#1d6b4d'},
});
