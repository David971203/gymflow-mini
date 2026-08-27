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
  { id: 'PLANES', icon: '▣', label: 'Planes' }, { id: 'CAJA', icon: '$', label: 'Caja' },
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
      <Pressable onLongPress={onLogout} style={styles.avatar}><Text>{user.name.slice(0, 2).toUpperCase()}</Text></Pressable>
    </View>
    <SyncBar state={syncState} onPress={() => syncState.rejected > 0 ? setIssuesOpen(true) : void syncNow(scope)} />
    <View style={styles.content}>
      {tab === 'INICIO' && <DashboardScreen scope={scope} revision={revision} />}
      {tab === 'MIEMBROS' && <MembersScreen scope={scope} revision={revision} />}
      {tab === 'PLANES' && <PlansScreen scope={scope} revision={revision} />}
      {tab === 'CAJA' && <PaymentsScreen scope={scope} revision={revision} />}
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
    <Text style={styles.logoutHint}>Mantén presionado tu avatar para cerrar sesión.</Text>
  </ScrollView>;
}

function MembersScreen({ scope, revision }: ScreenProps) {
  const [members, setMembers] = useState<Member[]>([]); const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true); const [addOpen, setAddOpen] = useState(false); const [editing, setEditing] = useState<Member | null>(null); const [assigning, setAssigning] = useState<Member | null>(null);
  const load = useCallback(() => { setLoading(true); Promise.all([offline.members(scope), offline.plans(scope)]).then(([m, p]) => { setMembers(m); setPlans(p); }).catch(showError).finally(() => setLoading(false)); }, [scope]);
  const refresh = useCallback(() => { void syncNow(scope).then(load); }, [scope, load]);
  useEffect(load, [load, revision]);
  return <>
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />} contentContainerStyle={styles.scroll}>
      <PrimaryButton label="+ Registrar miembro" onPress={() => setAddOpen(true)} />
      <SectionTitle title={`${members.length} miembros`} subtitle="Edita sus datos o toca Plan para gestionar su membresía" />
      <View style={styles.card}>{members.map(member => { const current = editableMembership(member) ?? member.memberships[0]; return <View key={member.id} style={styles.memberRow}>
        <Pressable onPress={() => setEditing(member)} style={styles.memberMain}><View style={styles.memberAvatar}><Text>{member.firstName[0]}{member.lastName[0]}</Text></View><View style={styles.rowMain}><Text style={styles.rowTitle}>{member.firstName} {member.lastName}</Text><Text style={styles.rowSubtitle}>CI {member.ci} · {current ? `${current.plan.name} · ${current.status}` : 'Sin plan asignado'}</Text></View></Pressable><View style={styles.memberActions}><Pressable onPress={() => setEditing(member)} style={styles.memberAction}><Text style={styles.memberActionText}>Editar</Text></Pressable><Pressable onPress={() => setAssigning(member)} style={styles.memberAction}><Text style={styles.memberActionText}>Plan</Text></Pressable></View>
      </View>; })}{!members.length && <Empty text="Registra tu primer miembro" />}</View>
    </ScrollView>
    <MemberForm scope={scope} open={addOpen || !!editing} member={editing} onClose={() => { setAddOpen(false); setEditing(null); }} onSaved={() => { setAddOpen(false); setEditing(null); load(); }} />
    <AssignPlanForm scope={scope} member={assigning} plans={plans} onClose={() => setAssigning(null)} onSaved={() => { setAssigning(null); load(); }} />
  </>;
}

function PlansScreen({ scope, revision }: ScreenProps) {
  const [plans, setPlans] = useState<Plan[]>([]); const [loading, setLoading] = useState(true); const [open, setOpen] = useState(false);
  const load = useCallback(() => { setLoading(true); offline.plans(scope).then(setPlans).catch(showError).finally(() => setLoading(false)); }, [scope]);
  const refresh = useCallback(() => { void syncNow(scope).then(load); }, [scope, load]);
  useEffect(load, [load, revision]);
  return <><ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />} contentContainerStyle={styles.scroll}>
    <PrimaryButton label="+ Crear plan" onPress={() => setOpen(true)} />
    <SectionTitle title="Planes del gimnasio" subtitle="La duración determina automáticamente el vencimiento" />
    {plans.map(plan => <View key={plan.id} style={styles.planCard}><View><Text style={styles.planName}>{plan.name}</Text><Text style={styles.rowSubtitle}>{plan.durationDays} días</Text></View><Text style={styles.planPrice}>{money(plan.price)}</Text></View>)}
  </ScrollView><PlanForm scope={scope} open={open} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); load(); }} /></>;
}

