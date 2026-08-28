import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, Easing, Image, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native';
import * as Network from 'expo-network';
import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import writeExcelFile, { type SheetData } from 'write-excel-file/universal';
import { api } from './src/api';
import { discardSyncIssue, getSyncIssues, getSyncState, initializeOffline, offline, subscribeOffline, syncNow } from './src/offline';
import type { Currency, Dashboard, GymSubscriptionPlan, Member, Membership, MemberSex, Payment, Plan, SyncIssue, SyncState, Tab, User } from './src/types';

let activeCurrency: Currency = 'CUP';
let activeSubscriptionEndsAt = '';
let activeSubscriptionTrialDays = 7;
const renewalMessage = 'Para continuar debes renovar la membresía de tu gimnasio.';
const renewalWhatsApp = (process.env.EXPO_PUBLIC_RENEWAL_WHATSAPP ?? '').replace(/\D/g,'');
const money = (value: number | string) => `${Number(value).toLocaleString('es-CU', { maximumFractionDigits: 2 })} ${activeCurrency}`;
const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
type PaymentMonthFilter = 'ALL' | number;
type PaymentYearFilter = 'ALL' | number;

function subscriptionIsActive() { return !!activeSubscriptionEndsAt && new Date(activeSubscriptionEndsAt).getTime() > Date.now(); }
function ensureActiveSubscription() { if (!subscriptionIsActive()) throw new Error(renewalMessage); }
function withActiveSubscription(action: () => void) { if (!subscriptionIsActive()) { Alert.alert('Membresía vencida', renewalMessage); return; } action(); }
function gymSubscriptionLabel(plan: GymSubscriptionPlan, trialDays = activeSubscriptionTrialDays) { return plan==='TRIAL'?`Prueba gratuita · ${trialDays} días`:({MONTHLY:'Mensual',ANNUAL:'Anual'} as Record<Exclude<GymSubscriptionPlan,'TRIAL'>,string>)[plan]; }

function paymentCreatedDate(payment: Payment) {
  const fallback = payment.movements.map(movement => movement.occurredAt).sort()[0];
  const value = payment.createdAt ?? fallback;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function paymentPeriodLabel(month: PaymentMonthFilter, year: PaymentYearFilter) {
  if (month === 'ALL' && year === 'ALL') return 'Todos los períodos';
  if (month === 'ALL') return `Año ${year}`;
  if (year === 'ALL') return monthNames[month];
  return `${monthNames[month]} ${year}`;
}

async function exportPaymentsExcel(payments: Payment[], period: string) {
  if (!payments.length) throw new Error('No hay cobros en el período seleccionado');
  if (!await Sharing.isAvailableAsync()) throw new Error('Este dispositivo no permite compartir archivos');
  const headerStyle = { backgroundColor:'#174d3b', textColor:'#ffffff', fontWeight:'bold' as const, align:'center' as const, wrap:true, borderColor:'#d7e0da', borderStyle:'thin' as const };
  const labelStyle = { backgroundColor:'#e8f5ce', textColor:'#174d3b', fontWeight:'bold' as const, align:'center' as const };
  const currencyFormat = '#,##0.00';
  const firstDataRow = 9;
  const lastDataRow = firstDataRow + payments.length - 1;
  const rows: SheetData = [
    [{ value:'GymFlow Mini · Reporte de cobros', fontSize:18, fontWeight:'bold', textColor:'#174d3b', columnSpan:9 }],
    [{ value:`Período: ${period}`, fontSize:11, textColor:'#657169', columnSpan:9 }],
    [{ value:`Generado: ${new Date().toLocaleString('es-CU')}`, fontSize:10, textColor:'#657169', columnSpan:9 }],
    [],
    [{value:'Cantidad',...labelStyle},null,{value:'Facturado',...labelStyle},null,{value:'Cobrado',...labelStyle},null,{value:'Saldo',...labelStyle}],
    [{value:payments.length,type:Number,align:'center'},null,{value:`=SUM(E${firstDataRow}:E${lastDataRow})`,type:'Formula',format:currencyFormat,fontWeight:'bold'},null,{value:`=SUM(F${firstDataRow}:F${lastDataRow})`,type:'Formula',format:currencyFormat,fontWeight:'bold'},null,{value:`=SUM(G${firstDataRow}:G${lastDataRow})`,type:'Formula',format:currencyFormat,fontWeight:'bold'}],
    [],
    ['Fecha','Miembro','CI','Plan','Total','Pagado','Saldo','Estado','Último abono'].map(value => ({value,...headerStyle})),
    ...payments.map((payment, index) => {
      const row = firstDataRow + index;
      const total = Number(payment.amount); const paid = Math.min(total, Math.max(0, Number(payment.paidAmount))); const balance = Math.max(0, total - paid);
      const status = paymentDisplayStatus(payment, total, paid, balance).label;
      const createdDate = paymentCreatedDate(payment);
      const latestMovement = [...payment.movements].sort((a,b) => b.occurredAt.localeCompare(a.occurredAt))[0];
      return [
        createdDate ? {value:createdDate,type:Date,format:'yyyy-mm-dd'} : '',
        `${payment.member.firstName} ${payment.member.lastName}`,
        payment.member.ci,
        payment.membership.plan.name,
        {value:total,type:Number,format:currencyFormat},
        {value:paid,type:Number,format:currencyFormat},
        {value:`=E${row}-F${row}`,type:'Formula' as const,format:currencyFormat},
        status,
        latestMovement ? {value:new Date(latestMovement.occurredAt),type:Date,format:'yyyy-mm-dd hh:mm'} : '',
      ] as SheetData[number];
    }),
  ];
  const blob = await writeExcelFile(rows, { sheet:'Cobros', stickyRowsCount:8, showGridLines:false, columns:[{width:13},{width:25},{width:16},{width:22},{width:14},{width:14},{width:14},{width:14},{width:20}] }).toBlob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const safePeriod = period.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase();
  const file = new File(Paths.cache, `cobros-${safePeriod || 'todos'}.xlsx`);
  file.create({ overwrite:true, intermediates:true });
  file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', UTI:'org.openxmlformats.spreadsheetml.sheet', dialogTitle:'Exportar cobros a Excel' });
}
type TabIconName = React.ComponentProps<typeof Ionicons>['name'];
const tabs: { id: Tab; icon: TabIconName; activeIcon: TabIconName; label: string }[] = [
  { id:'INICIO', icon:'home-outline', activeIcon:'home', label:'Inicio' },
  { id:'MIEMBROS', icon:'people-outline', activeIcon:'people', label:'Miembros' },
  { id:'PLANES', icon:'pricetags-outline', activeIcon:'pricetags', label:'Planes' },
  { id:'CAJA', icon:'cash-outline', activeIcon:'cash', label:'Caja' },
  { id:'CUENTA', icon:'person-circle-outline', activeIcon:'person-circle', label:'Cuenta' },
];
type ThemePreference = 'system' | 'light' | 'dark';
const THEME_STORAGE_KEY = 'gymflow_mini_theme';
const SHOW_THEME_SELECTOR = false;
let activeDarkTheme = false;
const KeyboardScrollContext = createContext<((target: number) => void) | null>(null);

function useRevealFocusedInput(scrollRef: React.RefObject<ScrollView | null>, additionalOffset: number) {
  const activeTarget = useRef<number | null>(null);
  const revealActiveTarget = useCallback(() => {
    if (activeTarget.current === null) return;
    scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(activeTarget.current, additionalOffset, true);
  }, [additionalOffset, scrollRef]);
  const revealTarget = useCallback((target: number) => {
    activeTarget.current = target;
    if (Keyboard.isVisible()) setTimeout(revealActiveTarget, 60);
  }, [revealActiveTarget]);
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => setTimeout(revealActiveTarget, 60));
    return () => subscription.remove();
  }, [revealActiveTarget]);
  return revealTarget;
}

export default function App() {
  const systemScheme = useColorScheme();
  const [themePreference, setThemePreference] = useState<ThemePreference>('light');
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);
  const dark = themePreference === 'system' ? systemScheme === 'dark' : themePreference === 'dark';
  activeDarkTheme = dark;
  useEffect(() => {
    Promise.all([api.restore().catch(() => null), SecureStore.getItemAsync(THEME_STORAGE_KEY).catch(() => null)]).then(([restoredUser, storedTheme]) => {
      setUser(restoredUser);
      if (storedTheme === 'system' || storedTheme === 'light' || storedTheme === 'dark') setThemePreference(storedTheme);
    }).finally(() => setRestoring(false));
  }, []);
  const changeTheme = (nextTheme: ThemePreference) => { setThemePreference(nextTheme); void SecureStore.setItemAsync(THEME_STORAGE_KEY, nextTheme).catch(showError); };
  if (restoring) return <View style={styles.center}><ActivityIndicator color="#c9f47b" size="large" /></View>;
  if (!user) return <Login onLogin={setUser} />;
  return <AdminApp user={user} dark={dark} themePreference={themePreference} onThemeChange={changeTheme} onLogout={async () => { await api.logout(); setUser(null); }} />;
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState('admin@habanafitness.cu');
  const [password, setPassword] = useState('AdminMini123!');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const revealFocusedInput = useRevealFocusedInput(scrollRef, 24);
  const submit = async () => {
    setLoading(true);
    try { onLogin(await api.login(email.trim(), password)); }
    catch (error) { Alert.alert('No pudimos entrar', (error as Error).message); }
    finally { setLoading(false); }
  };
  return <SafeAreaView style={styles.loginPage}>
    <ExpoStatusBar style="light" />
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.loginKeyboardAvoiding}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} showsVerticalScrollIndicator={false}>
        <KeyboardScrollContext.Provider value={revealFocusedInput}>
        <Image accessibilityLabel="Logo de GymFlow Mini" source={require('./assets/icon.png')} style={styles.logo} />
        <Text style={styles.loginBrand}>GymFlow <Text style={styles.mini}>MINI</Text></Text>
        <Text style={styles.loginTitle}>Tu gimnasio, bajo control.</Text>
        <Text style={styles.loginCopy}>Miembros, planes y caja en una aplicación simple.</Text>
        <View style={styles.loginCard}>
          <Field label="Correo" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" returnKeyType="next" />
          <Field label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry returnKeyType="done" onSubmitEditing={() => void submit()} />
          <PrimaryButton label={loading ? 'Entrando…' : 'Entrar'} onPress={submit} disabled={loading} />
        </View>
        <Text style={styles.version}>PILOTO CUBA · V0.1</Text>
        </KeyboardScrollContext.Provider>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function AdminApp({ user, dark, themePreference, onThemeChange, onLogout }: { user: User; dark: boolean; themePreference: ThemePreference; onThemeChange: (theme: ThemePreference) => void; onLogout: () => void }) {
  const [currentUser, setCurrentUser] = useState(user);
  const [tab, setTab] = useState<Tab>('INICIO');
  const [memberEntryFilter, setMemberEntryFilter] = useState<MemberFilter>('ALL');
  const [ready, setReady] = useState(false); const [revision, setRevision] = useState(0); const [issuesOpen, setIssuesOpen] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>({ phase: 'STARTING', pending: 0, rejected: 0 });
  const scope = currentUser.gymId;
  activeCurrency = currentUser.gym.currency;
  activeSubscriptionEndsAt = currentUser.gym.subscriptionEndsAt;
  activeSubscriptionTrialDays = currentUser.gym.subscriptionTrialDays ?? 7;
  const refreshProfile = useCallback(() => { void api.restore().then(setCurrentUser).catch(() => undefined); }, []);
  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeOffline(() => { if (mounted) { setRevision((value) => value + 1); setSyncState(getSyncState(scope)); } });
    void initializeOffline(scope).then(() => { if (mounted) { setReady(true); setSyncState(getSyncState(scope)); } return syncNow(scope); });
    const networkSubscription = Network.addNetworkStateListener((state) => { if (state.isConnected !== false) { refreshProfile(); void syncNow(scope); } });
    const appSubscription = AppState.addEventListener('change', (state) => { if (state === 'active') { refreshProfile(); void syncNow(scope); } });
    return () => { mounted = false; unsubscribe(); networkSubscription.remove(); appSubscription.remove(); };
  }, [scope,refreshProfile]);
  if (!ready) return <View style={styles.center}><ActivityIndicator color="#c9f47b" size="large" /></View>;
  return <SafeAreaView style={styles.app}><StatusBar barStyle={dark ? "light-content" : "dark-content"} />
    <View style={styles.topbar}>
      <View><Text style={styles.kicker}>{currentUser.gym.name.toUpperCase()}</Text><Text style={styles.screenTitle}>{tabs.find((item) => item.id === tab)?.label}</Text></View>
    </View>
    <SyncBar state={syncState} onPress={() => { refreshProfile(); syncState.rejected > 0 ? setIssuesOpen(true) : void syncNow(scope); }} />
    <View style={styles.content}>
      {tab === 'INICIO' && <DashboardScreen scope={scope} revision={revision} onOpenUpcoming={() => { setMemberEntryFilter('UPCOMING'); setTab('MIEMBROS'); }} />}
      {tab === 'MIEMBROS' && <MembersScreen scope={scope} revision={revision} initialFilter={memberEntryFilter} />}
      {tab === 'PLANES' && <PlansScreen scope={scope} revision={revision} />}
      {tab === 'CAJA' && <PaymentsScreen scope={scope} revision={revision} />}
      {tab === 'CUENTA' && <AccountScreen user={currentUser} themePreference={themePreference} onThemeChange={onThemeChange} onLogout={onLogout} />}
    </View>
    <View style={styles.tabbar}>{tabs.map((item) => { const active=tab===item.id; return <Pressable accessibilityRole="tab" accessibilityState={{selected:active}} accessibilityLabel={item.label} key={item.id} onPress={() => { if (item.id === 'MIEMBROS') setMemberEntryFilter('ALL'); setTab(item.id); }} style={({pressed}) => [styles.tab,pressed&&styles.tabPressed]}><View style={[styles.tabIconWrap,active&&styles.tabIconWrapActive]}><Ionicons name={active?item.activeIcon:item.icon} size={21} color={active?(activeDarkTheme?'#c9f47b':'#1d6b4d'):(activeDarkTheme?'#adb7b1':'#657169')}/></View><Text style={[styles.tabLabel,active&&styles.tabActive]}>{item.label}</Text></Pressable>;})}</View>
    <SyncIssues open={issuesOpen} scope={scope} revision={revision} onClose={() => setIssuesOpen(false)} />
  </SafeAreaView>;
}

type ScreenProps = { scope: string; revision: number };
type MemberFilter = 'ALL' | 'ACTIVE' | 'INACTIVE' | 'UPCOMING' | 'EXPIRED';

function DashboardScreen({ scope, revision, onOpenUpcoming }: ScreenProps & { onOpenUpcoming: () => void }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const monthName = new Intl.DateTimeFormat('es-CU', { month: 'long' }).format(new Date()).toLocaleUpperCase('es-CU');
  const load = useCallback(() => { setLoading(true); Promise.all([offline.dashboard(scope),offline.members(scope)]).then(([dashboard,nextMembers]) => { setData(dashboard); setMembers(nextMembers); }).catch(showError).finally(() => setLoading(false)); }, [scope]);
  const refresh = useCallback(() => { setLoading(true); syncNow(scope).then(load).catch(showError).finally(() => setLoading(false)); }, [scope,load]);
  useEffect(load, [load, revision]);
  const upcoming = members.map(member => ({member,membership:upcomingMembership(member)})).filter((entry): entry is {member:Member;membership:Membership} => !!entry.membership).sort((a,b) => a.membership.endDate.localeCompare(b.membership.endDate));
  return <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} colors={[activeDarkTheme ? '#c9f47b' : '#1d6b4d']} tintColor={activeDarkTheme ? '#c9f47b' : '#1d6b4d'} progressBackgroundColor={activeDarkTheme ? '#212923' : '#fff'} />} contentContainerStyle={styles.scroll}>
    <View style={styles.hero}><Text style={styles.heroLabel}>INGRESOS DE {monthName}</Text><Text style={styles.heroValue}>{money(data?.monthlyRevenue ?? 0)}</Text><Text style={styles.heroHint}>Dinero realmente cobrado</Text></View>
    <View style={styles.metricGrid}><Metric label="Miembros" value={data?.members ?? 0} /><Metric label="Membresías activas" value={data?.activeMemberships ?? 0} /><Metric label="Por cobrar" value={money(data?.pendingDebt ?? 0)} wide /></View>
    <View style={styles.upcomingCard}><View style={styles.upcomingHead}><View style={styles.upcomingIcon}><Ionicons name="time-outline" size={20} color={palette.warning}/></View><View style={styles.rowMain}><Text style={styles.upcomingTitle}>Membresías próximas a vencer</Text><Text style={styles.upcomingCopy}>En los próximos 10 días</Text></View><View style={styles.upcomingCount}><Text style={styles.upcomingCountText}>{upcoming.length}</Text></View></View>{upcoming.slice(0,4).map(({member,membership}) => <View key={membership.id} style={styles.upcomingRow}><View style={styles.rowMain}><Text style={styles.upcomingName}>{member.firstName} {member.lastName}</Text><Text style={styles.upcomingPlan}>{membership.plan.name}</Text></View><View><Text style={styles.upcomingDate}>{formatDate(membership.endDate)}</Text><Text style={styles.upcomingDays}>{remainingDaysLabel(membership.endDate)}</Text></View></View>)}{upcoming.length ? <Pressable accessibilityRole="button" onPress={onOpenUpcoming} style={({pressed}) => [styles.upcomingAction,pressed&&styles.tabPressed]}><Text style={styles.upcomingActionText}>Ver y gestionar en Miembros</Text><Ionicons name="arrow-forward" size={15} color={palette.warning}/></Pressable> : <Text style={styles.upcomingEmpty}>No hay vencimientos cercanos.</Text>}</View>
    <SectionTitle title="Últimos cobros" subtitle="Movimientos registrados por el gimnasio" />
    <View style={styles.card}>{data?.recentPayments.length ? data.recentPayments.map((movement) => <Row key={movement.id} title={`${movement.payment?.member.firstName} ${movement.payment?.member.lastName}`} subtitle={new Date(movement.occurredAt).toLocaleDateString('es-CU')} value={`+ ${money(movement.amount)}`} />) : <Empty text="Aún no hay cobros este mes" />}</View>
  </ScrollView>;
}

function AccountScreen({ user, themePreference, onThemeChange, onLogout }: { user: User; themePreference: ThemePreference; onThemeChange: (theme: ThemePreference) => void; onLogout: () => void }) {
  const confirmLogout = () => Alert.alert('Cerrar sesión', '¿Deseas salir de GymFlow Mini en este dispositivo?', [{ text:'Cancelar', style:'cancel' }, { text:'Cerrar sesión', style:'destructive', onPress:onLogout }]);
  const expired = !subscriptionIsActive();
  const remaining = Math.max(0,Math.ceil((new Date(user.gym.subscriptionEndsAt).getTime()-Date.now())/86_400_000));
  const renew = () => { const text=encodeURIComponent(`Renovar membresía del gimnasio ${user.gym.name}`); const url=`https://wa.me/${renewalWhatsApp}?text=${text}`; void Linking.openURL(url).catch(() => Alert.alert('No se pudo abrir WhatsApp', renewalWhatsApp ? 'Comprueba que WhatsApp esté instalado.' : 'Configura el número de renovación de GymFlow Mini.')); };
  return <ScrollView contentContainerStyle={styles.accountScroll}><View style={styles.accountHero}><Text style={styles.accountHeroLabel}>GIMNASIO</Text><Text style={styles.accountHeroGym}>{user.gym.name}</Text></View><View style={[styles.subscriptionCard,expired&&styles.subscriptionCardExpired]}><View style={styles.subscriptionHead}><View style={[styles.subscriptionIcon,expired&&styles.subscriptionIconExpired]}><Ionicons name={expired?'alert-circle-outline':'shield-checkmark-outline'} size={23} color={expired?palette.danger:palette.action}/></View><View style={styles.rowMain}><Text style={styles.subscriptionEyebrow}>MEMBRESÍA DE GYMFLOW MINI</Text><Text style={[styles.subscriptionName,expired&&styles.subscriptionNameExpired]}>{gymSubscriptionLabel(user.gym.subscriptionPlan)}</Text></View><View style={[styles.subscriptionBadge,expired&&styles.subscriptionBadgeExpired]}><Text style={[styles.subscriptionBadgeText,expired&&styles.subscriptionBadgeTextExpired]}>{expired?'Vencida':'Activa'}</Text></View></View><View style={styles.subscriptionDates}><View><Text style={styles.subscriptionDateLabel}>FECHA DE VENCIMIENTO</Text><Text style={styles.subscriptionDateValue}>{formatDate(user.gym.subscriptionEndsAt)}</Text></View>{!expired?<Text style={styles.subscriptionRemaining}>{remaining} día{remaining===1?'':'s'} restante{remaining===1?'':'s'}</Text>:null}</View>{expired?<><Text style={styles.subscriptionExpiredCopy}>{renewalMessage}</Text><Pressable accessibilityRole="link" accessibilityLabel="Renovar membresía por WhatsApp" onPress={renew} style={({pressed}) => [styles.whatsappButton,pressed&&styles.tabPressed]}><Ionicons name="logo-whatsapp" size={19} color={palette.white}/><Text style={styles.whatsappButtonText}>Renovar por WhatsApp</Text></Pressable></>:null}</View><View style={styles.accountCard}><AccountRow label="Administrador" value={user.name}/><AccountRow label="Correo" value={user.email}/><AccountRow label="Gimnasio" value={user.gym.name}/><AccountRow label="Moneda" value={user.gym.currency} last/></View>{SHOW_THEME_SELECTOR ? <ThemeSelector value={themePreference} onChange={onThemeChange}/> : null}<Pressable accessibilityRole="button" onPress={confirmLogout} style={({pressed}) => [styles.logoutButton, pressed && styles.logoutButtonPressed]}><View style={styles.logoutIcon}><Text style={styles.logoutIconText}>↪</Text></View><View style={styles.rowMain}><Text style={styles.logoutTitle}>Cerrar sesión</Text><Text style={styles.logoutCopy}>Salir de esta cuenta en el dispositivo</Text></View></Pressable><Text style={styles.accountVersion}>GYMFLOW MINI · PILOTO CUBA · V0.1</Text></ScrollView>;
}

function AccountRow({ label, value, last }: { label: string; value: string; last?: boolean }) { return <View style={[styles.accountRow,last&&styles.accountRowLast]}><Text style={styles.accountLabel}>{label}</Text><Text style={styles.accountValue}>{value}</Text></View>; }

function ThemeSelector({ value, onChange }: { value: ThemePreference; onChange: (theme: ThemePreference) => void }) {
  const options: Array<{ id: ThemePreference; label: string; copy: string }> = [
    { id:'system', label:'Sistema', copy:'Usa el tema del teléfono' },
    { id:'light', label:'Claro', copy:'Siempre luminoso' },
    { id:'dark', label:'Oscuro', copy:'Siempre oscuro' },
  ];
  return <View style={styles.themeCard}><Text style={styles.themeTitle}>Apariencia</Text><Text style={styles.themeCopy}>Elige cómo quieres ver GymFlow en este dispositivo.</Text><View style={styles.themeOptions}>{options.map(option => { const selected=value===option.id; return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{selected}} onPress={() => onChange(option.id)} style={({pressed}) => [styles.themeOption,selected&&styles.themeOptionActive,pressed&&styles.themeOptionPressed]}><View style={styles.rowMain}><Text style={[styles.themeOptionTitle,selected&&styles.themeOptionTitleActive]}>{option.label}</Text><Text style={styles.themeOptionCopy}>{option.copy}</Text></View><View style={[styles.themeRadio,selected&&styles.themeRadioActive]}>{selected?<View style={styles.themeRadioDot}/>:null}</View></Pressable>;})}</View></View>;
}

function MembersScreen({ scope, revision, initialFilter }: ScreenProps & { initialFilter: MemberFilter }) {
  const [members, setMembers] = useState<Member[]>([]); const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true); const [search, setSearch] = useState(''); const [memberFilter, setMemberFilter] = useState<MemberFilter>(initialFilter); const [addOpen, setAddOpen] = useState(false); const [selected, setSelected] = useState<Member | null>(null); const [editing, setEditing] = useState<Member | null>(null); const [assigning, setAssigning] = useState<Member | null>(null);
  const load = useCallback(() => { setLoading(true); Promise.all([offline.members(scope), offline.plans(scope)]).then(([m, p]) => { setMembers(m); setPlans(p); }).catch(showError).finally(() => setLoading(false)); }, [scope]);
  const refresh = useCallback(() => { void syncNow(scope).then(load); }, [scope, load]);
  const confirmDelete = (member: Member) => Alert.alert('Eliminar miembro', `¿Deseas eliminar a ${member.firstName} ${member.lastName}? Si tiene historial, se archivará como inactivo.`, [{ text:'Cancelar', style:'cancel' }, { text:'Eliminar', style:'destructive', onPress:() => { try { ensureActiveSubscription(); void offline.deleteMember(scope, member.id).then(() => { setSelected(null); load(); }).catch(showError); } catch(error) { showError(error); } } }]);
  const expiredCount = members.filter(hasExpiredMembership).length;
  const upcomingCount = members.filter(member => !!upcomingMembership(member)).length;
  const filterOptions: Array<{ id: MemberFilter; label: string; count: number }> = [{ id:'ALL', label:'Todos', count:members.length }, { id:'ACTIVE', label:'Activos', count:members.filter(member => member.status === 'ACTIVE').length }, { id:'INACTIVE', label:'Inactivos', count:members.filter(member => member.status === 'INACTIVE').length }, { id:'UPCOMING', label:'Por vencer', count:upcomingCount }, { id:'EXPIRED', label:'Vencidas', count:expiredCount }];
  const filteredMembers = members.filter(member => memberFilter === 'ALL' ? true : memberFilter === 'ACTIVE' ? member.status === 'ACTIVE' : memberFilter === 'INACTIVE' ? member.status === 'INACTIVE' : memberFilter === 'UPCOMING' ? !!upcomingMembership(member) : hasExpiredMembership(member));
  const query=search.trim().toLocaleLowerCase('es'); const visibleMembers=query ? filteredMembers.filter(member => `${member.firstName} ${member.lastName} ${member.code ?? ''} ${member.ci} ${member.age ?? ''} ${sexLabel(member.sex)} ${member.phone ?? ''} ${member.address ?? ''}`.toLocaleLowerCase('es').includes(query)) : filteredMembers;
  useEffect(load, [load, revision]);
  if (addOpen || editing) return <MemberForm scope={scope} open member={editing} plans={plans} onClose={() => { setAddOpen(false); setEditing(null); }} onSaved={() => { setAddOpen(false); setEditing(null); load(); }} />;
  return <>
    <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} colors={[activeDarkTheme ? '#c9f47b' : '#1d6b4d']} tintColor={activeDarkTheme ? '#c9f47b' : '#1d6b4d'} progressBackgroundColor={activeDarkTheme ? '#212923' : '#fff'} />} contentContainerStyle={styles.scroll}>
      <PrimaryButton label="+ Registrar miembro" onPress={() => withActiveSubscription(() => setAddOpen(true))} />
      <View style={styles.memberSearch}><Text style={styles.memberSearchIcon}>⌕</Text><TextInput accessibilityLabel="Buscar miembros" value={search} onChangeText={setSearch} placeholder="Nombre, código, CI o teléfono" placeholderTextColor={activeDarkTheme ? '#aab7b0' : '#657169'} autoCorrect={false} style={styles.memberSearchInput}/>{search ? <Pressable accessibilityRole="button" accessibilityLabel="Limpiar búsqueda" onPress={() => setSearch('')} style={styles.memberSearchClear}><Text style={styles.memberSearchClearText}>×</Text></Pressable> : null}</View>
      <View style={styles.memberFilters}>{filterOptions.map(option => { const active=memberFilter===option.id; return <Pressable key={option.id} accessibilityRole="button" accessibilityState={{selected:active}} onPress={() => setMemberFilter(option.id)} style={[styles.memberFilter,active&&styles.memberFilterActive]}><Text style={[styles.memberFilterText,active&&styles.memberFilterTextActive]}>{option.label}</Text><View style={[styles.memberFilterCount,active&&styles.memberFilterCountActive]}><Text style={[styles.memberFilterCountText,active&&styles.memberFilterCountTextActive]}>{option.count}</Text></View></Pressable>;})}</View>
      <SectionTitle title={query ? `${visibleMembers.length} resultado${visibleMembers.length === 1 ? '' : 's'}` : `${visibleMembers.length} miembro${visibleMembers.length === 1 ? '' : 's'}`} subtitle={memberFilter === 'EXPIRED' ? 'Miembros activos sin una membresía vigente' : memberFilter === 'UPCOMING' ? 'Membresías que vencen en los próximos 10 días' : query ? `Búsqueda dentro del filtro seleccionado` : "Toca un miembro para ver sus opciones"} />
      <View style={styles.card}>{visibleMembers.map(member => { const current = editableMembership(member) ?? member.memberships[0]; const currentStatus=current ? effectiveMembershipStatus(current) : undefined; const expiring=upcomingMembership(member); return <Pressable accessibilityRole="button" accessibilityLabel={`Opciones de ${member.firstName} ${member.lastName}`} onPress={() => setSelected(member)} key={member.id} style={({pressed}) => [styles.memberRow, pressed && styles.memberRowPressed]}>
        <View style={styles.memberAvatar}><Text style={styles.memberAvatarText}>{member.firstName[0]}{member.lastName[0]}</Text></View><View style={styles.rowMain}><Text style={styles.rowTitle}>{member.firstName} {member.lastName}</Text><Text style={styles.rowSubtitle}>{member.code ? `Código ${member.code} · ` : ''}CI {member.ci}</Text><View style={styles.memberPlanLine}><View style={[styles.memberPlanDot, currentStatus === 'ACTIVE' && styles.memberPlanDotActive, expiring&&styles.memberPlanDotUpcoming, currentStatus === 'EXPIRED' && styles.memberPlanDotExpired]}/><Text style={[styles.memberPlanText,expiring&&styles.memberPlanTextUpcoming,currentStatus === 'EXPIRED'&&styles.memberPlanTextExpired]}>{current ? expiring ? `${current.plan.name} · vence ${formatDate(current.endDate)}` : `${current.plan.name} · ${membershipStatusLabel(currentStatus!)}` : 'Sin plan asignado'}</Text></View></View><Text style={styles.memberChevron}>›</Text>
      </Pressable>; })}{!visibleMembers.length && <Empty text={query ? "No se encontraron miembros" : memberFilter === 'UPCOMING' ? "No hay membresías próximas a vencer" : memberFilter === 'EXPIRED' ? "No hay membresías vencidas" : memberFilter === 'INACTIVE' ? "No hay miembros inactivos" : memberFilter === 'ACTIVE' ? "No hay miembros activos" : "Registra tu primer miembro"} />}</View>
    </ScrollView>
    <MemberActions member={selected} onClose={() => setSelected(null)} onEdit={() => withActiveSubscription(() => { if (selected) setEditing(selected); setSelected(null); })} onPlan={() => withActiveSubscription(() => { if (selected) setAssigning(selected); setSelected(null); })} onDelete={() => withActiveSubscription(() => { if (selected) confirmDelete(selected); })} />
    <AssignPlanForm scope={scope} member={assigning} plans={plans} onClose={() => setAssigning(null)} onSaved={() => { setAssigning(null); load(); }} />
  </>;
}