function PaymentsScreen({ scope, revision }: ScreenProps) {
  const [payments, setPayments] = useState<Payment[]>([]); const [loading, setLoading] = useState(true); const [selected, setSelected] = useState<Payment | null>(null);
  const load = useCallback(() => { setLoading(true); offline.payments(scope).then(setPayments).catch(showError).finally(() => setLoading(false)); }, [scope]);
  const refresh = useCallback(() => { void syncNow(scope).then(load); }, [scope, load]);
  useEffect(load, [load, revision]);
  const debt = payments.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount) - Number(payment.paidAmount)), 0);
  return <><ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />} contentContainerStyle={styles.scroll}>
    <View style={styles.debtCard}><Text style={styles.heroLabel}>TOTAL POR COBRAR</Text><Text style={styles.debtValue}>{money(debt)}</Text></View>
    <SectionTitle title="Cobros" subtitle="Registra abonos parciales o pagos completos" />
    <View style={styles.card}>{payments.map(payment => { const balance = Number(payment.amount) - Number(payment.paidAmount); return <Pressable disabled={balance <= 0} onPress={() => setSelected(payment)} key={payment.id} style={styles.paymentRow}>
      <View style={styles.rowMain}><Text style={styles.rowTitle}>{payment.member.firstName} {payment.member.lastName}</Text><Text style={styles.rowSubtitle}>{payment.membership.plan.name} · {payment.status}</Text></View><View><Text style={styles.balance}>{money(balance)}</Text><Text style={styles.balanceLabel}>{balance > 0 ? 'pendiente' : 'pagado'}</Text></View>
    </Pressable>; })}</View>
  </ScrollView><PaymentForm scope={scope} payment={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); load(); }} /></>;
}

function MemberForm({ scope, open, member, onClose, onSaved }: FormProps & { member: Member | null }) {
  const [ci, setCi] = useState(''); const [firstName, setFirstName] = useState(''); const [lastName, setLastName] = useState(''); const [phone, setPhone] = useState(''); const [address, setAddress] = useState(''); const [status, setStatus] = useState('ACTIVE'); const [saving, setSaving] = useState(false);
  useEffect(() => { if (!open) return; setCi(member?.ci ?? ''); setFirstName(member?.firstName ?? ''); setLastName(member?.lastName ?? ''); setPhone(member?.phone ?? ''); setAddress(member?.address ?? ''); setStatus(member?.status ?? 'ACTIVE'); }, [open, member]);
  const save = async () => { setSaving(true); try { const input = { ci, firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim(), address: address.trim(), status }; if (member) await offline.updateMember(scope, member.id, input); else await offline.createMember(scope, { ci, firstName: input.firstName, lastName: input.lastName, phone: input.phone }); onSaved(); } catch (error) { showError(error); } finally { setSaving(false); } };
  return <Sheet open={open} title={member ? "Editar miembro" : "Nuevo miembro"} onClose={onClose}><Field label="Carnet de identidad (11 dígitos)" value={ci} onChangeText={(value) => setCi(value.replace(/\D/g, '').slice(0, 11))} keyboardType="number-pad" maxLength={11} /><Field label="Nombre" value={firstName} onChangeText={setFirstName} /><Field label="Apellidos" value={lastName} onChangeText={setLastName} /><Field label="Teléfono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />{member && <><Field label="Dirección" value={address} onChangeText={setAddress} /><Text style={styles.fieldLabel}>Estado</Text><View style={styles.statusChoices}><Pressable onPress={() => setStatus('ACTIVE')} style={[styles.statusChoice, status === 'ACTIVE' && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, status === 'ACTIVE' && styles.statusChoiceTextActive]}>Activo</Text></Pressable><Pressable onPress={() => setStatus('INACTIVE')} style={[styles.statusChoice, status === 'INACTIVE' && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, status === 'INACTIVE' && styles.statusChoiceTextActive]}>Inactivo</Text></Pressable></View></>}<PrimaryButton label={saving ? "Guardando…" : member ? "Guardar cambios" : "Guardar miembro"} onPress={() => void save()} disabled={saving || ci.length !== 11 || !firstName.trim() || !lastName.trim()} /></Sheet>;
}