function MemberActions({ member, onClose, onEdit, onPlan, onDelete }: { member: Member | null; onClose: () => void; onEdit: () => void; onPlan: () => void; onDelete: () => void }) {
  const active = member ? activeMembership(member) : undefined;
  const editable = member ? editableMembership(member) : undefined;
  const membership = active ?? editable ?? member?.memberships[0];
  const fullName = member ? `${member.firstName} ${member.lastName}` : 'Opciones del miembro';
  return <Sheet open={!!member} title={fullName} onClose={onClose}><View style={styles.memberProfile}><View style={styles.memberProfileAvatar}><Text style={styles.memberProfileInitials}>{member ? `${member.firstName[0]}${member.lastName[0]}` : ''}</Text></View><View style={styles.rowMain}><Text style={styles.memberProfileName}>{fullName}</Text><Text style={styles.memberProfileMeta}>CI {member?.ci}{member?.phone ? ` · ${member.phone}` : ''}</Text><Text style={[styles.memberProfilePlan,membership&&effectiveMembershipStatus(membership)==='EXPIRED'&&styles.memberPlanTextExpired]}>{membership ? `${membership.plan.name} · ${membershipStatusLabel(effectiveMembershipStatus(membership))}` : 'Sin membresía vigente'}</Text>{active ? <Text style={styles.memberProfileExpiry}>Vence el {formatDate(active.endDate)} · {remainingDaysLabel(active.endDate)}</Text> : null}</View></View><View style={styles.memberActionGrid}><Pressable accessibilityRole="button" onPress={onEdit} style={({pressed}) => [styles.memberActionCard, pressed && styles.memberActionCardPressed]}><View style={styles.memberActionIcon}><Text style={styles.memberActionIconText}>✎</Text></View><View style={styles.rowMain}><Text style={styles.memberActionTitle}>Editar datos</Text><Text style={styles.memberActionCopy}>Nombre, CI, teléfono, dirección y estado</Text></View><Text style={styles.memberActionChevron}>›</Text></Pressable><Pressable accessibilityRole="button" onPress={onPlan} style={({pressed}) => [styles.memberActionCard, styles.memberActionCardPlan, pressed && styles.memberActionCardPressed]}><View style={[styles.memberActionIcon, styles.memberActionIconPlan]}><Text style={styles.memberActionIconText}>◆</Text></View><View style={styles.rowMain}><Text style={styles.memberActionTitle}>{editable ? 'Gestionar plan' : 'Asignar plan'}</Text><Text style={styles.memberActionCopy}>{editable ? 'Cambiar plan o estado de la membresía' : 'Crear una nueva membresía para este miembro'}</Text></View><Text style={styles.memberActionChevron}>›</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Eliminar miembro" onPress={onDelete} style={({pressed}) => [styles.memberActionCard, styles.memberActionCardDelete, pressed && styles.memberActionCardPressed]}><View style={[styles.memberActionIcon, styles.memberActionIconDelete]}><Text style={[styles.memberActionIconText, styles.memberActionDeleteText]}>×</Text></View><View style={styles.rowMain}><Text style={[styles.memberActionTitle, styles.memberActionDeleteText]}>Eliminar miembro</Text><Text style={styles.memberActionCopy}>Elimina el registro o lo archiva si tiene historial</Text></View></Pressable></View></Sheet>;
}

function PlansScreen({ scope, revision }: ScreenProps) {
  const [plans, setPlans] = useState<Plan[]>([]); const [loading, setLoading] = useState(true); const [open, setOpen] = useState(false); const [selected, setSelected] = useState<Plan | null>(null); const [editing, setEditing] = useState<Plan | null>(null);
  const load = useCallback(() => { setLoading(true); offline.plans(scope).then(setPlans).catch(showError).finally(() => setLoading(false)); }, [scope]);
  const refresh = useCallback(() => { void syncNow(scope).then(load); }, [scope, load]);
  const onlineAction = async (action: () => void) => { if (!subscriptionIsActive()) { Alert.alert('Membresía vencida', renewalMessage); return; } if (!await hasInternetConnection()) { showOnlineRequired(); return; } action(); };
  const confirmDelete = (plan: Plan) => { void onlineAction(() => Alert.alert('Eliminar plan', `¿Deseas eliminar el plan ${plan.name}? No podrá eliminarse si tiene membresías activas.`, [{ text:'Cancelar', style:'cancel' }, { text:'Eliminar', style:'destructive', onPress:() => { void api.deletePlan(plan.id).then(() => syncNow(scope)).then(() => { setSelected(null); load(); }).catch(showError); } }])); };
  useEffect(load, [load, revision]);
  if (open || editing) return <PlanForm scope={scope} open plan={editing} onClose={() => { setOpen(false); setEditing(null); }} onSaved={() => { setOpen(false); setEditing(null); load(); }} />;
  return <><ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} colors={[activeDarkTheme ? '#c9f47b' : '#1d6b4d']} tintColor={activeDarkTheme ? '#c9f47b' : '#1d6b4d'} progressBackgroundColor={activeDarkTheme ? '#212923' : '#fff'} />} contentContainerStyle={styles.scroll}>
    <PrimaryButton label="+ Crear plan" onPress={() => { void onlineAction(() => setOpen(true)); }} />
    <SectionTitle title="Planes del gimnasio" subtitle="Crear, editar y eliminar requieren conexión" />
    {plans.map(plan => <Pressable accessibilityRole="button" onPress={() => setSelected(plan)} key={plan.id} style={({pressed}) => [styles.planCard, pressed && styles.planCardPressed]}><View style={styles.rowMain}><View style={styles.planTitleLine}><Text style={styles.planName}>{plan.name}</Text><View style={[styles.planState, plan.isActive && styles.planStateActive]}><Text style={[styles.planStateText, plan.isActive && styles.planStateTextActive]}>{plan.isActive ? 'Activo' : 'Inactivo'}</Text></View></View><Text style={styles.rowSubtitle}>{plan.durationDays} días{plan.description ? ` · ${plan.description}` : ''}</Text></View><Text style={styles.planPrice}>{money(plan.price)}</Text><Text style={styles.memberChevron}>›</Text></Pressable>)}
  </ScrollView><PlanActions plan={selected} onClose={() => setSelected(null)} onEdit={() => { void onlineAction(() => { if (selected) setEditing(selected); setSelected(null); }); }} onDelete={() => { if (selected) confirmDelete(selected); }}/></>;
}

function PaymentsScreen({ scope, revision }: ScreenProps) {
  const [payments, setPayments] = useState<Payment[]>([]); const [loading, setLoading] = useState(true); const [selected, setSelected] = useState<Payment | null>(null);
  const [monthFilter, setMonthFilter] = useState<PaymentMonthFilter>('ALL'); const [yearFilter, setYearFilter] = useState<PaymentYearFilter>('ALL'); const [exporting, setExporting] = useState(false);
  const load = useCallback(() => { setLoading(true); offline.payments(scope).then(setPayments).catch(showError).finally(() => setLoading(false)); }, [scope]);
  const refresh = useCallback(() => { void syncNow(scope).then(load); }, [scope, load]);
  useEffect(load, [load, revision]);
  const years = Array.from(new Set([new Date().getFullYear(), ...payments.map(payment => paymentCreatedDate(payment)?.getFullYear()).filter((year): year is number => year !== undefined)])).sort((a,b) => b-a);
  const filteredPayments = payments.filter(payment => { const date=paymentCreatedDate(payment); if (monthFilter === 'ALL' && yearFilter === 'ALL') return true; if (!date) return false; return (monthFilter === 'ALL' || date.getMonth() === monthFilter) && (yearFilter === 'ALL' || date.getFullYear() === yearFilter); });
  const period = paymentPeriodLabel(monthFilter, yearFilter);
  const debt = filteredPayments.reduce((sum, payment) => payment.status === 'CANCELLED' ? sum : sum + Math.max(0, Number(payment.amount) - Number(payment.paidAmount)), 0);
  const pendingCount = filteredPayments.filter(payment => payment.status !== 'CANCELLED' && Number(payment.amount) > Number(payment.paidAmount)).length;
  const exportExcel = async () => { setExporting(true); try { await exportPaymentsExcel(filteredPayments, period); } catch(error) { showError(error); } finally { setExporting(false); } };
  return <><ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} colors={[activeDarkTheme ? '#c9f47b' : '#1d6b4d']} tintColor={activeDarkTheme ? '#c9f47b' : '#1d6b4d'} progressBackgroundColor={activeDarkTheme ? '#212923' : '#fff'} />} contentContainerStyle={styles.scroll}>
    <View style={[styles.debtCard,styles.debtCardGreen]}><View style={[styles.debtGlowLarge,styles.debtGlowLargeGreen]}/><View style={styles.debtGlowSmall}/><View style={styles.debtHeader}><View style={[styles.debtIcon,styles.debtIconGreen]}><Text style={styles.debtIconText}>$</Text></View><View style={styles.rowMain}><Text style={[styles.debtLabel,styles.debtLabelGreen]}>TOTAL POR COBRAR</Text><Text style={[styles.debtSubtitle,styles.debtSubtitleGreen]}>{period}</Text></View></View><Text style={[styles.debtValue,styles.debtValueGreen]}>{money(debt)}</Text><View style={[styles.debtFooter,styles.debtFooterGreen]}><Text style={[styles.debtPending,styles.debtPendingGreen]}>{pendingCount} cobro{pendingCount === 1 ? '' : 's'} pendiente{pendingCount === 1 ? '' : 's'}</Text><View style={[styles.debtState,styles.debtStateGreen]}><View style={[styles.debtStateDot,styles.debtStateDotGreen]}/><Text style={[styles.debtStateText,styles.debtStateTextGreen]}>Por gestionar</Text></View></View></View>
    <View style={styles.paymentFilters}><Text style={styles.paymentFilterTitle}>Filtrar cobros</Text><Text style={styles.paymentFilterLabel}>Año</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paymentFilterOptions}><FilterChip label="Todos" active={yearFilter === 'ALL'} onPress={() => setYearFilter('ALL')}/>{years.map(year => <FilterChip key={year} label={String(year)} active={yearFilter === year} onPress={() => setYearFilter(year)}/>)}</ScrollView><Text style={styles.paymentFilterLabel}>Mes</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paymentFilterOptions}><FilterChip label="Todos" active={monthFilter === 'ALL'} onPress={() => setMonthFilter('ALL')}/>{monthNames.map((month,index) => <FilterChip key={month} label={month.slice(0,3)} active={monthFilter === index} onPress={() => setMonthFilter(index)}/>)}</ScrollView><View style={styles.paymentFilterFooter}><Text style={styles.paymentFilterResult}>{filteredPayments.length} cobro{filteredPayments.length === 1 ? '' : 's'} · {period}</Text><Pressable accessibilityRole="button" accessibilityLabel="Exportar cobros filtrados a Excel" disabled={exporting || !filteredPayments.length} onPress={() => void exportExcel()} style={({pressed}) => [styles.excelButton,(exporting || !filteredPayments.length) && styles.disabled,pressed && styles.tabPressed]}>{exporting ? <ActivityIndicator size="small" color={palette.white}/> : <Ionicons name="download-outline" size={16} color={palette.white}/>}<Text style={styles.excelButtonText}>{exporting ? 'Exportando…' : 'Excel'}</Text></Pressable></View></View>
    <SectionTitle title="Cobros" subtitle={`Mostrando ${period.toLocaleLowerCase('es-CU')}`} />
    <View style={styles.paymentList}>{filteredPayments.map(payment => {
      const total = Number(payment.amount);
      const paid = Math.min(total, Math.max(0, Number(payment.paidAmount)));
      const balance = Math.max(0, total - paid);
      const status = paymentDisplayStatus(payment, total, paid, balance);
      const disabled = balance <= 0 || payment.status === 'CANCELLED';
      const progress = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
      return <Pressable disabled={disabled} onPress={() => withActiveSubscription(() => setSelected(payment))} key={payment.id} style={({pressed}) => [styles.paymentDetailRow, pressed && styles.paymentDetailRowPressed]}>
        <View style={styles.paymentDetailHead}><View style={styles.rowMain}><Text style={styles.rowTitle}>{payment.member.firstName} {payment.member.lastName}</Text><Text style={styles.rowSubtitle}>{payment.membership.plan.name}</Text></View><View style={[styles.paymentBadge, status.tone === 'success' && styles.paymentBadgeSuccess, status.tone === 'danger' && styles.paymentBadgeDanger]}><Text style={[styles.paymentBadgeText, status.tone === 'success' && styles.paymentBadgeTextSuccess, status.tone === 'danger' && styles.paymentBadgeTextDanger]}>{status.label}</Text></View></View>
        <View style={styles.paymentAmounts}><View><Text style={styles.paymentAmountLabel}>PAGADO</Text><Text style={styles.paymentPaid}>{money(paid)}</Text></View><View><Text style={[styles.paymentAmountLabel, styles.paymentAmountRight]}>TOTAL</Text><Text style={styles.paymentTotal}>{money(total)}</Text></View></View>
        <View style={styles.paymentProgress}><View style={[styles.paymentProgressFill, { width: `${progress}%` }]} /></View>
        {payment.movements.length ? <View style={styles.paymentOperations}><Text style={styles.paymentOperationsTitle}>OPERACIONES</Text>{payment.movements.map(movement => <View key={movement.id} style={styles.paymentOperation}><Text style={styles.paymentOperationAmount}>Abono {money(movement.amount)}</Text><Text style={styles.paymentOperationDate}>{formatDateTime(movement.occurredAt)}</Text></View>)}</View> : <Text style={styles.paymentNoOperations}>Sin operaciones registradas</Text>}
        {!disabled ? <Text style={styles.paymentBalanceCopy}>Saldo pendiente: {money(balance)} · Toca para cobrar</Text> : null}
      </Pressable>;
    })}{!filteredPayments.length && <View style={styles.card}><Empty text={payments.length ? 'No hay cobros en el período seleccionado' : 'No hay cobros registrados'} /></View>}</View>
  </ScrollView><PaymentForm scope={scope} payment={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); load(); }} /></>;
}

function MemberForm({ scope, open, member, plans, onClose, onSaved }: FormProps & { member: Member | null; plans: Plan[] }) {
  const [ci, setCi] = useState(''); const [code, setCode] = useState(''); const [firstName, setFirstName] = useState(''); const [lastName, setLastName] = useState(''); const [age, setAge] = useState(''); const [sex, setSex] = useState<MemberSex | ''>(''); const [phone, setPhone] = useState(''); const [address, setAddress] = useState(''); const [status, setStatus] = useState('ACTIVE'); const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(0); const [planId, setPlanId] = useState('');
  const availablePlans = plans.filter(plan => plan.isActive);
  const totalPages = member ? 4 : 5;
  useEffect(() => { if (!open) return; setPage(0); setPlanId(''); setCi(member?.ci ?? ''); setCode(member?.code ?? ''); setFirstName(member?.firstName ?? ''); setLastName(member?.lastName ?? ''); setAge(member?.age ? String(member.age) : ''); setSex(member?.sex ?? ''); setPhone(member?.phone ?? ''); setAddress(member?.address ?? ''); setStatus(member?.status ?? 'ACTIVE'); }, [open, member]);
  const save = async () => { setSaving(true); try { ensureActiveSubscription(); const input = { ci, code: code.trim() || null, firstName: firstName.trim(), lastName: lastName.trim(), age: age ? Number(age) : null, sex: sex || null, phone: phone.trim(), address: address.trim() }; if (member) await offline.updateMember(scope, member.id, { ...input, status }); else { if (!planId) throw new Error('Selecciona el plan inicial'); await offline.createMember(scope, input); await syncNow(scope); const createdMember=(await offline.members(scope)).find(item => item.ci === ci); if (!createdMember) throw new Error('No se pudo encontrar el miembro recién creado'); await offline.assignPlan(scope, { memberId:createdMember.id, planId }); } Keyboard.dismiss(); onSaved(); } catch (error) { showError(error); } finally { setSaving(false); } };
  const validAge = !age || (Number.isInteger(Number(age)) && Number(age) >= 1 && Number(age) <= 120);
  const pageValid = [!!firstName.trim() && !!lastName.trim(), ci.length === 11, validAge, true, !!planId][page];
  const pageTitles = ['Datos personales', 'Identificación', 'Información adicional', 'Contacto y estado', 'Plan inicial'];
  const goBack = () => { Keyboard.dismiss(); if (page > 0) setPage((value) => value - 1); else onClose(); };
  const goForward = () => { Keyboard.dismiss(); if (page < totalPages - 1) setPage((value) => value + 1); else void save(); };
  return <View style={styles.memberFormPage}>
    <View style={styles.memberFormHeader}><View style={styles.memberFormHeaderRow}><Pressable accessibilityRole="button" accessibilityLabel={page > 0 ? 'Paso anterior' : 'Volver a miembros'} onPress={goBack} style={({pressed}) => [styles.memberFormBack, pressed && styles.tabPressed]}><Ionicons name="arrow-back" size={19} color={activeDarkTheme ? darkPalette.text : palette.ink}/><Text style={styles.memberFormBackText}>{page > 0 ? 'Atrás' : 'Volver'}</Text></Pressable><Text style={styles.memberFormStep}>PASO {page + 1} DE {totalPages}</Text><Pressable accessibilityRole="button" disabled={!pageValid || saving} onPress={goForward} style={[styles.memberFormNext, (!pageValid || saving) && styles.disabled]}><Text style={styles.memberFormNextText}>{page === totalPages - 1 ? saving ? 'Guardando…' : 'Guardar' : 'Siguiente'}</Text><Ionicons name={page === totalPages - 1 ? 'checkmark' : 'arrow-forward'} size={16} color={palette.white}/></Pressable></View><View style={styles.memberFormProgress}>{Array.from({length:totalPages},(_,step) => <View key={step} style={[styles.memberFormProgressPart, step <= page && styles.memberFormProgressPartActive]}/>)}</View><Text style={styles.memberFormTitle}>{pageTitles[page]}</Text><Text style={styles.memberFormCopy}>{member ? 'Editando los datos del miembro.' : page === 4 ? 'Selecciona obligatoriamente la membresía inicial.' : 'Registrando un nuevo miembro.'}</Text></View>
    <ScrollView key={page} style={styles.memberFormScroll} contentContainerStyle={styles.memberFormContent} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} showsVerticalScrollIndicator={false}>
      {page === 0 ? <><Field label="Nombre" value={firstName} onChangeText={setFirstName} /><Field label="Apellidos" value={lastName} onChangeText={setLastName} /></> : null}
      {page === 1 ? <><Field label="Carnet de identidad (11 dígitos)" value={ci} onChangeText={(value) => setCi(value.replace(/\D/g, '').slice(0, 11))} keyboardType="number-pad" maxLength={11} /><Field label="Código interno (opcional)" value={code} onChangeText={(value) => setCode(value.slice(0, 40))} maxLength={40} /></> : null}
      {page === 2 ? <><Field label="Edad (opcional)" value={age} onChangeText={(value) => setAge(value.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" maxLength={3} /><Text style={styles.fieldLabel}>Sexo (opcional)</Text><View style={styles.statusChoices}>{([['MALE','Masculino'],['FEMALE','Femenino'],['OTHER','Otro']] as Array<[MemberSex,string]>).map(([value,label]) => <Pressable key={value} onPress={() => setSex(sex === value ? '' : value)} style={[styles.statusChoice, sex === value && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, sex === value && styles.statusChoiceTextActive]}>{label}</Text></Pressable>)}</View></> : null}
      {page === 3 ? <><Field label="Teléfono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" /><Field label="Dirección" value={address} onChangeText={setAddress} />{member && <><Text style={styles.fieldLabel}>Estado</Text><View style={styles.statusChoices}><Pressable onPress={() => setStatus('ACTIVE')} style={[styles.statusChoice, status === 'ACTIVE' && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, status === 'ACTIVE' && styles.statusChoiceTextActive]}>Activo</Text></Pressable><Pressable onPress={() => setStatus('INACTIVE')} style={[styles.statusChoice, status === 'INACTIVE' && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, status === 'INACTIVE' && styles.statusChoiceTextActive]}>Inactivo</Text></Pressable></View></>}</> : null}
      {page === 4 && !member ? <>{availablePlans.length ? <View style={styles.choices}>{availablePlans.map(plan => <Pressable accessibilityRole="radio" accessibilityState={{checked:planId===plan.id}} key={plan.id} onPress={() => setPlanId(plan.id)} style={[styles.choice,planId===plan.id&&styles.choiceActive]}><Text style={styles.choiceTitle}>{plan.name}</Text><Text style={styles.choicePrice}>{money(plan.price)} · {plan.durationDays} días</Text></Pressable>)}</View> : <View style={styles.planRequiredEmpty}><Ionicons name="alert-circle-outline" size={26} color={palette.warning}/><Text style={styles.planRequiredTitle}>No hay planes activos</Text><Text style={styles.planRequiredCopy}>Vuelve a Planes, crea o activa un plan y después registra el miembro.</Text></View>}</> : null}
    </ScrollView>
  </View>;
}

function PlanActions({ plan, onClose, onEdit, onDelete }: { plan: Plan | null; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  return <Sheet open={!!plan} title="Opciones del plan" onClose={onClose}><View style={styles.planProfile}><View style={styles.planProfileIcon}><Text style={styles.planProfileIconText}>◆</Text></View><View style={styles.rowMain}><Text style={styles.memberProfileName}>{plan?.name}</Text><Text style={styles.memberProfileMeta}>{plan?.durationDays} días · {plan ? money(plan.price) : ''}</Text><Text style={[styles.planProfileState, !plan?.isActive && styles.planProfileStateInactive]}>{plan?.isActive ? 'Disponible para nuevas membresías' : 'Plan inactivo'}</Text></View></View><View style={styles.memberActionGrid}><Pressable accessibilityRole="button" onPress={onEdit} style={({pressed}) => [styles.memberActionCard, pressed && styles.memberActionCardPressed]}><View style={styles.memberActionIcon}><Text style={styles.memberActionIconText}>✎</Text></View><View style={styles.rowMain}><Text style={styles.memberActionTitle}>Editar plan</Text><Text style={styles.memberActionCopy}>Nombre, precio, duración, descripción y estado</Text></View><Text style={styles.memberActionChevron}>›</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Eliminar plan" onPress={onDelete} style={({pressed}) => [styles.memberActionCard, styles.memberActionCardDelete, pressed && styles.memberActionCardPressed]}><View style={[styles.memberActionIcon, styles.memberActionIconDelete]}><Text style={[styles.memberActionIconText, styles.memberActionDeleteText]}>×</Text></View><View style={styles.rowMain}><Text style={[styles.memberActionTitle, styles.memberActionDeleteText]}>Eliminar plan</Text><Text style={styles.memberActionCopy}>Se archivará si conserva historial de membresías</Text></View></Pressable></View></Sheet>;
}

function PlanForm({ scope, open, plan, onClose, onSaved }: FormProps & { plan: Plan | null }) {
  const [name, setName] = useState(''); const [price, setPrice] = useState(''); const [days, setDays] = useState('30'); const [description, setDescription] = useState(''); const [isActive, setIsActive] = useState(true); const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => { if (!open) return; setPage(0); setName(plan?.name ?? ''); setPrice(plan?.price ? String(plan.price) : ''); setDays(plan ? String(plan.durationDays) : '30'); setDescription(plan?.description ?? ''); setIsActive(plan?.isActive ?? true); }, [open, plan]);
  const save = async () => { setSaving(true); try { ensureActiveSubscription(); if (!await hasInternetConnection()) { showOnlineRequired(); return; } const input={ name:name.trim(), price:Number(price), durationDays:Number(days), description:description.trim(), isActive }; if (plan) await api.updatePlan(plan.id, input); else await api.createPlan(input); await syncNow(scope); Keyboard.dismiss(); onSaved(); } catch(error) { showError(error); } finally { setSaving(false); } };
  const pageValid = page === 0 ? !!name.trim() : !!price && Number(price) > 0 && !!days && Number(days) > 0;
  const goBack = () => { Keyboard.dismiss(); if (page > 0) setPage(0); else onClose(); };
  const goForward = () => { Keyboard.dismiss(); if (page === 0) setPage(1); else void save(); };
  return <View style={styles.memberFormPage}>
    <View style={styles.memberFormHeader}><View style={styles.memberFormHeaderRow}><Pressable accessibilityRole="button" accessibilityLabel={page > 0 ? 'Paso anterior' : 'Volver a planes'} onPress={goBack} style={({pressed}) => [styles.memberFormBack, pressed && styles.tabPressed]}><Ionicons name="arrow-back" size={19} color={activeDarkTheme ? darkPalette.text : palette.ink}/><Text style={styles.memberFormBackText}>{page > 0 ? 'Atrás' : 'Volver'}</Text></Pressable><Text style={styles.memberFormStep}>PASO {page + 1} DE 2</Text><Pressable accessibilityRole="button" disabled={!pageValid || saving} onPress={goForward} style={[styles.memberFormNext, (!pageValid || saving) && styles.disabled]}><Text style={styles.memberFormNextText}>{page === 1 ? saving ? 'Guardando…' : 'Guardar' : 'Siguiente'}</Text><Ionicons name={page === 1 ? 'checkmark' : 'arrow-forward'} size={16} color={palette.white}/></Pressable></View><View style={styles.memberFormProgress}>{[0,1].map((step) => <View key={step} style={[styles.memberFormProgressPart, step <= page && styles.memberFormProgressPartActive]}/>)}</View><Text style={styles.memberFormTitle}>{page === 0 ? 'Información del plan' : 'Precio y duración'}</Text><Text style={styles.memberFormCopy}>{plan ? 'Editando los datos del plan.' : 'Creando un nuevo plan.'}</Text></View>
    <ScrollView key={page} style={styles.memberFormScroll} contentContainerStyle={styles.memberFormContent} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} showsVerticalScrollIndicator={false}>
      {page === 0 ? <><Field label="Nombre del plan" value={name} onChangeText={setName} /><Field label="Descripción (opcional)" value={description} onChangeText={(value) => setDescription(value.slice(0, 300))} maxLength={300} /></> : null}
      {page === 1 ? <><Field label={`Precio en ${activeCurrency}`} value={price} onChangeText={setPrice} keyboardType="numeric" /><Field label="Duración en días" value={days} onChangeText={setDays} keyboardType="number-pad" />{plan ? <><Text style={styles.fieldLabel}>Disponibilidad</Text><View style={styles.statusChoices}><Pressable onPress={() => setIsActive(true)} style={[styles.statusChoice, isActive && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, isActive && styles.statusChoiceTextActive]}>Activo</Text></Pressable><Pressable onPress={() => setIsActive(false)} style={[styles.statusChoice, !isActive && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, !isActive && styles.statusChoiceTextActive]}>Inactivo</Text></Pressable></View></> : null}</> : null}
    </ScrollView>
  </View>;
}

function AssignPlanForm({ scope, member, plans, onClose, onSaved }: { scope: string; member: Member | null; plans: Plan[]; onClose: () => void; onSaved: () => void }) {
  const membership = member ? editableMembership(member) : undefined;
  const availablePlans = plans.filter(plan => plan.isActive || plan.id === membership?.plan.id);
  const [planId, setPlanId] = useState(''); const [amount, setAmount] = useState(''); const [status, setStatus] = useState('ACTIVE'); const [saving, setSaving] = useState(false);
  useEffect(() => { setPlanId(membership?.plan.id ?? availablePlans.find(plan => plan.isActive)?.id ?? ''); setStatus(membership?.status ?? 'ACTIVE'); setAmount(''); }, [member, membership?.id, membership?.plan.id, membership?.status, plans]);
  const save = async () => { if (!member || !planId) return; setSaving(true); try { ensureActiveSubscription(); if (membership) await offline.updateMembership(scope, member.id, membership.id, { planId, status }); else await offline.assignPlan(scope, { memberId: member.id, planId, ...(Number(amount) > 0 ? { initialPayment: Number(amount), paymentMethod: 'CASH' } : {}) }); onSaved(); } catch (error) { showError(error); } finally { setSaving(false); } };
  return <Sheet open={!!member} title={`${membership ? 'Editar membresía' : 'Plan'} de ${member?.firstName ?? ''}`} onClose={onClose} footer={<PrimaryButton label={saving ? "Guardando…" : membership ? "Guardar membresía" : "Asignar plan"} disabled={saving || !planId} onPress={() => void save()} />}>
    {membership && <Text style={styles.sheetCopy}>Plan actual: <Text style={styles.bold}>{membership.plan.name}</Text></Text>}
    <Text style={styles.fieldLabel}>Selecciona el plan</Text><View style={styles.choices}>{availablePlans.map(plan => <Pressable key={plan.id} onPress={() => setPlanId(plan.id)} style={[styles.choice, planId === plan.id && styles.choiceActive]}><Text style={styles.choiceTitle}>{plan.name}{plan.id === membership?.plan.id ? ' · Actual' : ''}</Text><Text style={styles.choicePrice}>{money(plan.price)}</Text></Pressable>)}</View>
    {membership ? <><Text style={styles.fieldLabel}>Estado de la membresía</Text><View style={styles.statusChoices}>{['ACTIVE','SCHEDULED','EXPIRED','CANCELLED'].map(value=><Pressable key={value} onPress={() => setStatus(value)} style={[styles.statusChoice, status === value && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, status === value && styles.statusChoiceTextActive]}>{membershipStatusLabel(value)}</Text></Pressable>)}</View></> : <Field label="Abono inicial (opcional)" value={amount} onChangeText={setAmount} keyboardType="numeric" />}
  </Sheet>;
}

function PaymentForm({ scope, payment, onClose, onSaved }: { scope: string; payment: Payment | null; onClose: () => void; onSaved: () => void }) {
  const balance = payment ? Number(payment.amount) - Number(payment.paidAmount) : 0; const [amount, setAmount] = useState('');
  useEffect(() => setAmount(payment ? String(balance) : ''), [payment, balance]);
  return <Sheet open={!!payment} title="Registrar abono" onClose={onClose} footer={<PrimaryButton label="Confirmar cobro" disabled={!amount || Number(amount) <= 0 || Number(amount) > balance} onPress={() => { try { ensureActiveSubscription(); if (payment) void offline.applyPayment(scope, payment.id, { amount: Number(amount), method: 'CASH' }).then(onSaved).catch(showError); } catch(error) { showError(error); } }} />}><Text style={styles.sheetCopy}>Saldo de {payment?.member.firstName}: <Text style={styles.bold}>{money(balance)}</Text></Text><Field label="Importe recibido en efectivo" value={amount} onChangeText={setAmount} keyboardType="numeric" /></Sheet>;
}

function SyncBar({ state, onPress }: { state: SyncState; onPress: () => void }) {
  const labels: Record<SyncState['phase'], string> = { STARTING: 'Preparando datos', SYNCED: 'Datos al día', SYNCING: 'Sincronizando', OFFLINE: 'Modo sin conexión', ERROR: 'No se pudo sincronizar' };
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
function Sheet({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [showScrollHint, setShowScrollHint] = useState(false);
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const revealFocusedInput = useRevealFocusedInput(scrollRef, 88);
  const scrollMetrics = useRef({ contentHeight: 0, viewportHeight: 0, offsetY: 0 });
  const displayedTitle = useRef(title);
  const displayedChildren = useRef(children);
  const displayedFooter = useRef(footer);
  const updateScrollHint = (next: Partial<typeof scrollMetrics.current>) => {
    Object.assign(scrollMetrics.current, next);
    const { contentHeight, viewportHeight, offsetY } = scrollMetrics.current;
    setShowScrollHint(contentHeight > viewportHeight + 12 && offsetY + viewportHeight < contentHeight - 12);
  };
  if (open) { displayedTitle.current = title; displayedChildren.current = children; displayedFooter.current = footer; }
  useEffect(() => {
    if (open) {
      scrollMetrics.current.offsetY = 0;
      setShowScrollHint(false);
      setMounted(true);
    }
  }, [open]);
  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => { showSubscription.remove(); hideSubscription.remove(); };
  }, []);
  useEffect(() => {
    if (!mounted) return;
    progress.stopAnimation();
    Animated.timing(progress, { toValue: open ? 1 : 0, duration: open ? 280 : 210, easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
  }, [mounted, open, progress]);
  return <Modal visible={mounted} transparent animationType="none" hardwareAccelerated statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.modalRoot}>
      <Animated.View style={[styles.backdrop, { opacity: progress }]}><Pressable accessibilityRole="button" accessibilityLabel="Cerrar modal" style={StyleSheet.absoluteFill} onPress={onClose} /></Animated.View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0} style={keyboardFixStyles.keyboardAvoiding}>
      <Animated.View style={[styles.sheet, !!displayedFooter.current && keyboardOpen && styles.formSheet, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange:[0,1], outputRange:[52,0] }) }, { scale: progress.interpolate({ inputRange:[0,1], outputRange:[.985,1] }) }] }]}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHead}><Text style={styles.sheetTitle}>{displayedTitle.current}</Text><Pressable accessibilityRole="button" accessibilityLabel="Cerrar modal" hitSlop={10} onPress={onClose} style={({pressed}) => [styles.closeButton, pressed && styles.closeButtonPressed]}><Text style={styles.close}>×</Text></Pressable></View>
        <ScrollView ref={scrollRef} style={displayedFooter.current && keyboardOpen ? keyboardFixStyles.formScroll : keyboardFixStyles.sheetScroll} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} contentContainerStyle={keyboardFixStyles.sheetContent} showsVerticalScrollIndicator={!!displayedFooter.current} indicatorStyle={activeDarkTheme ? 'white' : 'black'} scrollEventThrottle={32} onLayout={(event) => updateScrollHint({ viewportHeight: event.nativeEvent.layout.height })} onContentSizeChange={(_width, height) => updateScrollHint({ contentHeight: height })} onScroll={(event) => updateScrollHint({ offsetY: event.nativeEvent.contentOffset.y })}><KeyboardScrollContext.Provider value={revealFocusedInput}>{displayedChildren.current}</KeyboardScrollContext.Provider></ScrollView>
        {displayedFooter.current ? <View style={styles.sheetFooter}>{showScrollHint ? <View pointerEvents="none" style={styles.scrollHint}><Text style={styles.scrollHintText}>Desliza para ver más</Text><Ionicons name="chevron-down" size={15} color={activeDarkTheme ? darkPalette.secondary : palette.secondary} /></View> : null}{displayedFooter.current}</View> : null}
      </Animated.View>
      </KeyboardAvoidingView>
    </View>
  </Modal>;
}
const keyboardFixStyles = StyleSheet.create({
  keyboardAvoiding: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  formScroll: { flex: 1 },
  sheetScroll: { flexShrink: 1 },
  sheetContent: { paddingBottom: 8 },
});
function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) { const revealFocusedInput = useContext(KeyboardScrollContext); const { label, onFocus, ...input } = props; return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput placeholderTextColor={activeDarkTheme ? '#aab7b0' : '#657169'} style={styles.input} {...input} onFocus={(event) => { onFocus?.(event); revealFocusedInput?.(event.nativeEvent.target); }} /></View>; }
function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) { return <Pressable onPress={onPress} disabled={disabled} style={[styles.primary, disabled && styles.disabled]}><Text style={styles.primaryText}>{label}</Text></Pressable>; }
function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityState={{selected:active}} onPress={onPress} style={[styles.paymentFilterChip,active&&styles.paymentFilterChipActive]}><Text style={[styles.paymentFilterChipText,active&&styles.paymentFilterChipTextActive]}>{label}</Text></Pressable>; }
function Metric({ label, value, wide }: { label: string; value: string | number; wide?: boolean }) { return <View style={[styles.metric, wide && styles.metricWide]}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>; }
function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) { return <View style={styles.sectionTitle}><Text style={styles.sectionHeading}>{title}</Text><Text style={styles.sectionCopy}>{subtitle}</Text></View>; }
function Row({ title, subtitle, value }: { title: string; subtitle: string; value: string }) { return <View style={styles.paymentRow}><View style={styles.rowMain}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowSubtitle}>{subtitle}</Text></View><Text style={styles.income}>{value}</Text></View>; }
function Empty({ text }: { text: string }) { return <Text style={styles.empty}>{text}</Text>; }
function showError(error: unknown) { Alert.alert('Atención', error instanceof Error ? error.message : 'Ocurrió un error'); }
async function hasInternetConnection() { const state=await Network.getNetworkStateAsync().catch(() => null); return state?.isConnected !== false; }
function showOnlineRequired() { Alert.alert('Conexión requerida', 'Debes conectarte a internet para crear, editar o eliminar planes.'); }
function effectiveMembershipStatus(membership: Membership) { const now=Date.now(); if ((membership.status === 'ACTIVE' || membership.status === 'SCHEDULED') && new Date(membership.endDate).getTime() < now) return 'EXPIRED'; if (membership.status === 'SCHEDULED' && new Date(membership.startDate).getTime() <= now) return 'ACTIVE'; return membership.status; }
function activeMembership(member: Member) { return member.memberships.find(membership => effectiveMembershipStatus(membership) === 'ACTIVE'); }
function upcomingMembership(member: Member) { if (member.status !== 'ACTIVE') return undefined; const membership=activeMembership(member); if (!membership) return undefined; const limit=new Date(); limit.setDate(limit.getDate()+10); limit.setHours(23,59,59,999); return new Date(membership.endDate).getTime() <= limit.getTime() ? membership : undefined; }
function editableMembership(member: Member) { return member.memberships.find(membership => { const status=effectiveMembershipStatus(membership); return status === 'ACTIVE' || status === 'SCHEDULED'; }); }
function hasExpiredMembership(member: Member) { const latest=member.memberships[0]; return member.status === 'ACTIVE' && !!latest && effectiveMembershipStatus(latest) === 'EXPIRED' && !editableMembership(member); }
function membershipStatusLabel(status: string) { return ({ ACTIVE:'Activa', SCHEDULED:'Programada', EXPIRED:'Vencida', CANCELLED:'Cancelada' } as Record<string,string>)[status] ?? status; }
function sexLabel(sex?: MemberSex | null) { return sex ? ({ MALE:'Masculino', FEMALE:'Femenino', OTHER:'Otro' } as Record<MemberSex,string>)[sex] : ''; }
function formatDate(value: string) { return new Date(value).toLocaleDateString('es-CU', { day:'2-digit', month:'short', year:'numeric' }); }
function formatDateTime(value: string) { return new Date(value).toLocaleString('es-CU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
function remainingDaysLabel(value: string) { const days=Math.max(0,Math.ceil((new Date(value).getTime()-Date.now())/86_400_000)); return `${days} día${days === 1 ? '' : 's'} restante${days === 1 ? '' : 's'}`; }
function paymentDisplayStatus(payment: Payment, total: number, paid: number, balance: number) {
  if (payment.status === 'CANCELLED') return { label:'Cancelado', tone:'danger' } as const;
  if (total <= 0) return { label:'Sin importe', tone:'danger' } as const;
  if (paid >= total && balance === 0) return { label:'Pagado', tone:'success' } as const;
  if (paid > 0) return { label:'Parcial', tone:'warning' } as const;
  if (payment.status === 'OVERDUE') return { label:'Vencido', tone:'danger' } as const;
  return { label:'Pendiente', tone:'warning' } as const;
}

const palette = {
  ink:'#17221d', brand:'#173f31', action:'#1d6b4d', accent:'#c9f47b', background:'#f5f5ef',
  secondary:'#657169', warning:'#e28d36', danger:'#a8453c', white:'#fff', line:'#dfe4e1',
} as const;

const baseStyles = StyleSheet.create({
  center:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:palette.brand},app:{flex:1,backgroundColor:palette.background},content:{flex:1},
  loginPage:{flex:1,backgroundColor:palette.brand,paddingHorizontal:24,paddingTop:70},loginKeyboardAvoiding:{flex:1},loginScroll:{flexGrow:1},logo:{width:64,height:64,borderRadius:18},loginBrand:{marginTop:16,color:palette.white,fontSize:22,fontWeight:'800'},mini:{color:palette.accent,fontSize:11,letterSpacing:2},loginTitle:{marginTop:44,color:palette.white,fontSize:34,fontWeight:'800',letterSpacing:-1.2},loginCopy:{marginTop:10,color:'#c4d5cd',fontSize:15,lineHeight:22},loginCard:{marginTop:34,padding:20,borderRadius:20,backgroundColor:palette.white},version:{marginTop:'auto',marginBottom:24,textAlign:'center',color:'#a9c3b7',fontSize:10,letterSpacing:2},
  topbar:{paddingTop:18,paddingHorizontal:20,paddingBottom:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:palette.background},kicker:{color:palette.action,fontSize:9,fontWeight:'800',letterSpacing:1.5},screenTitle:{marginTop:3,fontSize:27,fontWeight:'800',color:palette.ink,letterSpacing:-.8},avatar:{width:39,height:39,borderRadius:20,alignItems:'center',justifyContent:'center',backgroundColor:palette.accent},
  syncBar:{minHeight:44,marginHorizontal:16,marginBottom:4,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:9,borderRadius:12,backgroundColor:'#e8f5ce'},syncOffline:{backgroundColor:'#fff4e8'},syncError:{backgroundColor:'#fee9e5'},syncDot:{width:9,height:9,borderRadius:5,backgroundColor:palette.warning},syncDotOk:{backgroundColor:palette.action},syncMain:{flex:1},syncTitle:{color:palette.ink,fontSize:11,fontWeight:'800'},syncDetail:{marginTop:1,color:palette.secondary,fontSize:9},syncAction:{color:palette.action,fontSize:10,fontWeight:'800'},
  accountScroll:{padding:16,paddingBottom:40},accountHero:{padding:26,alignItems:'center',borderRadius:22,backgroundColor:palette.brand},accountHeroLabel:{color:'#c4d5cd',fontSize:9,fontWeight:'800',letterSpacing:1.3},accountHeroGym:{marginTop:8,color:palette.white,fontSize:23,fontWeight:'900',textAlign:'center'},accountCard:{marginTop:12,paddingHorizontal:17,borderWidth:1,borderColor:palette.line,borderRadius:17,backgroundColor:palette.white},accountRow:{minHeight:61,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:18,borderBottomWidth:1,borderBottomColor:'#edf0ee'},accountRowLast:{borderBottomWidth:0},accountLabel:{color:palette.secondary,fontSize:10,fontWeight:'700'},accountValue:{flex:1,color:palette.ink,fontSize:12,fontWeight:'800',textAlign:'right'},logoutButton:{minHeight:69,marginTop:18,padding:13,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:'#efcec9',borderRadius:15,backgroundColor:'#fff9f8'},logoutButtonPressed:{opacity:.7},logoutIcon:{width:42,height:42,marginRight:12,alignItems:'center',justifyContent:'center',borderRadius:13,backgroundColor:'#fee5e1'},logoutIconText:{color:palette.danger,fontSize:20,fontWeight:'900'},logoutTitle:{color:palette.danger,fontSize:13,fontWeight:'900'},logoutCopy:{marginTop:4,color:palette.secondary,fontSize:9},accountVersion:{marginTop:28,color:palette.secondary,fontSize:9,letterSpacing:1.2,textAlign:'center'},
  subscriptionCard:{marginTop:12,padding:17,borderWidth:1,borderColor:'#cfe3d6',borderRadius:17,backgroundColor:'#f4faf6'},subscriptionCardExpired:{borderColor:'#efc9c3',backgroundColor:'#fff8f7'},subscriptionHead:{flexDirection:'row',alignItems:'center',gap:11},subscriptionIcon:{width:43,height:43,alignItems:'center',justifyContent:'center',borderRadius:14,backgroundColor:'#e2f3e8'},subscriptionIconExpired:{backgroundColor:'#fee7e3'},subscriptionEyebrow:{color:palette.secondary,fontSize:8,fontWeight:'900',letterSpacing:.7},subscriptionName:{marginTop:4,color:palette.action,fontSize:15,fontWeight:'900'},subscriptionNameExpired:{color:palette.danger},subscriptionBadge:{paddingVertical:5,paddingHorizontal:8,borderRadius:10,backgroundColor:'#e1f4e8'},subscriptionBadgeExpired:{backgroundColor:'#fee7e3'},subscriptionBadgeText:{color:palette.action,fontSize:8,fontWeight:'900'},subscriptionBadgeTextExpired:{color:palette.danger},subscriptionDates:{marginTop:15,paddingTop:13,flexDirection:'row',alignItems:'flex-end',justifyContent:'space-between',gap:12,borderTopWidth:1,borderTopColor:'#dbe9df'},subscriptionDateLabel:{color:palette.secondary,fontSize:8,fontWeight:'900',letterSpacing:.7},subscriptionDateValue:{marginTop:5,color:palette.ink,fontSize:12,fontWeight:'800'},subscriptionRemaining:{color:palette.action,fontSize:9,fontWeight:'800'},subscriptionExpiredCopy:{marginTop:14,color:palette.danger,fontSize:10,lineHeight:15,fontWeight:'700'},whatsappButton:{height:47,marginTop:13,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderRadius:12,backgroundColor:'#1fa855'},whatsappButtonText:{color:palette.white,fontSize:11,fontWeight:'900'},
  themeCard:{marginTop:14,padding:17,borderWidth:1,borderColor:palette.line,borderRadius:17,backgroundColor:palette.white},themeTitle:{color:palette.ink,fontSize:15,fontWeight:'900'},themeCopy:{marginTop:4,color:palette.secondary,fontSize:10,lineHeight:14},themeOptions:{marginTop:14,gap:8},themeOption:{minHeight:57,paddingHorizontal:13,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:palette.line,borderRadius:12,backgroundColor:'#fbfcfb'},themeOptionActive:{borderColor:palette.action,backgroundColor:'#eef7e1'},themeOptionPressed:{opacity:.76},themeOptionTitle:{color:palette.ink,fontSize:12,fontWeight:'800'},themeOptionTitleActive:{color:palette.action},themeOptionCopy:{marginTop:3,color:palette.secondary,fontSize:9},themeRadio:{width:19,height:19,marginLeft:12,alignItems:'center',justifyContent:'center',borderWidth:2,borderColor:'#9aa69f',borderRadius:10},themeRadioActive:{borderColor:palette.action},themeRadioDot:{width:9,height:9,borderRadius:5,backgroundColor:palette.action},
  scroll:{padding:16,paddingBottom:35},hero:{padding:24,borderRadius:20,backgroundColor:palette.brand},heroLabel:{color:'#c4d5cd',fontSize:10,fontWeight:'700',letterSpacing:1.3},heroValue:{marginTop:9,color:palette.white,fontSize:30,fontWeight:'800',letterSpacing:-1},heroHint:{marginTop:7,color:palette.accent,fontSize:11},metricGrid:{marginTop:12,flexDirection:'row',flexWrap:'wrap',gap:10},metric:{width:'48.3%',padding:17,borderWidth:1,borderColor:palette.line,borderRadius:15,backgroundColor:palette.white},metricWide:{width:'100%'},metricLabel:{color:palette.secondary,fontSize:11},metricValue:{marginTop:9,color:palette.ink,fontSize:21,fontWeight:'800'},
  upcomingCard:{marginTop:14,padding:16,borderWidth:1,borderColor:'#f1d2b2',borderRadius:17,backgroundColor:'#fff8ef'},upcomingHead:{flexDirection:'row',alignItems:'center',gap:10},upcomingIcon:{width:38,height:38,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:'#ffecd3'},upcomingTitle:{color:palette.ink,fontSize:13,fontWeight:'900'},upcomingCopy:{marginTop:3,color:palette.secondary,fontSize:9},upcomingCount:{minWidth:32,height:32,paddingHorizontal:8,alignItems:'center',justifyContent:'center',borderRadius:16,backgroundColor:palette.warning},upcomingCountText:{color:palette.white,fontSize:12,fontWeight:'900'},upcomingRow:{marginTop:12,paddingTop:11,flexDirection:'row',alignItems:'center',gap:12,borderTopWidth:1,borderTopColor:'#f1d2b2'},upcomingName:{color:palette.ink,fontSize:11,fontWeight:'800'},upcomingPlan:{marginTop:3,color:palette.secondary,fontSize:9},upcomingDate:{color:palette.warning,fontSize:9,fontWeight:'900',textAlign:'right'},upcomingDays:{marginTop:3,color:palette.secondary,fontSize:8,textAlign:'right'},upcomingAction:{marginTop:13,paddingTop:12,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,borderTopWidth:1,borderTopColor:'#f1d2b2'},upcomingActionText:{color:palette.warning,fontSize:10,fontWeight:'900'},upcomingEmpty:{marginTop:13,color:palette.secondary,fontSize:10,textAlign:'center'},
  sectionTitle:{marginTop:26,marginBottom:10},sectionHeading:{fontSize:18,fontWeight:'800',color:palette.ink},sectionCopy:{marginTop:3,color:palette.secondary,fontSize:11},card:{overflow:'hidden',borderWidth:1,borderColor:palette.line,borderRadius:16,backgroundColor:palette.white},paymentRow:{minHeight:65,padding:14,flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderBottomColor:'#edf0ee'},rowMain:{flex:1},rowTitle:{fontSize:13,fontWeight:'700',color:palette.ink},rowSubtitle:{marginTop:4,color:palette.secondary,fontSize:10},income:{color:palette.action,fontSize:12,fontWeight:'800'},empty:{padding:26,textAlign:'center',color:palette.secondary},logoutHint:{marginTop:28,textAlign:'center',color:palette.secondary,fontSize:10},
  paymentFilters:{marginTop:14,padding:15,borderWidth:1,borderColor:palette.line,borderRadius:17,backgroundColor:palette.white},paymentFilterTitle:{color:palette.ink,fontSize:14,fontWeight:'900'},paymentFilterLabel:{marginTop:13,marginBottom:7,color:palette.secondary,fontSize:9,fontWeight:'900',letterSpacing:.7,textTransform:'uppercase'},paymentFilterOptions:{gap:7,paddingRight:5},paymentFilterChip:{height:33,paddingHorizontal:12,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:palette.line,borderRadius:17,backgroundColor:'#fbfcfb'},paymentFilterChipActive:{borderColor:palette.action,backgroundColor:'#e8f5ce'},paymentFilterChipText:{color:palette.secondary,fontSize:9,fontWeight:'800'},paymentFilterChipTextActive:{color:palette.action},paymentFilterFooter:{marginTop:15,paddingTop:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10,borderTopWidth:1,borderTopColor:'#edf0ee'},paymentFilterResult:{flex:1,color:palette.secondary,fontSize:9,lineHeight:13},excelButton:{minWidth:92,height:39,paddingHorizontal:13,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,borderRadius:11,backgroundColor:palette.action},excelButtonText:{color:palette.white,fontSize:10,fontWeight:'900'},paymentList:{gap:12},paymentDetailRow:{padding:16,borderWidth:1,borderColor:palette.line,borderRadius:16,backgroundColor:palette.white,shadowColor:palette.brand,shadowOffset:{width:0,height:3},shadowOpacity:.06,shadowRadius:8,elevation:2},paymentDetailRowPressed:{borderColor:'#b9cfbf',backgroundColor:'#f5f8f6'},paymentDetailHead:{flexDirection:'row',alignItems:'flex-start',gap:10},paymentBadge:{paddingVertical:4,paddingHorizontal:8,borderRadius:10,backgroundColor:'#fff0d8'},paymentBadgeSuccess:{backgroundColor:'#e1f4e8'},paymentBadgeDanger:{backgroundColor:'#fee6e2'},paymentBadgeText:{color:'#996018',fontSize:8,fontWeight:'900'},paymentBadgeTextSuccess:{color:palette.action},paymentBadgeTextDanger:{color:palette.danger},paymentAmounts:{marginTop:14,flexDirection:'row',justifyContent:'space-between'},paymentAmountLabel:{color:palette.secondary,fontSize:8,fontWeight:'800',letterSpacing:.8},paymentAmountRight:{textAlign:'right'},paymentPaid:{marginTop:4,color:palette.action,fontSize:14,fontWeight:'900'},paymentTotal:{marginTop:4,color:palette.ink,fontSize:14,fontWeight:'900',textAlign:'right'},paymentProgress:{height:5,marginTop:12,overflow:'hidden',borderRadius:3,backgroundColor:'#e8ece9'},paymentProgressFill:{height:'100%',borderRadius:3,backgroundColor:palette.action},paymentOperations:{marginTop:13,paddingTop:10,borderTopWidth:1,borderTopColor:'#edf0ee'},paymentOperationsTitle:{marginBottom:3,color:palette.secondary,fontSize:8,fontWeight:'900',letterSpacing:.8},paymentOperation:{paddingVertical:5,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},paymentOperationAmount:{color:palette.action,fontSize:10,fontWeight:'800'},paymentOperationDate:{color:palette.secondary,fontSize:9},paymentNoOperations:{marginTop:11,color:palette.secondary,fontSize:9},paymentBalanceCopy:{marginTop:8,color:palette.warning,fontSize:9,fontWeight:'800'},
  memberSearch:{height:50,marginTop:14,paddingHorizontal:13,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:palette.line,borderRadius:14,backgroundColor:palette.white},memberSearchIcon:{marginRight:9,color:palette.action,fontSize:21},memberSearchInput:{height:'100%',flex:1,color:palette.ink,fontSize:12},memberSearchClear:{width:30,height:30,alignItems:'center',justifyContent:'center',borderRadius:10,backgroundColor:'#eef2ef'},memberSearchClearText:{color:palette.secondary,fontSize:20,lineHeight:22},memberFormPage:{flex:1,backgroundColor:palette.background},memberFormHeader:{paddingHorizontal:16,paddingTop:8,paddingBottom:13,borderBottomWidth:1,borderBottomColor:palette.line,backgroundColor:palette.background},memberFormHeaderRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},memberFormBack:{minWidth:66,flexDirection:'row',alignItems:'center',gap:6},memberFormBackText:{color:palette.ink,fontSize:11,fontWeight:'800'},memberFormStep:{color:palette.secondary,fontSize:8,fontWeight:'900',letterSpacing:.8},memberFormNext:{minWidth:96,height:36,paddingHorizontal:10,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5,borderRadius:11,backgroundColor:palette.action},memberFormNextText:{color:palette.white,fontSize:10,fontWeight:'900'},memberFormProgress:{marginTop:12,marginBottom:13,flexDirection:'row',gap:5},memberFormProgressPart:{height:4,flex:1,borderRadius:2,backgroundColor:'#d9dfdb'},memberFormProgressPartActive:{backgroundColor:palette.action},memberFormTitle:{color:palette.ink,fontSize:22,fontWeight:'900'},memberFormCopy:{marginTop:3,color:palette.secondary,fontSize:10},memberFormScroll:{flex:1},memberFormContent:{padding:16,paddingBottom:32},memberFormFooter:{paddingHorizontal:16,paddingTop:11,paddingBottom:12,borderTopWidth:1,borderTopColor:palette.line,backgroundColor:palette.white},
  memberFilters:{paddingTop:12,flexDirection:'row',flexWrap:'wrap',gap:8},memberFilter:{height:35,paddingHorizontal:11,flexDirection:'row',alignItems:'center',gap:7,borderWidth:1,borderColor:palette.line,borderRadius:18,backgroundColor:palette.white},memberFilterActive:{borderColor:palette.action,backgroundColor:'#eef7e1'},memberFilterText:{color:palette.secondary,fontSize:10,fontWeight:'800'},memberFilterTextActive:{color:palette.action},memberFilterCount:{minWidth:20,height:20,paddingHorizontal:5,alignItems:'center',justifyContent:'center',borderRadius:10,backgroundColor:'#eef2ef'},memberFilterCountActive:{backgroundColor:palette.action},memberFilterCountText:{color:palette.secondary,fontSize:8,fontWeight:'900'},memberFilterCountTextActive:{color:palette.white},memberPlanDotUpcoming:{backgroundColor:palette.warning},memberPlanTextUpcoming:{color:palette.warning,fontWeight:'800'},memberPlanDotExpired:{backgroundColor:palette.warning},memberPlanTextExpired:{color:palette.warning},
  primary:{minHeight:49,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:palette.action},primaryText:{color:palette.white,fontSize:14,fontWeight:'800'},disabled:{opacity:.45},memberRow:{minHeight:80,padding:12,flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderBottomColor:'#edf0ee'},memberRowPressed:{backgroundColor:'#f3f8f4'},memberAvatar:{width:44,height:44,marginRight:11,borderRadius:14,alignItems:'center',justifyContent:'center',backgroundColor:'#e8f5ce'},memberAvatarText:{color:palette.brand,fontSize:12,fontWeight:'900'},memberPlanLine:{marginTop:6,flexDirection:'row',alignItems:'center',gap:5},memberPlanDot:{width:6,height:6,borderRadius:3,backgroundColor:'#c0c7c3'},memberPlanDotActive:{backgroundColor:palette.action},memberPlanText:{color:palette.secondary,fontSize:9},memberChevron:{marginLeft:8,color:palette.secondary,fontSize:28,fontWeight:'300'},memberProfile:{marginBottom:20,padding:16,flexDirection:'row',alignItems:'center',borderRadius:16,backgroundColor:'#f3f7f3'},memberProfileAvatar:{width:52,height:52,marginRight:13,alignItems:'center',justifyContent:'center',borderRadius:17,backgroundColor:palette.accent},memberProfileInitials:{color:palette.brand,fontSize:15,fontWeight:'900'},memberProfileName:{color:palette.ink,fontSize:16,fontWeight:'900'},memberProfileMeta:{marginTop:4,color:palette.secondary,fontSize:10},memberProfilePlan:{marginTop:6,color:palette.action,fontSize:10,fontWeight:'700'},memberProfileExpiry:{marginTop:4,color:palette.secondary,fontSize:9,fontWeight:'700'},memberActionGrid:{gap:10},memberActionCard:{minHeight:76,padding:13,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:palette.line,borderRadius:15,backgroundColor:'#fbfcfb'},memberActionCardPlan:{borderColor:'#dce8ca',backgroundColor:'#fbfdf7'},memberActionCardDelete:{minHeight:64,borderColor:'#f0d8d4',backgroundColor:'#fffafa'},memberActionCardPressed:{opacity:.72,transform:[{scale:.99}]},memberActionIcon:{width:43,height:43,marginRight:12,alignItems:'center',justifyContent:'center',borderRadius:13,backgroundColor:'#e6f1ea'},memberActionIconPlan:{backgroundColor:'#e8f5ce'},memberActionIconDelete:{backgroundColor:'#fee9e5'},memberActionIconText:{color:palette.action,fontSize:19,fontWeight:'900'},memberActionDeleteText:{color:palette.danger},memberActionTitle:{color:palette.ink,fontSize:13,fontWeight:'900'},memberActionCopy:{marginTop:4,color:palette.secondary,fontSize:9,lineHeight:13},memberActionChevron:{marginLeft:8,color:palette.secondary,fontSize:25},planCard:{marginBottom:10,padding:18,flexDirection:'row',justifyContent:'space-between',alignItems:'center',borderWidth:1,borderColor:palette.line,borderRadius:16,backgroundColor:palette.white},planName:{fontSize:15,fontWeight:'800',color:palette.ink},planPrice:{fontSize:15,fontWeight:'800',color:palette.action},debtCard:{position:'relative',overflow:'hidden',padding:22,borderWidth:1,borderColor:'#f1d2b2',borderRadius:22,backgroundColor:'#fff7ed',shadowColor:palette.warning,shadowOffset:{width:0,height:5},shadowOpacity:.1,shadowRadius:12,elevation:3},debtGlowLarge:{position:'absolute',right:-42,top:-58,width:150,height:150,borderRadius:75,backgroundColor:'#e28d3630'},debtGlowSmall:{position:'absolute',right:58,bottom:-37,width:76,height:76,borderRadius:38,backgroundColor:'#c9f47b45'},debtHeader:{flexDirection:'row',alignItems:'center'},debtIcon:{width:42,height:42,marginRight:12,alignItems:'center',justifyContent:'center',borderRadius:13,backgroundColor:palette.brand},debtIconText:{color:palette.accent,fontSize:18,fontWeight:'900'},debtLabel:{color:palette.warning,fontSize:9,fontWeight:'900',letterSpacing:1.2},debtSubtitle:{marginTop:3,color:palette.secondary,fontSize:10},debtValue:{marginTop:18,color:palette.ink,fontSize:32,fontWeight:'900',letterSpacing:-.8},debtFooter:{marginTop:18,paddingTop:13,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderTopWidth:1,borderTopColor:'#f1d2b2'},debtPending:{color:palette.ink,fontSize:10,fontWeight:'800'},debtState:{paddingVertical:5,paddingHorizontal:8,flexDirection:'row',alignItems:'center',gap:5,borderRadius:10,backgroundColor:palette.white},debtStateDot:{width:6,height:6,borderRadius:3,backgroundColor:palette.warning},debtStateText:{color:palette.warning,fontSize:8,fontWeight:'900'},balance:{textAlign:'right',color:palette.ink,fontSize:12,fontWeight:'800'},balanceLabel:{marginTop:3,textAlign:'right',color:palette.secondary,fontSize:9},
  debtCardGreen:{borderColor:'#2d624d',backgroundColor:palette.brand,shadowColor:palette.brand},debtGlowLargeGreen:{backgroundColor:'#2d765855'},debtIconGreen:{backgroundColor:'#ffffff18'},debtLabelGreen:{color:palette.accent},debtSubtitleGreen:{color:'#c4d5cd'},debtValueGreen:{color:palette.white},debtFooterGreen:{borderTopColor:'#ffffff26'},debtPendingGreen:{color:'#e7f0eb'},debtStateGreen:{backgroundColor:'#ffffff14'},debtStateDotGreen:{backgroundColor:palette.accent},debtStateTextGreen:{color:palette.accent},
  modalRoot:{flex:1,justifyContent:'flex-end'},backdrop:{...StyleSheet.absoluteFillObject,backgroundColor:'#13251d99'},sheet:{maxHeight:'82%',paddingHorizontal:22,paddingBottom:32,borderTopLeftRadius:25,borderTopRightRadius:25,backgroundColor:palette.white,shadowColor:'#000',shadowOffset:{width:0,height:-8},shadowOpacity:.16,shadowRadius:20,elevation:18},formSheet:{height:'82%'},sheetHandle:{width:42,height:4,marginTop:9,marginBottom:11,alignSelf:'center',borderRadius:2,backgroundColor:'#d9dfdb'},sheetHead:{marginBottom:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},sheetTitle:{flex:1,fontSize:22,fontWeight:'800',color:palette.ink},closeButton:{width:38,height:38,marginLeft:12,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:'#f1f4f2'},closeButtonPressed:{opacity:.65,transform:[{scale:.94}]},close:{marginTop:-2,fontSize:28,lineHeight:30,color:palette.secondary},sheetFooter:{paddingTop:11,borderTopWidth:1,borderTopColor:palette.line,backgroundColor:palette.white},scrollHint:{height:25,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:4},scrollHintText:{color:palette.secondary,fontSize:10,fontWeight:'700'},field:{marginBottom:14},fieldLabel:{marginBottom:7,color:palette.secondary,fontSize:11,fontWeight:'700'},input:{height:48,paddingHorizontal:14,borderWidth:1,borderColor:palette.line,borderRadius:11,color:palette.ink,backgroundColor:'#fafbf9'},sheetCopy:{marginBottom:18,color:palette.secondary,fontSize:13},bold:{fontWeight:'800',color:palette.ink},choices:{marginBottom:15,gap:8},choice:{padding:13,borderWidth:1,borderColor:palette.line,borderRadius:12},choiceActive:{borderColor:palette.action,backgroundColor:'#eef7e1'},choiceTitle:{fontWeight:'800',color:palette.ink},choicePrice:{marginTop:3,color:palette.secondary,fontSize:11},planRequiredEmpty:{padding:24,alignItems:'center',borderWidth:1,borderColor:'#f1d2b2',borderRadius:16,backgroundColor:'#fff8ef'},planRequiredTitle:{marginTop:10,color:palette.ink,fontSize:14,fontWeight:'900'},planRequiredCopy:{marginTop:6,color:palette.secondary,fontSize:10,lineHeight:15,textAlign:'center'},statusChoices:{marginBottom:18,flexDirection:'row',gap:8},statusChoice:{flex:1,padding:11,alignItems:'center',borderWidth:1,borderColor:palette.line,borderRadius:10},statusChoiceActive:{borderColor:palette.action,backgroundColor:'#eef7e1'},statusChoiceText:{color:palette.secondary,fontSize:11,fontWeight:'700'},statusChoiceTextActive:{color:palette.action},
  planCardPressed:{opacity:.72,transform:[{scale:.99}]},planTitleLine:{flexDirection:'row',alignItems:'center',gap:7},planState:{paddingVertical:3,paddingHorizontal:7,borderRadius:8,backgroundColor:'#fff0d8'},planStateActive:{backgroundColor:'#e1f4e8'},planStateText:{color:palette.warning,fontSize:8,fontWeight:'800'},planStateTextActive:{color:palette.action},planProfile:{marginBottom:20,padding:16,flexDirection:'row',alignItems:'center',borderRadius:16,backgroundColor:'#f6f9f2'},planProfileIcon:{width:52,height:52,marginRight:13,alignItems:'center',justifyContent:'center',borderRadius:17,backgroundColor:'#e8f5ce'},planProfileIconText:{color:palette.action,fontSize:20,fontWeight:'900'},planProfileState:{marginTop:6,color:palette.action,fontSize:10,fontWeight:'700'},planProfileStateInactive:{color:palette.warning},
  issueCard:{marginBottom:10,padding:14,borderWidth:1,borderColor:'#ead7d2',borderRadius:13,backgroundColor:'#fff8f6'},issueTitle:{color:palette.ink,fontSize:13,fontWeight:'800'},issueDate:{marginTop:3,color:palette.secondary,fontSize:9},issueError:{marginTop:9,color:palette.danger,fontSize:11,lineHeight:16},discard:{marginTop:12,color:palette.action,fontSize:11,fontWeight:'800'},
  tabbar:{marginHorizontal:12,marginBottom:8,paddingTop:7,paddingBottom:9,flexDirection:'row',borderWidth:1,borderColor:palette.line,borderRadius:22,backgroundColor:palette.white,shadowColor:palette.brand,shadowOffset:{width:0,height:4},shadowOpacity:.14,shadowRadius:10,elevation:8},tab:{flex:1,alignItems:'center'},tabPressed:{opacity:.65},tabIconWrap:{width:43,height:30,alignItems:'center',justifyContent:'center'},tabIconWrapActive:{overflow:'hidden',borderRadius:15,backgroundColor:'#e8f5ce'},tabLabel:{marginTop:2,color:palette.secondary,fontSize:9,fontWeight:'700'},tabActive:{color:palette.action,fontWeight:'900'},
});