function PlanForm({ scope, open, onClose, onSaved }: FormProps) {
  const [name, setName] = useState(''); const [price, setPrice] = useState(''); const [days, setDays] = useState('30');
  return <Sheet open={open} title="Nuevo plan" onClose={onClose}><Field label="Nombre del plan" value={name} onChangeText={setName} /><Field label="Precio en CUP" value={price} onChangeText={setPrice} keyboardType="numeric" /><Field label="Duración en días" value={days} onChangeText={setDays} keyboardType="numeric" /><PrimaryButton label="Crear plan" onPress={() => offline.createPlan(scope, { name, price: Number(price), durationDays: Number(days) }).then(onSaved).catch(showError)} disabled={!name || !price || !days} /></Sheet>;
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
  const names: Record<SyncIssue['type'], string> = { MEMBER_CREATE: 'Registrar miembro', MEMBER_UPDATE: 'Editar miembro', PLAN_CREATE: 'Crear plan', PLAN_UPDATE: 'Editar plan', MEMBERSHIP_ASSIGN: 'Asignar plan', MEMBERSHIP_UPDATE: 'Editar membresía', MEMBERSHIP_RENEW: 'Renovar plan', PAYMENT_APPLY: 'Registrar cobro' };
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
function editableMembership(member: Member) { const now=Date.now(); return member.memberships.find(membership => (membership.status === 'ACTIVE' && new Date(membership.endDate).getTime() >= now) || membership.status === 'SCHEDULED'); }
function membershipStatusLabel(status: string) { return ({ ACTIVE:'Activa', SCHEDULED:'Programada', EXPIRED:'Vencida', CANCELLED:'Cancelada' } as Record<string,string>)[status] ?? status; }

const styles = StyleSheet.create({
  center:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:'#173f31'}, app:{flex:1,backgroundColor:'#f5f5ef'}, content:{flex:1},
  loginPage:{flex:1,backgroundColor:'#173f31',paddingHorizontal:24,paddingTop:70},logo:{width:64,height:64,borderRadius:18},loginBrand:{marginTop:16,color:'#fff',fontSize:22,fontWeight:'800'},mini:{color:'#c9f47b',fontSize:11,letterSpacing:2},loginTitle:{marginTop:44,color:'#fff',fontSize:34,fontWeight:'800',letterSpacing:-1.2},loginCopy:{marginTop:10,color:'#b8cec4',fontSize:15,lineHeight:22},loginCard:{marginTop:34,padding:20,borderRadius:20,backgroundColor:'#fff'},version:{marginTop:'auto',marginBottom:24,textAlign:'center',color:'#769387',fontSize:10,letterSpacing:2},
  topbar:{paddingTop:18,paddingHorizontal:20,paddingBottom:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:'#f5f5ef'},kicker:{color:'#397458',fontSize:9,fontWeight:'800',letterSpacing:1.5},screenTitle:{marginTop:3,fontSize:27,fontWeight:'800',color:'#17221d',letterSpacing:-.8},avatar:{width:39,height:39,borderRadius:20,alignItems:'center',justifyContent:'center',backgroundColor:'#c9f47b'},
  syncBar:{minHeight:44,marginHorizontal:16,marginBottom:4,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:9,borderRadius:12,backgroundColor:'#e5f2d1'},syncOffline:{backgroundColor:'#fff0d9'},syncError:{backgroundColor:'#ffe4df'},syncDot:{width:9,height:9,borderRadius:5,backgroundColor:'#e28d36'},syncDotOk:{backgroundColor:'#1d7b53'},syncMain:{flex:1},syncTitle:{color:'#24342c',fontSize:11,fontWeight:'800'},syncDetail:{marginTop:1,color:'#657169',fontSize:9},syncAction:{color:'#1d6b4d',fontSize:10,fontWeight:'800'},
  scroll:{padding:16,paddingBottom:35},hero:{padding:24,borderRadius:20,backgroundColor:'#173f31'},heroLabel:{color:'#a9c3b7',fontSize:10,fontWeight:'700',letterSpacing:1.3},heroValue:{marginTop:9,color:'#fff',fontSize:30,fontWeight:'800',letterSpacing:-1},heroHint:{marginTop:7,color:'#c9f47b',fontSize:11},metricGrid:{marginTop:12,flexDirection:'row',flexWrap:'wrap',gap:10},metric:{width:'48.3%',padding:17,borderWidth:1,borderColor:'#e2e7e3',borderRadius:15,backgroundColor:'#fff'},metricWide:{width:'100%'},metricLabel:{color:'#78827d',fontSize:11},metricValue:{marginTop:9,color:'#1c2b24',fontSize:21,fontWeight:'800'},
  sectionTitle:{marginTop:26,marginBottom:10},sectionHeading:{fontSize:18,fontWeight:'800',color:'#17221d'},sectionCopy:{marginTop:3,color:'#7b8680',fontSize:11},card:{overflow:'hidden',borderWidth:1,borderColor:'#e2e7e3',borderRadius:16,backgroundColor:'#fff'},paymentRow:{minHeight:65,padding:14,flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderBottomColor:'#edf0ee'},rowMain:{flex:1},rowTitle:{fontSize:13,fontWeight:'700',color:'#24342c'},rowSubtitle:{marginTop:4,color:'#7d8882',fontSize:10},income:{color:'#1d7b53',fontSize:12,fontWeight:'800'},empty:{padding:26,textAlign:'center',color:'#7d8882'},logoutHint:{marginTop:28,textAlign:'center',color:'#929b96',fontSize:10},
  primary:{minHeight:49,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:'#1d6b4d'},primaryText:{color:'#fff',fontSize:14,fontWeight:'800'},disabled:{opacity:.45},memberRow:{minHeight:68,padding:12,flexDirection:'row',alignItems:'center',gap:8,borderBottomWidth:1,borderBottomColor:'#edf0ee'},memberMain:{minWidth:0,flex:1,flexDirection:'row',alignItems:'center'},memberAvatar:{width:39,height:39,marginRight:10,borderRadius:12,alignItems:'center',justifyContent:'center',backgroundColor:'#e5f2d1'},memberActions:{gap:4},memberAction:{paddingVertical:5,paddingHorizontal:8,borderRadius:7,backgroundColor:'#eef5f0'},memberActionText:{color:'#1d6b4d',fontSize:9,fontWeight:'800'},planCard:{marginBottom:10,padding:18,flexDirection:'row',justifyContent:'space-between',alignItems:'center',borderWidth:1,borderColor:'#e2e7e3',borderRadius:16,backgroundColor:'#fff'},planName:{fontSize:15,fontWeight:'800',color:'#213129'},planPrice:{fontSize:15,fontWeight:'800',color:'#1d6b4d'},debtCard:{padding:22,borderRadius:18,backgroundColor:'#f0a866'},debtValue:{marginTop:8,fontSize:28,fontWeight:'900',color:'#48290f'},balance:{textAlign:'right',color:'#27372f',fontSize:12,fontWeight:'800'},balanceLabel:{marginTop:3,textAlign:'right',color:'#8b958f',fontSize:9},
  backdrop:{flex:1,backgroundColor:'#13251d88'},sheet:{maxHeight:'82%',padding:22,paddingBottom:32,borderTopLeftRadius:25,borderTopRightRadius:25,backgroundColor:'#fff'},sheetHead:{marginBottom:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},sheetTitle:{fontSize:22,fontWeight:'800',color:'#17221d'},close:{fontSize:30,color:'#77817c'},field:{marginBottom:14},fieldLabel:{marginBottom:7,color:'#536159',fontSize:11,fontWeight:'700'},input:{height:48,paddingHorizontal:14,borderWidth:1,borderColor:'#dce2de',borderRadius:11,color:'#17221d',backgroundColor:'#fafbf9'},sheetCopy:{marginBottom:18,color:'#657169',fontSize:13},bold:{fontWeight:'800',color:'#17221d'},choices:{marginBottom:15,gap:8},choice:{padding:13,borderWidth:1,borderColor:'#dfe4e1',borderRadius:12},choiceActive:{borderColor:'#1d6b4d',backgroundColor:'#eef7e1'},choiceTitle:{fontWeight:'800',color:'#23332b'},choicePrice:{marginTop:3,color:'#728078',fontSize:11},statusChoices:{marginBottom:18,flexDirection:'row',gap:8},statusChoice:{flex:1,padding:11,alignItems:'center',borderWidth:1,borderColor:'#dfe4e1',borderRadius:10},statusChoiceActive:{borderColor:'#1d6b4d',backgroundColor:'#eef7e1'},statusChoiceText:{color:'#728078',fontSize:11,fontWeight:'700'},statusChoiceTextActive:{color:'#1d6b4d'},
  issueCard:{marginBottom:10,padding:14,borderWidth:1,borderColor:'#ead7d2',borderRadius:13,backgroundColor:'#fff8f6'},issueTitle:{color:'#24342c',fontSize:13,fontWeight:'800'},issueDate:{marginTop:3,color:'#7d8882',fontSize:9},issueError:{marginTop:9,color:'#8a3f31',fontSize:11,lineHeight:16},discard:{marginTop:12,color:'#1d6b4d',fontSize:11,fontWeight:'800'},
  tabbar:{paddingTop:8,paddingBottom:10,flexDirection:'row',borderTopWidth:1,borderTopColor:'#dfe4e1',backgroundColor:'#fff'},tab:{flex:1,alignItems:'center'},tabIcon:{color:'#929b96',fontSize:20,fontWeight:'700'},tabLabel:{marginTop:2,color:'#929b96',fontSize:9,fontWeight:'700'},tabActive:{color:'#1d6b4d'},
});