const darkPalette = {
  background:'#101411', surface:'#1a201c', raised:'#212923', border:'#343e38',
  text:'#f2f5f3', secondary:'#adb7b1', action:'#68c59a', actionSoft:'#20382c',
} as const;

const darkStyles = StyleSheet.create({
  app:{backgroundColor:darkPalette.background},
  content:{backgroundColor:darkPalette.background},
  loginCard:{backgroundColor:darkPalette.surface},
  topbar:{backgroundColor:darkPalette.background},
  screenTitle:{color:darkPalette.text},
  kicker:{color:palette.accent},
  syncBar:{backgroundColor:darkPalette.raised},
  syncOffline:{backgroundColor:'#33291e'},
  syncError:{backgroundColor:'#342321'},
  syncTitle:{color:darkPalette.text},
  syncDetail:{color:darkPalette.secondary},
  syncAction:{color:palette.accent},
  syncDotOk:{backgroundColor:darkPalette.action},
  accountHero:{backgroundColor:'#123d2c'},
  subscriptionCard:{borderColor:'#315644',backgroundColor:'#17251d'},
  subscriptionCardExpired:{borderColor:'#5a302d',backgroundColor:'#251817'},
  subscriptionIcon:{backgroundColor:'#20382c'},
  subscriptionIconExpired:{backgroundColor:'#3a211f'},
  subscriptionEyebrow:{color:darkPalette.secondary},
  subscriptionName:{color:darkPalette.action},
  subscriptionNameExpired:{color:'#ef8b82'},
  subscriptionBadge:{backgroundColor:'#183a29'},
  subscriptionBadgeExpired:{backgroundColor:'#40211f'},
  subscriptionBadgeText:{color:darkPalette.action},
  subscriptionBadgeTextExpired:{color:'#ef8b82'},
  subscriptionDates:{borderTopColor:darkPalette.border},
  subscriptionDateLabel:{color:darkPalette.secondary},
  subscriptionDateValue:{color:darkPalette.text},
  subscriptionRemaining:{color:darkPalette.action},
  subscriptionExpiredCopy:{color:'#ef8b82'},
  accountCard:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface},
  accountRow:{borderBottomColor:darkPalette.border},
  accountLabel:{color:darkPalette.secondary},
  accountValue:{color:darkPalette.text},
  logoutButton:{borderColor:'#5a302d',backgroundColor:'#251817'},
  logoutIcon:{backgroundColor:'#3a211f'},
  logoutCopy:{color:'#c1aaa7'},
  accountVersion:{color:darkPalette.secondary},
  themeCard:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface},
  themeTitle:{color:darkPalette.text},
  themeCopy:{color:darkPalette.secondary},
  themeOption:{borderColor:darkPalette.border,backgroundColor:'#151b17'},
  themeOptionActive:{borderColor:darkPalette.action,backgroundColor:darkPalette.actionSoft},
  themeOptionTitle:{color:darkPalette.text},
  themeOptionTitleActive:{color:darkPalette.action},
  themeOptionCopy:{color:darkPalette.secondary},
  themeRadio:{borderColor:'#77827c'},
  themeRadioActive:{borderColor:darkPalette.action},
  themeRadioDot:{backgroundColor:darkPalette.action},
  hero:{backgroundColor:'#123d2c'},
  metric:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface},
  metricLabel:{color:darkPalette.secondary},
  metricValue:{color:darkPalette.text},
  upcomingCard:{borderColor:'#5d4528',backgroundColor:'#2c2419'},
  upcomingIcon:{backgroundColor:'#49351d'},
  upcomingTitle:{color:darkPalette.text},
  upcomingCopy:{color:darkPalette.secondary},
  upcomingRow:{borderTopColor:'#5d4528'},
  upcomingName:{color:darkPalette.text},
  upcomingPlan:{color:darkPalette.secondary},
  upcomingDays:{color:darkPalette.secondary},
  upcomingAction:{borderTopColor:'#5d4528'},
  upcomingEmpty:{color:darkPalette.secondary},
  sectionHeading:{color:darkPalette.text},
  sectionCopy:{color:darkPalette.secondary},
  card:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface},
  paymentRow:{borderBottomColor:darkPalette.border},
  rowTitle:{color:darkPalette.text},
  rowSubtitle:{color:darkPalette.secondary},
  income:{color:darkPalette.action},
  empty:{color:darkPalette.secondary},
  logoutHint:{color:darkPalette.secondary},
  paymentFilters:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface},
  paymentFilterTitle:{color:darkPalette.text},
  paymentFilterLabel:{color:darkPalette.secondary},
  paymentFilterChip:{borderColor:darkPalette.border,backgroundColor:darkPalette.raised},
  paymentFilterChipActive:{borderColor:darkPalette.action,backgroundColor:darkPalette.actionSoft},
  paymentFilterChipText:{color:darkPalette.secondary},
  paymentFilterChipTextActive:{color:darkPalette.action},
  paymentFilterFooter:{borderTopColor:darkPalette.border},
  paymentFilterResult:{color:darkPalette.secondary},
  excelButton:{backgroundColor:darkPalette.action},
  paymentDetailRow:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface,shadowColor:'#000'},
  paymentDetailRowPressed:{borderColor:'#4c7561',backgroundColor:darkPalette.raised},
  paymentBadge:{backgroundColor:'#3a2c19'},
  paymentBadgeSuccess:{backgroundColor:'#183a29'},
  paymentBadgeDanger:{backgroundColor:'#40211f'},
  paymentBadgeText:{color:'#f0b35f'},
  paymentBadgeTextSuccess:{color:darkPalette.action},
  paymentBadgeTextDanger:{color:'#ef8b82'},
  paymentAmountLabel:{color:darkPalette.secondary},
  paymentPaid:{color:darkPalette.action},
  paymentTotal:{color:darkPalette.text},
  paymentProgress:{backgroundColor:darkPalette.border},
  paymentProgressFill:{backgroundColor:darkPalette.action},
  paymentOperations:{borderTopColor:darkPalette.border},
  paymentOperationsTitle:{color:darkPalette.secondary},
  paymentOperationAmount:{color:darkPalette.action},
  paymentOperationDate:{color:darkPalette.secondary},
  paymentNoOperations:{color:darkPalette.secondary},
  paymentBalanceCopy:{color:'#f0b35f'},
  memberSearch:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface},
  memberSearchIcon:{color:darkPalette.action},
  memberSearchInput:{color:darkPalette.text},
  memberSearchClear:{backgroundColor:darkPalette.raised},
  memberSearchClearText:{color:darkPalette.secondary},
  memberFilter:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface},
  memberFilterActive:{borderColor:darkPalette.action,backgroundColor:darkPalette.actionSoft},
  memberFilterText:{color:darkPalette.secondary},
  memberFilterTextActive:{color:darkPalette.action},
  memberFilterCount:{backgroundColor:darkPalette.raised},
  memberFilterCountActive:{backgroundColor:darkPalette.action},
  memberFilterCountText:{color:darkPalette.secondary},
  memberFilterCountTextActive:{color:'#101411'},
  memberPlanDotExpired:{backgroundColor:'#f0b35f'},
  memberPlanTextExpired:{color:'#f0b35f'},
  memberFormPage:{backgroundColor:darkPalette.background},
  memberFormHeader:{borderBottomColor:darkPalette.border,backgroundColor:darkPalette.background},
  memberFormBackText:{color:darkPalette.text},
  memberFormStep:{color:darkPalette.secondary},
  memberFormNext:{backgroundColor:darkPalette.action},
  memberFormProgressPart:{backgroundColor:darkPalette.border},
  memberFormProgressPartActive:{backgroundColor:darkPalette.action},
  memberFormTitle:{color:darkPalette.text},
  memberFormCopy:{color:darkPalette.secondary},
  memberFormFooter:{borderTopColor:darkPalette.border,backgroundColor:darkPalette.surface},
  memberRow:{borderBottomColor:darkPalette.border},
  memberRowPressed:{backgroundColor:darkPalette.raised},
  memberAvatar:{backgroundColor:darkPalette.actionSoft},
  memberAvatarText:{color:palette.accent},
  memberPlanDot:{backgroundColor:'#6f7973'},
  memberPlanDotActive:{backgroundColor:darkPalette.action},
  memberPlanText:{color:darkPalette.secondary},
  memberChevron:{color:darkPalette.secondary},
  memberProfile:{backgroundColor:darkPalette.raised},
  memberProfileName:{color:darkPalette.text},
  memberProfileMeta:{color:darkPalette.secondary},
  memberProfilePlan:{color:darkPalette.action},
  memberProfileExpiry:{color:'#cbd2ce'},
  memberActionCard:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface},
  memberActionCardPlan:{borderColor:'#3d594a',backgroundColor:'#19231d'},
  memberActionCardDelete:{borderColor:'#5a302d',backgroundColor:'#251817'},
  memberActionIcon:{backgroundColor:darkPalette.actionSoft},
  memberActionIconText:{color:darkPalette.action},
  memberActionIconPlan:{backgroundColor:'#2a4127'},
  memberActionIconDelete:{backgroundColor:'#3a211f'},
  memberActionTitle:{color:darkPalette.text},
  memberActionCopy:{color:darkPalette.secondary},
  memberActionChevron:{color:darkPalette.secondary},
  planCard:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface},
  planName:{color:darkPalette.text},
  planPrice:{color:darkPalette.action},
  debtCard:{borderColor:'#2d624d',backgroundColor:palette.brand},
  debtGlowLarge:{backgroundColor:'#2d765855'},
  debtLabel:{color:palette.accent},
  debtSubtitle:{color:'#c4d5cd'},
  debtValue:{color:palette.white},
  debtFooter:{borderTopColor:'#ffffff26'},
  debtPending:{color:'#e7f0eb'},
  debtState:{backgroundColor:'#ffffff14'},
  debtStateDot:{backgroundColor:palette.accent},
  debtStateText:{color:palette.accent},
  sheet:{backgroundColor:darkPalette.surface},
  sheetHandle:{backgroundColor:'#4b5550'},
  sheetTitle:{color:darkPalette.text},
  closeButton:{backgroundColor:darkPalette.raised},
  close:{color:darkPalette.secondary},
  sheetFooter:{borderTopColor:darkPalette.border,backgroundColor:darkPalette.surface},
  scrollHintText:{color:darkPalette.secondary},
  fieldLabel:{color:darkPalette.secondary},
  input:{borderColor:darkPalette.border,color:darkPalette.text,backgroundColor:'#151b17'},
  sheetCopy:{color:darkPalette.secondary},
  bold:{color:darkPalette.text},
  choice:{borderColor:darkPalette.border,backgroundColor:'#151b17'},
  choiceActive:{borderColor:darkPalette.action,backgroundColor:darkPalette.actionSoft},
  choiceTitle:{color:darkPalette.text},
  choicePrice:{color:darkPalette.secondary},
  planRequiredEmpty:{borderColor:'#5d4528',backgroundColor:'#2c2419'},
  planRequiredTitle:{color:darkPalette.text},
  planRequiredCopy:{color:darkPalette.secondary},
  statusChoice:{borderColor:darkPalette.border,backgroundColor:'#151b17'},
  statusChoiceActive:{borderColor:darkPalette.action,backgroundColor:darkPalette.actionSoft},
  statusChoiceText:{color:darkPalette.secondary},
  statusChoiceTextActive:{color:darkPalette.action},
  planState:{backgroundColor:'#3a2c19'},
  planStateActive:{backgroundColor:'#183a29'},
  planStateText:{color:'#f0b35f'},
  planStateTextActive:{color:darkPalette.action},
  planProfile:{backgroundColor:darkPalette.raised},
  planProfileIcon:{backgroundColor:'#2a4127'},
  planProfileIconText:{color:darkPalette.action},
  planProfileState:{color:darkPalette.action},
  planProfileStateInactive:{color:'#f0b35f'},
  issueCard:{borderColor:'#5a302d',backgroundColor:'#251817'},
  issueTitle:{color:darkPalette.text},
  issueDate:{color:darkPalette.secondary},
  issueError:{color:'#ef8b82'},
  discard:{color:darkPalette.action},
  tabbar:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface,shadowColor:'#000'},
  tabIconWrapActive:{backgroundColor:darkPalette.actionSoft},
  tabLabel:{color:darkPalette.secondary},
  tabActive:{color:palette.accent},
});

const styles = new Proxy(baseStyles, {
  get(target, property: string | symbol) {
    const baseStyle = Reflect.get(target, property);
    if (typeof property !== 'string' || !activeDarkTheme) return baseStyle;
    const darkStyle = Reflect.get(darkStyles, property);
    return darkStyle ? [baseStyle, darkStyle] : baseStyle;
  },
}) as typeof baseStyles;
