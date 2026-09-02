import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, BackHandler, Easing, FlatList, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native';
import * as Network from 'expo-network';
import type { NotificationResponse } from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Directory } from 'expo-file-system';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import writeExcelFile, { type SheetData } from 'write-excel-file/universal';
import { api } from './src/api';
import { cancelMembershipNotifications, MEMBERSHIP_NOTIFICATION_SOURCE, supportsMembershipNotifications, syncMembershipNotifications } from './src/notifications';
import { discardSyncIssue, getSyncIssues, getSyncState, initializeOffline, offline, subscribeOffline, syncNow } from './src/offline';
import { getTrustedClockStatus, persistTrustedClock, SUBSCRIPTION_VALIDATION_MESSAGE } from './src/trustedClock';
import { calculateGymStatistics, type StatisticBar } from './src/statistics';
import type { Currency, Dashboard, GymSubscriptionPlan, Member, Membership, MemberSex, Payment, Plan, SyncIssue, SyncState, Tab, User } from './src/types';

let activeCurrency: Currency = 'CUP';
let activeSubscriptionEndsAt = '';
let activeSubscriptionScope = '';
let activeSubscriptionTrialDays = 7;
const renewalMessage = 'Para continuar debes renovar la membresía de tu gimnasio.';
const configuredRenewalWhatsApp = (process.env.EXPO_PUBLIC_RENEWAL_WHATSAPP ?? '').replace(/\D/g,'');
const renewalWhatsApp = configuredRenewalWhatsApp.length === 8 ? `53${configuredRenewalWhatsApp}` : configuredRenewalWhatsApp;
const money = (value: number | string) => `${Number(value).toLocaleString('es-CU', { maximumFractionDigits: 2 })} ${activeCurrency}`;
function contractedPlan(membership: { plan:Plan; planName?:string; planPrice?:string; planDurationDays?:number }): Plan {
  return {
    ...membership.plan,
    name:membership.planName ?? membership.plan.name,
    price:membership.planPrice ?? membership.plan.price,
    durationDays:membership.planDurationDays ?? membership.plan.durationDays,
  };
}
const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const cubanProvinces = ['Pinar del Río','Artemisa','La Habana','Mayabeque','Matanzas','Cienfuegos','Villa Clara','Sancti Spíritus','Ciego de Ávila','Camagüey','Las Tunas','Holguín','Granma','Santiago de Cuba','Guantánamo','Isla de la Juventud'] as const;
type PaymentMonthFilter = 'ALL' | number;
type PaymentYearFilter = 'ALL' | number;

type SubscriptionAccess = 'ACTIVE' | 'EXPIRED' | 'VALIDATION_REQUIRED';
function subscriptionAccess(): { status: SubscriptionAccess; now: number } {
  const clock = getTrustedClockStatus(activeSubscriptionScope);
  if (!clock.allowedOffline) return { status:'VALIDATION_REQUIRED', now:clock.now };
  const endsAt = new Date(activeSubscriptionEndsAt).getTime();
  return { status:!!activeSubscriptionEndsAt && Number.isFinite(endsAt) && endsAt > clock.now ? 'ACTIVE' : 'EXPIRED', now:clock.now };
}
function subscriptionIsActive() { return subscriptionAccess().status === 'ACTIVE'; }
function subscriptionErrorMessage() { return subscriptionAccess().status === 'VALIDATION_REQUIRED' ? SUBSCRIPTION_VALIDATION_MESSAGE : renewalMessage; }
function ensureActiveSubscription() { if (!subscriptionIsActive()) throw new Error(subscriptionErrorMessage()); }
function withActiveSubscription(action: () => void) { if (!subscriptionIsActive()) { showError(new Error(subscriptionErrorMessage())); return; } action(); }
function gymSubscriptionLabel(plan: GymSubscriptionPlan | null, trialDays = activeSubscriptionTrialDays) { return !plan?'Sin membresía':plan==='TRIAL'?`Prueba gratuita · ${trialDays} días`:({MONTHLY:'Mensual',ANNUAL:'Anual'} as Record<Exclude<GymSubscriptionPlan,'TRIAL'>,string>)[plan]; }

function paymentCreatedDate(payment: Payment) {
  const fallback = payment.movements.map(movement => movement.occurredAt).sort()[0];
  const value = payment.createdAt ?? fallback;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function paymentIsDue(payment: Payment, now = Date.now()) {
  if (!payment.dueDate) return true;
  const dueAt = new Date(payment.dueDate).getTime();
  return Number.isNaN(dueAt) || dueAt <= now;
}

function paymentPeriodLabel(month: PaymentMonthFilter, year: PaymentYearFilter) {
  if (month === 'ALL' && year === 'ALL') return 'Todos los períodos';
  if (month === 'ALL') return `Año ${year}`;
  if (year === 'ALL') return monthNames[month];
  return `${monthNames[month]} ${year}`;
}

async function exportPaymentsExcel(payments: Payment[], period: string) {
  if (!payments.length) throw new Error('No hay cobros en el período seleccionado');
  const destination = await Directory.pickDirectoryAsync();
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
    [{value:payments.length,type:Number,align:'center'},null,{value:`=SUMIF(H${firstDataRow}:H${lastDataRow},"<>Cancelado",E${firstDataRow}:E${lastDataRow})`,type:'Formula',format:currencyFormat,fontWeight:'bold'},null,{value:`=SUMIF(H${firstDataRow}:H${lastDataRow},"<>Cancelado",F${firstDataRow}:F${lastDataRow})`,type:'Formula',format:currencyFormat,fontWeight:'bold'},null,{value:`=SUM(G${firstDataRow}:G${lastDataRow})`,type:'Formula',format:currencyFormat,fontWeight:'bold'}],
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
        contractedPlan(payment.membership).name,
        {value:total,type:Number,format:currencyFormat},
        {value:paid,type:Number,format:currencyFormat},
        {value:`=IF(H${row}="Cancelado",0,E${row}-F${row})`,type:'Formula' as const,format:currencyFormat},
        status,
        latestMovement ? {value:new Date(latestMovement.occurredAt),type:Date,format:'yyyy-mm-dd hh:mm'} : '',
      ] as SheetData[number];
    }),
  ];
  // React Native's Blob rejects ArrayBuffer parts. Capture the XLSX bytes before
  // they reach the native Blob implementation and write them directly to disk.
  const blobGlobal = globalThis as unknown as { Blob: typeof Blob };
  const nativeBlob = blobGlobal.Blob;
  class ExcelBytesBlob {
    private readonly bytes: Uint8Array;

    constructor(parts: unknown[] = []) {
      const part = parts[0];
      if (part instanceof ArrayBuffer) {
        this.bytes = new Uint8Array(part);
      } else if (ArrayBuffer.isView(part)) {
        this.bytes = new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
      } else {
        throw new Error('No se pudo generar el archivo Excel');
      }
    }

    async arrayBuffer(): Promise<ArrayBuffer> {
      return new Uint8Array(this.bytes).buffer as ArrayBuffer;
    }
  }
  let bytes: Uint8Array;
  try {
    blobGlobal.Blob = ExcelBytesBlob as unknown as typeof Blob;
    const blob = await writeExcelFile(rows, { sheet:'Cobros', stickyRowsCount:8, showGridLines:false, columns:[{width:13},{width:25},{width:16},{width:22},{width:14},{width:14},{width:14},{width:14},{width:20}] }).toBlob();
    bytes = new Uint8Array(await blob.arrayBuffer());
  } finally {
    blobGlobal.Blob = nativeBlob;
  }
  const safePeriod = period.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase();
  const fileName = `cobros-${safePeriod || 'todos'}.xlsx`;
  const file = destination.createFile(fileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  file.write(bytes);
  showSuccess(`${fileName} se guardó correctamente en la carpeta seleccionada.`);
}
type TabIconName = React.ComponentProps<typeof Ionicons>['name'];
const tabs: { id: Tab; icon: TabIconName; activeIcon: TabIconName; label: string; title?: string }[] = [
  { id:'INICIO', icon:'home-outline', activeIcon:'home', label:'Inicio' },
  { id:'MIEMBROS', icon:'people-outline', activeIcon:'people', label:'Miembros' },
  { id:'PLANES', icon:'pricetags-outline', activeIcon:'pricetags', label:'Planes' },
  { id:'CAJA', icon:'cash-outline', activeIcon:'cash', label:'Caja' },
  { id:'ESTADISTICAS', icon:'stats-chart-outline', activeIcon:'stats-chart', label:'Datos', title:'Estadísticas' },
  { id:'CUENTA', icon:'person-circle-outline', activeIcon:'person-circle', label:'Cuenta' },
];
type ThemePreference = 'system' | 'light' | 'dark';
const THEME_STORAGE_KEY = 'gymflow_mini_theme';
const SHOW_THEME_SELECTOR = false;
const SHOW_SCHEDULED_MEMBERSHIP_UI = false;
const PROFILE_REFRESH_INTERVAL_MS = 30_000;
let activeDarkTheme = false;
const KeyboardScrollContext = createContext<((target: number) => void) | null>(null);
type ToastTone = 'error' | 'success' | 'warning' | 'rejected';
type ToastMessage = { message: string; tone: ToastTone };
type ToastSubscriber = { priority: number; show: (toast: ToastMessage) => void };
const toastSubscribers = new Map<symbol, ToastSubscriber>();
let pendingToast: ToastMessage | null = null;

function publishErrorToast(message: string) {
  publishToast(message, 'error');
}

function publishToast(message: string, tone: ToastTone) {
  const toast = { message, tone };
  const subscribers = [...toastSubscribers.values()].sort((left, right) => right.priority - left.priority);
  const subscriber = tone === 'error' || tone === 'rejected' ? subscribers[0] : subscribers[subscribers.length - 1];
  if (subscriber) subscriber.show(toast);
  else pendingToast = toast;
}

function ToastHost({ active = true, priority = 0 }: { active?: boolean; priority?: number }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!active) return;
    const id = Symbol('toast-host');
    const show = (nextToast: ToastMessage) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setToast(nextToast);
    hideTimer.current = setTimeout(() => setToast(null), nextToast.tone === 'error' || nextToast.tone === 'rejected' ? 4500 : 3200);
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

function LoadingSkeleton({ rows = 5 }: { rows?: number }) {
  const opacity = useRef(new Animated.Value(.35)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue:.8, duration:700, useNativeDriver:true }),
      Animated.timing(opacity, { toValue:.35, duration:700, useNativeDriver:true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return <View accessible accessibilityLabel="Cargando contenido" style={styles.skeletonList}>
    {Array.from({ length:rows }, (_, index) => <Animated.View key={index} style={[styles.skeletonRow, { opacity }]}>
      <View style={styles.skeletonAvatar}/><View style={styles.skeletonBody}><View style={styles.skeletonTitle}/><View style={styles.skeletonCopy}/><View style={styles.skeletonCopyShort}/></View>
    </Animated.View>)}
  </View>;
}

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

function useKeyboardOpen() {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => { showSubscription.remove(); hideSubscription.remove(); };
  }, []);
  return keyboardOpen;
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
  const logout = async () => { if (user?.gymId) await cancelMembershipNotifications(user.gymId).catch(() => undefined); await api.logout(); setUser(null); };
  return <SafeAreaProvider>
    {restoring
      ? <View style={styles.center}><ActivityIndicator color="#c9f47b" size="large" /></View>
      : !user
        ? <Login onLogin={setUser} />
        : !user.gym.subscriptionPlan
          ? <SubscriptionSetup user={user} onUserChange={setUser} onLogout={logout}/>
          : <AdminApp user={user} dark={dark} themePreference={themePreference} onThemeChange={changeTheme} onLogout={logout} />}
    <ToastHost />
  </SafeAreaProvider>;
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [recoveringPassword, setRecoveringPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const loginCardY = useRef(0);
  const revealFocusedInput = useRevealFocusedInput(scrollRef, 24);
  const scrollLoginFormAboveKeyboard = useCallback(() => {
    scrollRef.current?.scrollTo({ y: Math.max(0, loginCardY.current - 12), animated: true });
  }, []);
  const revealLoginInput = useCallback((target: number) => {
    revealFocusedInput(target);
    if (Keyboard.isVisible()) setTimeout(scrollLoginFormAboveKeyboard, 100);
  }, [revealFocusedInput, scrollLoginFormAboveKeyboard]);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const showSubscription = Keyboard.addListener(showEvent, () => setTimeout(scrollLoginFormAboveKeyboard, 80));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => scrollRef.current?.scrollTo({ y: 0, animated: true }));
    return () => { showSubscription.remove(); hideSubscription.remove(); };
  }, [scrollLoginFormAboveKeyboard]);
  const submit = async () => {
    setLoading(true);
    try { onLogin(await api.login(email.trim(), password)); }
    catch (error) { showError(error); }
    finally { setLoading(false); }
  };
  if (creatingAccount) return <Register onRegistered={onLogin} onBack={() => setCreatingAccount(false)}/>;
  if (recoveringPassword) return <PasswordRecovery onBack={() => setRecoveringPassword(false)}/>;
  return <SafeAreaView style={styles.loginPage} edges={['top','right','bottom','left']}>
    <ExpoStatusBar style="light" translucent backgroundColor="transparent" />
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.loginKeyboardAvoiding}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} showsVerticalScrollIndicator={false}>
        <KeyboardScrollContext.Provider value={revealLoginInput}>
        <Text style={styles.loginBrand}>GymFlow <Text style={styles.mini}>MINI</Text></Text>
        <Text style={styles.loginTitle}>Tu gimnasio, bajo control.</Text>
        <Text style={styles.loginCopy}>Miembros, planes y caja en una aplicación simple.</Text>
        <View style={styles.loginCard} onLayout={(event) => { loginCardY.current = event.nativeEvent.layout.y; }}>
          <Field label="Correo" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" returnKeyType="next" />
          <PasswordField value={password} onChangeText={setPassword} visible={passwordVisible} onToggleVisibility={() => setPasswordVisible(value => !value)} onSubmit={() => void submit()} />
          <Pressable accessibilityRole="button" onPress={() => setRecoveringPassword(true)} style={styles.forgotPasswordButton}><Text style={styles.forgotPasswordText}>¿Olvidaste tu contraseña?</Text></Pressable>
          <PrimaryButton label={loading ? 'Entrando…' : 'Entrar'} onPress={submit} disabled={loading || !email.trim() || !password} />
        </View>
        <View style={styles.loginJoin}>
          <Text style={styles.loginJoinText}>¿Eres dueño de un Gimnasio y no tienes una cuenta?</Text>
          <Pressable accessibilityRole="button" onPress={() => setCreatingAccount(true)}>
            <Text style={styles.loginJoinLink}>Crear cuenta</Text>
          </Pressable>
        </View>
        <Text style={styles.version}>V0.1</Text>
        </KeyboardScrollContext.Provider>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function PasswordRecovery({ onBack }: { onBack: () => void }) {
  const [email,setEmail]=useState(''); const [code,setCode]=useState(''); const [password,setPassword]=useState(''); const [confirmation,setConfirmation]=useState(''); const [codeSent,setCodeSent]=useState(false); const [loading,setLoading]=useState(false);
  const scrollRef=useRef<ScrollView>(null); const recoveryCardY=useRef(0); const activeRecoveryTarget=useRef<number|null>(null); const revealFocusedInput=useRevealFocusedInput(scrollRef,28);
  const scrollRecoveryFormAboveKeyboard=useCallback(()=>{
    scrollRef.current?.scrollTo({y:Math.max(0,recoveryCardY.current-12),animated:true});
  },[]);
  const revealRecoveryInput=useCallback((target:number)=>{
    activeRecoveryTarget.current=target;
    revealFocusedInput(target);
    if(Keyboard.isVisible())setTimeout(()=>{scrollRecoveryFormAboveKeyboard();setTimeout(()=>revealFocusedInput(target),80);},100);
  },[revealFocusedInput,scrollRecoveryFormAboveKeyboard]);
  useEffect(()=>{
    const showEvent=Platform.OS==='ios'?'keyboardWillShow':'keyboardDidShow';
    const showSubscription=Keyboard.addListener(showEvent,()=>setTimeout(()=>{scrollRecoveryFormAboveKeyboard();const target=activeRecoveryTarget.current;if(target!==null)setTimeout(()=>revealFocusedInput(target),80);},80));
    const hideSubscription=Keyboard.addListener('keyboardDidHide',()=>scrollRef.current?.scrollTo({y:0,animated:true}));
    return()=>{showSubscription.remove();hideSubscription.remove();};
  },[revealFocusedInput,scrollRecoveryFormAboveKeyboard]);
  useEffect(()=>{if(Platform.OS!=='android')return;const subscription=BackHandler.addEventListener('hardwareBackPress',()=>{Keyboard.dismiss();onBack();return true;});return()=>subscription.remove();},[onBack]);
  const sendCode=async()=>{setLoading(true);try{const result=await api.forgotPassword(email.trim());setCodeSent(true);showSuccess(result.message);}catch(error){showError(error);}finally{setLoading(false);}};
  const reset=async()=>{if(password!==confirmation){showError(new Error('Las contraseñas no coinciden'));return;}setLoading(true);try{const result=await api.resetPassword({email:email.trim(),code,newPassword:password});showSuccess(result.message);onBack();}catch(error){showError(error);}finally{setLoading(false);}};
  return <SafeAreaView style={styles.loginPage} edges={['top','right','bottom','left']}><ExpoStatusBar style="light" translucent backgroundColor="transparent"/><KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={styles.loginKeyboardAvoiding}><ScrollView ref={scrollRef} contentContainerStyle={styles.registerScroll} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} showsVerticalScrollIndicator={false}><KeyboardScrollContext.Provider value={revealRecoveryInput}>
    <Pressable accessibilityRole="button" accessibilityLabel="Volver al inicio de sesión" onPress={onBack} style={styles.authBack}><Ionicons name="arrow-back" size={20} color={palette.white}/><Text style={styles.authBackText}>Volver</Text></Pressable><Text style={styles.loginBrand}>GymFlow <Text style={styles.mini}>MINI</Text></Text><Text style={styles.registerTitle}>Recupera tu acceso</Text><Text style={styles.loginCopy}>{codeSent?'Introduce el código enviado por correo y elige una contraseña nueva.':'Te enviaremos un código al correo asociado con tu cuenta.'}</Text>
    <View style={styles.loginCard} onLayout={event=>{recoveryCardY.current=event.nativeEvent.layout.y;}}><Field label="Correo de la cuenta" value={email} onChangeText={setEmail} editable={!codeSent} keyboardType="email-address" autoCapitalize="none"/>{codeSent?<><Field label="Código de 6 dígitos" value={code} onChangeText={value=>setCode(value.replace(/\D/g,'').slice(0,6))} keyboardType="number-pad" maxLength={6}/><Field label="Nueva contraseña" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none"/><Field label="Confirma la contraseña" value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" returnKeyType="done" onSubmitEditing={()=>void reset()}/><Text style={styles.registrationNote}>El código vence en 15 minutos y admite hasta cinco intentos.</Text><PrimaryButton label={loading?'Actualizando…':'Cambiar contraseña'} onPress={reset} disabled={loading||code.length!==6||password.length<8||!confirmation}/><Pressable disabled={loading} onPress={()=>void sendCode()} style={styles.resendCodeButton}><Text style={styles.forgotPasswordText}>Reenviar código</Text></Pressable></>:<PrimaryButton label={loading?'Enviando…':'Enviar código'} onPress={sendCode} disabled={loading||!email.trim()}/>}</View>
  </KeyboardScrollContext.Provider></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

function Register({ onRegistered, onBack }: { onRegistered: (user: User) => void; onBack: () => void }) {
  const [ownerName,setOwnerName]=useState(''); const [gymName,setGymName]=useState(''); const [province,setProvince]=useState('');
  const [phone,setPhone]=useState(''); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [confirmation,setConfirmation]=useState(''); const [loading,setLoading]=useState(false);
  const [page,setPage]=useState(0); const keyboardOpen=useKeyboardOpen();
  const scrollRef=useRef<ScrollView>(null); const reveal=useRevealFocusedInput(scrollRef,120);
  const pageValid=[!!ownerName.trim()&&/^\d{8}$/.test(phone),!!gymName.trim(),!!email.trim()&&password.length>=8&&!!confirmation][page];
  const pageTitles=['Datos del responsable','Información del gimnasio','Datos de acceso'];
  const submit=async()=>{
    if(password!==confirmation){showError(new Error('Las contraseñas no coinciden'));return;}
    setLoading(true);
    try{onRegistered(await api.register({ownerName:ownerName.trim(),gymName:gymName.trim(),province:province.trim()||undefined,phone:phone.trim(),email:email.trim(),password}));showSuccess('Cuenta creada. Ahora elige cómo comenzar.');}
    catch(error){showError(error);}finally{setLoading(false);}
  };
  const goBack=()=>{Keyboard.dismiss();if(page>0)setPage(value=>value-1);else onBack();};
  const goForward=()=>{Keyboard.dismiss();if(page<2)setPage(value=>value+1);else void submit();};
  useEffect(()=>{if(Platform.OS!=='android')return;const subscription=BackHandler.addEventListener('hardwareBackPress',()=>{goBack();return true;});return()=>subscription.remove();},[page,onBack]);
  return <SafeAreaView style={styles.memberFormPage} edges={['top','right','bottom','left']}><ExpoStatusBar style={activeDarkTheme?'light':'dark'}/><KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={styles.loginKeyboardAvoiding}>
    <View style={styles.memberFormHeader}><View style={styles.memberFormHeaderRow}><Pressable accessibilityRole="button" accessibilityLabel={page>0?'Paso anterior':'Volver al inicio de sesión'} onPress={goBack} style={({pressed})=>[styles.memberFormBack,pressed&&styles.tabPressed]}><Ionicons name="arrow-back" size={19} color={activeDarkTheme?darkPalette.text:palette.ink}/><Text style={styles.memberFormBackText}>{page>0?'Atrás':'Volver'}</Text></Pressable><Text style={styles.memberFormStep}>PASO {page+1} DE 3</Text><Pressable accessibilityRole="button" disabled={!pageValid||loading} onPress={goForward} style={[styles.memberFormNext,(!pageValid||loading)&&styles.disabled]}><Text style={styles.memberFormNextText}>{page===2?(loading?'Creando…':'Crear cuenta'):'Siguiente'}</Text><Ionicons name={page===2?'checkmark':'arrow-forward'} size={16} color={palette.white}/></Pressable></View><View style={styles.memberFormProgress}>{[0,1,2].map(step=><View key={step} style={[styles.memberFormProgressPart,step<=page&&styles.memberFormProgressPartActive]}/>)}</View><Text style={styles.memberFormTitle}>{pageTitles[page]}</Text><Text style={styles.memberFormCopy}>{page===0?'Cuéntanos quién administrará la cuenta.':page===1?'Identifica el gimnasio que vas a gestionar.':'Crea tus credenciales para entrar a GymFlow Mini.'}</Text></View>
    <ScrollView ref={scrollRef} key={page} style={styles.memberFormScroll} contentContainerStyle={[styles.memberFormContent,keyboardOpen&&styles.memberFormContentKeyboard]} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} showsVerticalScrollIndicator={keyboardOpen}><KeyboardScrollContext.Provider value={reveal}>
      {page===0?<><Field label="Tu nombre y apellidos" value={ownerName} onChangeText={setOwnerName} autoCapitalize="words"/><Field label="Teléfono móvil" value={phone} onChangeText={value=>setPhone(value.replace(/\D/g,'').slice(0,8))} keyboardType="number-pad" maxLength={8} placeholder="5XXXXXXX"/><Text style={styles.registrationNote}>Escribe exactamente los 8 dígitos de tu teléfono móvil.</Text></>:null}
      {page===1?<><Field label="Nombre del gimnasio" value={gymName} onChangeText={setGymName} autoCapitalize="words"/><ProvinceField value={province} onChange={setProvince}/></>:null}
      {page===2?<><Field label="Correo" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"/><Field label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none"/><Field label="Repite la contraseña" value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" returnKeyType="done" onSubmitEditing={()=>void submit()}/><Text style={styles.registrationNote}>La contraseña debe tener al menos 8 caracteres. La prueba gratuita es única por teléfono y dispositivo.</Text></>:null}
    </KeyboardScrollContext.Provider></ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}

function SubscriptionSetup({ user, onUserChange, onLogout }: { user: User; onUserChange: (user: User) => void; onLogout: () => void }) {
  const [loading,setLoading]=useState<GymSubscriptionPlan|null>(null); const request=user.subscriptionRequest;
  const openWhatsApp=(current:User)=>{if(!renewalWhatsApp){showError(new Error('Configura el número de WhatsApp de GymFlow Mini.'));return;}const pending=current.subscriptionRequest;if(!pending)return;const plan=pending.plan==='MONTHLY'?'mensual':'anual';const message=`Hola, soy ${current.name}. Solicito el plan ${plan} para ${current.gym.name}. Código ${pending.code}. Teléfono ${current.phone??'no indicado'} y correo ${current.email}.`;void Linking.openURL(`https://wa.me/${renewalWhatsApp}?text=${encodeURIComponent(message)}`).catch(()=>showError(new Error('Comprueba que WhatsApp esté instalado.')));};
  const choose=async(plan:GymSubscriptionPlan)=>{setLoading(plan);try{const updated=await api.selectSubscription(plan);onUserChange(updated);}catch(error){showError(error);}finally{setLoading(null);}};
  const refresh=async()=>{const requestCode=request?.code;setLoading(request?.plan??'MONTHLY');try{const updated=await api.refreshProfile();onUserChange(updated);const resolved=requestCode&&updated.latestSubscriptionRequest?.code===requestCode?updated.latestSubscriptionRequest:null;if(resolved?.status==='REJECTED')showRejected('La solicitud fue rechazada. Revisa el pago o elige otro plan.');else if(resolved?.status==='CANCELLED')showError(new Error('La solicitud fue cancelada o reemplazada. Puedes elegir otro plan.'));else if(updated.subscriptionRequest?.code===requestCode)showPending('La solicitud continúa pendiente.');else if(updated.gym.subscriptionPlan)showSuccess('Tu plan ya está activo.');else showError(new Error('La solicitud ya no está pendiente. Elige un plan para continuar.'));}catch(error){showError(error);}finally{setLoading(null);}};
  return <SafeAreaView style={styles.offerPage} edges={['top','right','bottom','left']}><ExpoStatusBar style="dark"/><ScrollView contentContainerStyle={styles.offerScroll} showsVerticalScrollIndicator={false}><Text style={styles.offerBrand}>GymFlow <Text style={styles.offerMini}>MINI</Text></Text>
    {request?<View style={styles.pendingCard}><View style={styles.pendingIcon}><Ionicons name="time-outline" size={28} color={palette.warning}/></View><Text style={styles.offerEyebrow}>SOLICITUD EN REVISIÓN</Text><Text style={styles.pendingTitle}>Tu cuenta ya está creada</Text><Text style={styles.pendingCopy}>Coordina el pago P2P por WhatsApp. Cuando aprobemos la operación podrás entrar a la plataforma.</Text><View style={styles.requestCode}><Text style={styles.requestCodeLabel}>CÓDIGO DE SOLICITUD</Text><Text selectable style={styles.requestCodeValue}>{request.code}</Text></View><View style={styles.pendingPlan}><Text style={styles.pendingPlanLabel}>Plan solicitado</Text><Text style={styles.pendingPlanValue}>{request.plan==='MONTHLY'?'Mensual · 5 000 CUP':'Anual · 50 000 CUP'}</Text></View><View style={styles.pendingActions}><Pressable accessibilityRole="link" accessibilityLabel="Contactar por WhatsApp" onPress={()=>openWhatsApp(user)} style={styles.offerWhatsapp}><Ionicons name="logo-whatsapp" size={21} color={palette.white}/><Text style={styles.offerWhatsappText}>Contactar por WhatsApp</Text></Pressable><PrimaryButton label={loading?'Comprobando…':'Comprobar activación'} onPress={refresh} disabled={!!loading}/></View><Pressable onPress={()=>onUserChange({...user,subscriptionRequest:null})} style={styles.changePlanButton}><Text style={styles.changePlanText}>Elegir otro plan</Text></Pressable></View>
    :<><Text style={styles.offerEyebrow}>ELIGE CÓMO COMENZAR</Text><Text style={styles.offerTitle}>Tu gimnasio ya tiene una cuenta.</Text><Text style={styles.offerCopy}>Prueba todas las funciones o solicita un plan. Tus datos permanecerán guardados.</Text><View style={styles.offerList}><OfferCard title="Prueba gratuita" price="0 CUP" detail="7 días · acceso completo" icon="gift-outline" loading={loading==='TRIAL'} disabled={!!loading} onPress={()=>void choose('TRIAL')}/><OfferCard title="Plan mensual" price="5 000 CUP" detail="1 mes · pago P2P" icon="calendar-outline" featured loading={loading==='MONTHLY'} disabled={!!loading} onPress={()=>void choose('MONTHLY')}/><OfferCard title="Plan anual" price="50 000 CUP" detail="1 año · ahorra 10 000 CUP" icon="trophy-outline" loading={loading==='ANNUAL'} disabled={!!loading} onPress={()=>void choose('ANNUAL')}/></View><View style={styles.trialProtection}><Ionicons name="shield-checkmark-outline" size={15} color={palette.secondary}/><Text style={styles.trialProtectionText}>La prueba se concede una sola vez por teléfono y dispositivo.</Text></View></>}
    <Pressable onPress={onLogout} style={styles.offerLogout}><Text style={styles.offerLogoutText}>Cerrar sesión</Text></Pressable></ScrollView></SafeAreaView>;
}

function OfferCard({title,price,detail,icon,featured,loading,disabled,onPress}:{title:string;price:string;detail:string;icon:React.ComponentProps<typeof Ionicons>['name'];featured?:boolean;loading:boolean;disabled:boolean;onPress:()=>void}){return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={({pressed})=>[styles.offerCard,featured&&styles.offerCardFeatured,pressed&&styles.tabPressed,disabled&&styles.offerCardDisabled]}><View style={[styles.offerIcon,featured&&styles.offerIconFeatured]}><Ionicons name={icon} size={23} color={featured?palette.white:palette.action}/></View><View style={styles.rowMain}><Text style={styles.offerCardTitle}>{title}</Text><Text style={styles.offerCardDetail}>{detail}</Text></View><View style={styles.offerPriceWrap}><Text style={styles.offerPrice}>{price}</Text>{loading?<ActivityIndicator color={palette.action}/>:<Ionicons name="arrow-forward-circle" size={23} color={palette.action}/>}</View></Pressable>}

function AdminApp({ user, dark, themePreference, onThemeChange, onLogout }: { user: User; dark: boolean; themePreference: ThemePreference; onThemeChange: (theme: ThemePreference) => void; onLogout: () => void }) {
  const [currentUser, setCurrentUser] = useState(user);
  const [tab, setTab] = useState<Tab>('INICIO');
  const [accountPasswordOpen, setAccountPasswordOpen] = useState(false);
  const keyboardOpen = useKeyboardOpen();
  const [memberEntryFilter, setMemberEntryFilter] = useState<MemberFilter>('ALL');
  const [ready, setReady] = useState(false); const [revision, setRevision] = useState(0); const [issuesOpen, setIssuesOpen] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>({ phase: 'STARTING', pending: 0, rejected: 0 });
  const lastSyncErrorToast = useRef('');
  const profileRefreshInFlight = useRef(false);
  const scope = currentUser.gymId;
  activeSubscriptionScope = scope;
  activeCurrency = currentUser.gym.currency;
  activeSubscriptionEndsAt = currentUser.gym.subscriptionEndsAt ?? '';
  activeSubscriptionTrialDays = currentUser.gym.subscriptionTrialDays ?? 7;
  const refreshProfile = useCallback(async () => {
    if (profileRefreshInFlight.current) return;
    profileRefreshInFlight.current = true;
    try {
      const network = await Network.getNetworkStateAsync().catch(() => null);
      if (network?.isConnected === false) return;
      setCurrentUser(await api.restore());
    } catch {
      // El perfil almacenado sigue disponible mientras el dispositivo está sin conexión.
    } finally {
      profileRefreshInFlight.current = false;
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeOffline(() => { if (mounted) { setRevision((value) => value + 1); setSyncState(getSyncState(scope)); } });
    void initializeOffline(scope).then(() => syncNow(scope)).catch(showError).finally(() => { if (mounted) { setReady(true); setSyncState(getSyncState(scope)); } });
    const networkSubscription = Network.addNetworkStateListener((state) => { if (state.isConnected !== false) { void refreshProfile(); void syncNow(scope); } });
    const appSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') { void refreshProfile(); void syncNow(scope); }
      else void persistTrustedClock(scope).catch(() => undefined);
    });
    const profileInterval = setInterval(() => { if (AppState.currentState === 'active') void refreshProfile(); }, PROFILE_REFRESH_INTERVAL_MS);
    const clockInterval = setInterval(() => {
      if (AppState.currentState === 'active') void persistTrustedClock(scope).then(() => { if (mounted) setRevision(value => value + 1); }).catch(() => undefined);
    }, 60_000);
    return () => { mounted = false; void persistTrustedClock(scope).catch(() => undefined); unsubscribe(); networkSubscription.remove(); appSubscription.remove(); clearInterval(profileInterval); clearInterval(clockInterval); };
  }, [scope,refreshProfile]);
  useEffect(() => {
    if (!ready) return;
    void offline.members(scope).then(members => syncMembershipNotifications(scope, members)).catch(showError);
  }, [ready, revision, scope]);
  useEffect(() => {
    if (!supportsMembershipNotifications()) return;
    let mounted = true;
    let removeListener: (() => void) | undefined;
    const openMembershipNotification = (response: NotificationResponse) => {
      const data = response.notification.request.content.data;
      if (data?.source !== MEMBERSHIP_NOTIFICATION_SOURCE || data.scope !== scope) return;
      setMemberEntryFilter(data.stage === 'expired' ? 'EXPIRED' : 'UPCOMING');
      setTab('MIEMBROS');
    };
    void import('expo-notifications').then(Notifications => {
      if (!mounted) return;
      const subscription = Notifications.addNotificationResponseReceivedListener(openMembershipNotification);
      removeListener = () => subscription.remove();
      return Notifications.getLastNotificationResponseAsync().then(response => {
        if (!response) return;
        openMembershipNotification(response);
        return Notifications.clearLastNotificationResponseAsync();
      });
    }).catch(showError);
    return () => { mounted = false; removeListener?.(); };
  }, [scope]);
  useEffect(() => {
    const signature = `${syncState.phase}:${syncState.message ?? ''}:${syncState.rejected}`;
    if (syncState.phase !== 'ERROR' && syncState.rejected === 0) { lastSyncErrorToast.current = ''; return; }
    if (lastSyncErrorToast.current === signature) return;
    lastSyncErrorToast.current = signature;
    if (syncState.message) { showError(new Error(syncState.message)); return; }
    void getSyncIssues(scope).then((issues) => {
      const latestIssue = [...issues].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0];
      showError(new Error(latestIssue?.error ?? `El servidor rechazó ${syncState.rejected} cambio${syncState.rejected === 1 ? '' : 's'}.`));
    }).catch(showError);
  }, [scope, syncState.phase, syncState.message, syncState.rejected]);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (issuesOpen) { setIssuesOpen(false); return true; }
      if (accountPasswordOpen) { Keyboard.dismiss(); setAccountPasswordOpen(false); return true; }
      if (tab !== 'INICIO') { setTab('INICIO'); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [issuesOpen, accountPasswordOpen, tab]);
  if (!ready) return <View style={styles.center}><ActivityIndicator color="#c9f47b" size="large" /></View>;
  const nestedAccountPage = tab === 'CUENTA' && accountPasswordOpen;
  return <SafeAreaView style={styles.app} edges={['top','right','bottom','left']}><StatusBar translucent backgroundColor="transparent" barStyle={dark ? "light-content" : "dark-content"} />
    {!nestedAccountPage ? <View style={styles.topbar}>
      <View style={styles.topbarTitle}><Text numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.3} style={styles.kicker}>{currentUser.gym.name.toUpperCase()}</Text><Text maxFontSizeMultiplier={1.3} style={styles.screenTitle}>{tabs.find((item) => item.id === tab)?.title ?? tabs.find((item) => item.id === tab)?.label}</Text></View>
    </View> : null}
    {!nestedAccountPage && (!keyboardOpen || (tab !== 'MIEMBROS' && tab !== 'PLANES')) && <SyncBar state={syncState} onPress={() => { void refreshProfile(); syncState.rejected > 0 ? setIssuesOpen(true) : void syncNow(scope); }} />}
    <View style={styles.content}>
      {tab === 'INICIO' && <DashboardScreen scope={scope} revision={revision} onOpenUpcoming={() => { setMemberEntryFilter('UPCOMING'); setTab('MIEMBROS'); }} />}
      {tab === 'MIEMBROS' && <MembersScreen scope={scope} revision={revision} initialFilter={memberEntryFilter} />}
      {tab === 'PLANES' && <PlansScreen scope={scope} revision={revision} />}
      {tab === 'CAJA' && <PaymentsScreen scope={scope} revision={revision} />}
      {tab === 'ESTADISTICAS' && <StatisticsScreen scope={scope} revision={revision} />}
      {tab === 'CUENTA' && <AccountScreen user={currentUser} onUserChange={setCurrentUser} themePreference={themePreference} onThemeChange={onThemeChange} onLogout={onLogout} passwordOpen={accountPasswordOpen} onPasswordOpenChange={setAccountPasswordOpen} />}
    </View>
    {!nestedAccountPage ? <View style={styles.tabbar}>{tabs.map((item) => { const active=tab===item.id; return <Pressable accessibilityRole="tab" accessibilityState={{selected:active}} accessibilityLabel={item.label} key={item.id} onPress={() => { if (item.id === 'MIEMBROS') setMemberEntryFilter('ALL'); setTab(item.id); }} style={({pressed}) => [styles.tab,pressed&&styles.tabPressed]}><View style={[styles.tabIconWrap,active&&styles.tabIconWrapActive]}><Ionicons name={active?item.activeIcon:item.icon} size={21} color={active?(activeDarkTheme?'#c9f47b':'#1d6b4d'):(activeDarkTheme?'#adb7b1':'#657169')}/></View><Text style={[styles.tabLabel,active&&styles.tabActive]}>{item.label}</Text></Pressable>;})}</View> : null}
    <SyncIssues open={issuesOpen} scope={scope} revision={revision} onClose={() => setIssuesOpen(false)} />
  </SafeAreaView>;
}

type ScreenProps = { scope: string; revision: number };
type MemberFilter = 'ALL' | 'ACTIVE' | 'INACTIVE' | 'UPCOMING' | 'EXPIRED';
type PlanFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

function DashboardScreen({ scope, revision, onOpenUpcoming }: ScreenProps & { onOpenUpcoming: () => void }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const monthName = new Intl.DateTimeFormat('es-CU', { month: 'long' }).format(new Date()).toLocaleUpperCase('es-CU');
  const load = useCallback(() => { setLoading(true); Promise.all([offline.dashboard(scope),offline.members(scope)]).then(([dashboard,nextMembers]) => { setData(dashboard); setMembers(nextMembers); }).catch(showError).finally(() => setLoading(false)); }, [scope]);
  const refresh = useCallback(() => { setLoading(true); syncNow(scope).then(load).catch(showError).finally(() => setLoading(false)); }, [scope,load]);
  useEffect(load, [load, revision]);
  const upcoming = members.map(member => ({member,membership:upcomingMembership(member)})).filter((entry): entry is {member:Member;membership:Membership} => !!entry.membership).sort((a,b) => a.membership.endDate.localeCompare(b.membership.endDate));
  if (loading && !data) return <ScrollView contentContainerStyle={styles.scroll}><LoadingSkeleton rows={6}/></ScrollView>;
  return <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} colors={[activeDarkTheme ? '#c9f47b' : '#1d6b4d']} tintColor={activeDarkTheme ? '#c9f47b' : '#1d6b4d'} progressBackgroundColor={activeDarkTheme ? '#212923' : '#fff'} />} contentContainerStyle={styles.scroll}>
    <View style={styles.hero}><Text style={styles.heroLabel}>INGRESOS DE {monthName}</Text><Text style={styles.heroValue}>{money(data?.monthlyRevenue ?? 0)}</Text><Text style={styles.heroHint}>Dinero realmente cobrado</Text></View>
    <View style={styles.metricGrid}><Metric label="Miembros" value={data?.members ?? 0} /><Metric label="Membresías activas" value={data?.activeMemberships ?? 0} /><Metric label="Por cobrar" value={money(data?.pendingDebt ?? 0)} wide /></View>
    <View style={styles.upcomingCard}><View style={styles.upcomingHead}><View style={styles.upcomingIcon}><Ionicons name="time-outline" size={20} color={palette.warning}/></View><View style={styles.rowMain}><Text style={styles.upcomingTitle}>Membresías próximas a vencer</Text><Text style={styles.upcomingCopy}>En los próximos 10 días</Text></View><View style={styles.upcomingCount}><Text style={styles.upcomingCountText}>{upcoming.length}</Text></View></View>{upcoming.slice(0,4).map(({member,membership}) => <View key={membership.id} style={styles.upcomingRow}><View style={styles.rowMain}><Text numberOfLines={1} ellipsizeMode="tail" style={styles.upcomingName}>{member.firstName} {member.lastName}</Text><Text numberOfLines={1} ellipsizeMode="tail" style={styles.upcomingPlan}>{contractedPlan(membership).name}</Text></View><View><Text style={styles.upcomingDate}>{formatDate(membership.endDate)}</Text><Text style={styles.upcomingDays}>{remainingDaysLabel(membership.endDate)}</Text></View></View>)}{upcoming.length ? <Pressable accessibilityRole="button" onPress={onOpenUpcoming} style={({pressed}) => [styles.upcomingAction,styles.minTouch,pressed&&styles.tabPressed]}><Text style={styles.upcomingActionText}>Ver y gestionar en Miembros</Text><Ionicons name="arrow-forward" size={17} color={palette.warning}/></Pressable> : <Text style={styles.upcomingEmpty}>No hay vencimientos cercanos.</Text>}</View>
    <SectionTitle title="Últimos cobros" subtitle="Movimientos registrados por el gimnasio" />
    <View style={styles.card}>{data?.recentPayments.length ? data.recentPayments.map((movement) => <Row key={movement.id} title={`${movement.payment?.member.firstName} ${movement.payment?.member.lastName}`} subtitle={new Date(movement.occurredAt).toLocaleDateString('es-CU')} value={`+ ${money(movement.amount)}`} />) : <Empty text="Aún no hay cobros este mes" />}</View>
  </ScrollView>;
}

type StatisticsPage = 'GROWTH' | 'PLANS' | 'CLIENTS';

function StatisticsScreen({ scope, revision }: ScreenProps) {
  const [page, setPage] = useState<StatisticsPage>('GROWTH');
  const [members, setMembers] = useState<Member[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => { setLoading(true); Promise.all([offline.members(scope),offline.payments(scope)]).then(([nextMembers,nextPayments]) => { setMembers(nextMembers); setPayments(nextPayments); }).catch(showError).finally(() => setLoading(false)); }, [scope]);
  const refresh = useCallback(() => { setLoading(true); syncNow(scope).then(load).catch(showError).finally(() => setLoading(false)); }, [scope,load]);
  useEffect(load, [load,revision]);
  const statistics = calculateGymStatistics(members,payments);
  const variation = statistics.growth.variation;
  const variationLabel = variation === null ? 'Sin base anterior' : `${variation >= 0 ? '+' : ''}${variation.toLocaleString('es-CU',{maximumFractionDigits:1})} %`;
  if (loading && !members.length && !payments.length) return <ScrollView contentContainerStyle={styles.scroll}><LoadingSkeleton rows={6}/></ScrollView>;
  return <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} colors={[activeDarkTheme ? '#c9f47b' : '#1d6b4d']} tintColor={activeDarkTheme ? '#c9f47b' : '#1d6b4d'} progressBackgroundColor={activeDarkTheme ? '#212923' : '#fff'} />} contentContainerStyle={styles.scroll}>
    <View accessibilityRole="tablist" style={styles.statisticsTabs}>{([
      ['GROWTH','Crecimiento','trending-up-outline'],['PLANS','Planes','pricetag-outline'],['CLIENTS','Clientes','people-outline'],
    ] as const).map(([id,label,icon]) => <Pressable accessibilityRole="tab" accessibilityState={{selected:page===id}} key={id} onPress={() => setPage(id)} style={({pressed}) => [styles.statisticsTab,page===id&&styles.statisticsTabActive,pressed&&styles.tabPressed]}><Ionicons name={icon} size={17} color={page===id?(activeDarkTheme?palette.accent:palette.action):(activeDarkTheme?darkPalette.secondary:palette.secondary)}/><Text style={[styles.statisticsTabText,page===id&&styles.statisticsTabTextActive]}>{label}</Text></Pressable>)}</View>
    {page === 'GROWTH' ? <>
      <View style={styles.statisticsHero}><View style={styles.rowMain}><Text style={styles.statisticsEyebrow}>NUEVOS ESTE MES</Text><Text style={styles.statisticsHeroValue}>{statistics.growth.currentMonth}</Text><Text style={styles.statisticsHeroCopy}>Mes anterior: {statistics.growth.previousMonth}</Text></View><View style={[styles.variationBadge,variation !== null && variation < 0 && styles.variationBadgeDown]}><Ionicons name={variation !== null && variation < 0 ? 'trending-down' : 'trending-up'} size={17} color={variation !== null && variation < 0 ? palette.danger : palette.action}/><Text style={[styles.variationText,variation !== null && variation < 0 && styles.variationTextDown]}>{variationLabel}</Text></View></View>
      <View style={styles.metricGrid}><Metric label="Miembros activos" value={statistics.growth.activeMembers}/><Metric label="Miembros inactivos" value={statistics.growth.inactiveMembers}/><Metric label="Membresías vigentes" value={statistics.growth.validMemberships} wide/></View>
      <SectionTitle title="Evolución mensual" subtitle="Altas registradas durante los últimos 6 meses"/>
      <View style={styles.statisticsCard}><HorizontalBars rows={statistics.growth.monthly}/></View>
      {members.some(member => !member.joinedAt) ? <View style={styles.statisticsNotice}><Ionicons name="information-circle-outline" size={19} color={palette.warning}/><Text style={styles.statisticsNoticeText}>Algunas altas locales antiguas no tienen fecha disponible y no aparecen en la evolución.</Text></View> : null}
      <SectionTitle title="Estado de la base" subtitle="Miembro activo y membresía vigente son indicadores distintos"/>
      <View style={styles.statusComparison}><StatusRatio label="Estado del miembro" firstLabel="Activos" first={statistics.growth.activeMembers} secondLabel="Inactivos" second={statistics.growth.inactiveMembers}/><StatusRatio label="Cobertura actual" firstLabel="Con membresía vigente" first={statistics.growth.validMemberships} secondLabel="Sin membresía vigente" second={Math.max(0,members.length-statistics.growth.validMemberships)}/></View>
    </> : null}
    {page === 'PLANS' ? <>
      <View style={styles.metricGrid}><Metric label="Plan más contratado" value={statistics.plans[0]?.name ?? '—'} wide/><Metric label="Membresías históricas" value={statistics.plans.reduce((sum,plan) => sum + plan.contracted,0)}/><Metric label="Ingresos cobrados" value={money(statistics.plans.reduce((sum,plan) => sum + plan.revenue,0))}/></View>
      <SectionTitle title="Rendimiento por plan" subtitle="Contrataciones, vigentes e ingresos realmente cobrados"/>
      {statistics.plans.length ? statistics.plans.map((plan,index) => <View key={plan.id} style={styles.planStatisticCard}><View style={styles.planStatisticHead}><View style={styles.planRank}><Text style={styles.planRankText}>{index+1}</Text></View><View style={styles.rowMain}><Text style={styles.planStatisticName}>{plan.name}</Text><Text style={styles.planStatisticRevenue}>{money(plan.revenue)} cobrados</Text></View></View><View style={styles.planStatisticGrid}><StatisticValue label="CONTRATADAS" value={plan.contracted}/><StatisticValue label="VIGENTES" value={plan.active}/><StatisticValue label="PRECIO PROMEDIO" value={money(plan.averagePrice)}/></View></View>) : <View style={styles.card}><Empty text="Aún no hay membresías para analizar"/></View>}
      <View style={styles.statisticsNotice}><Ionicons name="shield-checkmark-outline" size={19} color={palette.action}/><Text style={styles.statisticsNoticeText}>Los ingresos usan únicamente abonos registrados. El precio promedio usa el precio guardado al contratar.</Text></View>
    </> : null}
    {page === 'CLIENTS' ? <>
      <SectionTitle title="Distribución por edad" subtitle={`${statistics.clients.withoutAge} miembro${statistics.clients.withoutAge===1?'':'s'} sin edad registrada`}/>
      <View style={styles.statisticsCard}><HorizontalBars rows={statistics.clients.ages}/></View>
      <SectionTitle title="Distribución por sexo" subtitle="Incluye los perfiles sin información especificada"/>
      <View style={styles.statisticsCard}><HorizontalBars rows={statistics.clients.sexes}/></View>
      <SectionTitle title="Mayor historial de pagos" subtitle="Total de todos los abonos registrados por miembro"/>
      <View style={styles.card}>{statistics.clients.topPayments.length ? statistics.clients.topPayments.map(client => <Row key={client.id} title={client.name} subtitle={`${client.operations} abono${client.operations===1?'':'s'} registrado${client.operations===1?'':'s'}`} value={money(client.amount)}/>) : <Empty text="Aún no hay abonos registrados"/>}</View>
      <SectionTitle title="Miembros con deudas" subtitle={`${statistics.clients.debts.length} miembro${statistics.clients.debts.length===1?'':'s'} · ${money(statistics.clients.totalDebt)} pendientes`}/>
      <View style={styles.card}>{statistics.clients.debts.length ? statistics.clients.debts.map(client => <View key={client.id} style={styles.paymentRow}><View style={styles.rowMain}><Text style={styles.rowTitle}>{client.name}</Text><Text style={[styles.rowSubtitle,client.overdue&&styles.debtOverdue]}>{client.payments} cobro{client.payments===1?'':'s'} pendiente{client.payments===1?'':'s'}{client.overdue?' · Hay deuda vencida':''}</Text></View><Text style={styles.debtAmount}>{money(client.amount)}</Text></View>) : <Empty text="No hay saldos pendientes"/>}</View>
      <View style={styles.statisticsNotice}><Ionicons name="information-circle-outline" size={19} color={palette.warning}/><Text style={styles.statisticsNoticeText}>La edad guardada no se actualiza automáticamente. Las cifras financieras dependen de que todos los cobros se registren.</Text></View>
    </> : null}
  </ScrollView>;
}

function HorizontalBars({ rows }: { rows: StatisticBar[] }) {
  const maximum = Math.max(1,...rows.map(row => row.value));
  return <View style={styles.barList}>{rows.map(row => <View key={row.id} style={styles.barRow}><View style={styles.barLabels}><Text style={styles.barLabel}>{row.label}</Text><Text style={styles.barValue}>{row.value}</Text></View><View style={styles.barTrack}><View style={[styles.barFill,{width:`${Math.max(2,row.value/maximum*100)}%` as `${number}%`}]}/></View></View>)}</View>;
}

function StatusRatio({ label, firstLabel, first, secondLabel, second }: { label:string; firstLabel:string; first:number; secondLabel:string; second:number }) {
  const total = Math.max(1,first+second); const percentage = first/total*100;
  return <View style={styles.statusRatio}><Text style={styles.statusRatioTitle}>{label}</Text><View style={styles.ratioTrack}><View style={[styles.ratioFill,{width:`${percentage}%` as `${number}%`}]}/></View><View style={styles.ratioLegend}><Text style={styles.ratioPrimary}>{firstLabel} {first}</Text><Text style={styles.ratioSecondary}>{secondLabel} {second}</Text></View></View>;
}

function StatisticValue({ label, value }: { label:string; value:string|number }) { return <View style={styles.statisticValue}><Text style={styles.statisticValueLabel}>{label}</Text><Text numberOfLines={1} adjustsFontSizeToFit style={styles.statisticValueNumber}>{value}</Text></View>; }

function AccountScreen({ user, onUserChange, themePreference, onThemeChange, onLogout, passwordOpen, onPasswordOpenChange }: { user: User; onUserChange: (user: User) => void; themePreference: ThemePreference; onThemeChange: (theme: ThemePreference) => void; onLogout: () => void; passwordOpen: boolean; onPasswordOpenChange: (open: boolean) => void }) {
  const [requestingPlan,setRequestingPlan]=useState<GymSubscriptionPlan|null>(null);
  const [changingRequest,setChangingRequest]=useState(false);
  const [currentPassword,setCurrentPassword]=useState(''); const [newPassword,setNewPassword]=useState(''); const [passwordConfirmation,setPasswordConfirmation]=useState(''); const [savingPassword,setSavingPassword]=useState(false);
  const passwordScrollRef=useRef<ScrollView>(null); const revealPasswordField=useRevealFocusedInput(passwordScrollRef,120); const keyboardOpen=useKeyboardOpen();
  const confirmLogout = () => Alert.alert('Cerrar sesión', '¿Deseas salir de GymFlow Mini en este dispositivo?', [{ text:'Cancelar', style:'cancel' }, { text:'Cerrar sesión', style:'destructive', onPress:onLogout }]);
  const plan = user.gym.subscriptionPlan;
  const access = subscriptionAccess();
  const verificationRequired = access.status === 'VALIDATION_REQUIRED';
  const expired = access.status === 'EXPIRED';
  const remaining = Math.max(0,Math.ceil((new Date(user.gym.subscriptionEndsAt ?? 0).getTime()-access.now)/86_400_000));
  const openWhatsApp = (message:string) => { if(!renewalWhatsApp){showError(new Error('Configura el número de renovación de GymFlow Mini.'));return;} const url=`https://wa.me/${renewalWhatsApp}?text=${encodeURIComponent(message)}`; void Linking.openURL(url).catch(() => showError(new Error('Comprueba que WhatsApp esté instalado.'))); };
  const expiry = formatDate(user.gym.subscriptionEndsAt);
  const actions: Array<{label:string;plan:Exclude<GymSubscriptionPlan,'TRIAL'>}> = plan==='TRIAL'
    ? [
        { label:'Adquirir plan mensual', plan:'MONTHLY' },
        { label:'Adquirir plan anual', plan:'ANNUAL' },
      ]
    : plan==='MONTHLY'
      ? [
          { label:'Renovar plan mensual', plan:'MONTHLY' },
          { label:'Cambiar a plan anual', plan:'ANNUAL' },
        ]
      : [
          { label:'Renovar plan anual', plan:'ANNUAL' },
          { label:'Cambiar a plan mensual', plan:'MONTHLY' },
        ];
  const requestWhatsAppMessage=(current:User)=>{const request=current.subscriptionRequest;if(!request)return'';const requestedPlan=request.plan==='MONTHLY'?'mensual':'anual';return `Hola, soy ${current.name}. Quiero gestionar el plan ${requestedPlan} para ${current.gym.name}. Código de solicitud: ${request.code}. Teléfono: ${current.phone??'no indicado'}. Correo: ${current.email}.`;};
  const runSubscriptionAction=async(action:(typeof actions)[number])=>{setRequestingPlan(action.plan);try{const updated=await api.selectSubscription(action.plan);onUserChange(updated);setChangingRequest(false);}catch(error){showError(error);}finally{setRequestingPlan(null);}};
  const refreshRequest=async()=>{const requestCode=user.subscriptionRequest?.code;setRequestingPlan(user.subscriptionRequest?.plan??'MONTHLY');try{const updated=await api.refreshProfile();onUserChange(updated);setChangingRequest(false);const resolved=requestCode&&updated.latestSubscriptionRequest?.code===requestCode?updated.latestSubscriptionRequest:null;if(resolved?.status==='REJECTED')showRejected('La solicitud fue rechazada. Tu plan anterior no sufrió cambios.');else if(resolved?.status==='CANCELLED')showError(new Error('La solicitud fue cancelada o reemplazada.'));else if(updated.subscriptionRequest?.code===requestCode)showPending('La solicitud continúa pendiente.');else if(resolved?.status==='APPROVED')showSuccess('La operación fue aprobada y tu plan está actualizado.');else showError(new Error('La solicitud ya no está pendiente. Actualiza o crea una nueva solicitud.'));}catch(error){showError(error);}finally{setRequestingPlan(null);}};
  const status = verificationRequired ? 'Verificar' : !plan ? 'Sin plan' : expired ? 'Vencida' : 'Activa';
  const actionCopy = user.subscriptionRequest&&!changingRequest ? 'Tu solicitud está pendiente. El plan actual seguirá disponible hasta su vencimiento.' : verificationRequired ? SUBSCRIPTION_VALIDATION_MESSAGE : !plan ? 'Activa una membresía para habilitar nuevamente todas las operaciones.' : expired ? renewalMessage : plan==='TRIAL' ? 'Tu prueba está activa. Puedes adquirir un plan sin perder los días restantes.' : 'Puedes renovar el plan actual o solicitar un cambio para el próximo período.';
  const closePasswordPage=()=>{Keyboard.dismiss();onPasswordOpenChange(false);};
  const savePassword=async()=>{if(newPassword!==passwordConfirmation){showError(new Error('Las contraseñas no coinciden'));return;}setSavingPassword(true);try{const updated=await api.changePassword({currentPassword,newPassword});onUserChange(updated);onPasswordOpenChange(false);setCurrentPassword('');setNewPassword('');setPasswordConfirmation('');showSuccess('Contraseña actualizada. Las demás sesiones se invalidarán al conectarse.');}catch(error){showError(error);}finally{setSavingPassword(false);}};
  useEffect(()=>{if(passwordOpen)return;setCurrentPassword('');setNewPassword('');setPasswordConfirmation('');},[passwordOpen]);
  if(passwordOpen)return <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={styles.memberFormPage}>
    <View style={styles.memberFormHeader}><View style={styles.memberFormHeaderRow}><Pressable accessibilityRole="button" accessibilityLabel="Volver a cuenta" onPress={closePasswordPage} style={({pressed})=>[styles.memberFormBack,pressed&&styles.tabPressed]}><Ionicons name="arrow-back" size={19} color={activeDarkTheme?darkPalette.text:palette.ink}/><Text style={styles.memberFormBackText}>Volver</Text></Pressable><Text style={styles.memberFormStep}>SEGURIDAD</Text><View style={styles.passwordHeaderSpacer}/></View><Text style={styles.memberFormTitle}>Cambiar contraseña</Text><Text style={styles.memberFormCopy}>Protege el acceso a tu cuenta con una contraseña nueva.</Text></View>
    <ScrollView ref={passwordScrollRef} style={styles.memberFormScroll} contentContainerStyle={[styles.memberFormContent,keyboardOpen&&styles.memberFormContentKeyboard]} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} showsVerticalScrollIndicator={keyboardOpen}><KeyboardScrollContext.Provider value={revealPasswordField}><View style={styles.passwordSecurityNotice}><Ionicons name="shield-checkmark-outline" size={21} color={activeDarkTheme?darkPalette.action:palette.action}/><Text style={styles.passwordSecurityNoticeText}>Necesitas conexión. Después del cambio, las demás sesiones dejarán de ser válidas cuando intenten conectarse.</Text></View><Field label="Contraseña actual" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry autoCapitalize="none"/><Field label="Nueva contraseña" value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none"/><Field label="Confirma la nueva contraseña" value={passwordConfirmation} onChangeText={setPasswordConfirmation} secureTextEntry autoCapitalize="none" returnKeyType="done" onSubmitEditing={()=>void savePassword()}/><Text style={styles.registrationNote}>La nueva contraseña debe tener al menos 8 caracteres.</Text></KeyboardScrollContext.Provider></ScrollView>
    {!keyboardOpen?<View style={styles.memberFormFooter}><PrimaryButton label={savingPassword?'Guardando…':'Guardar contraseña'} onPress={()=>void savePassword()} disabled={savingPassword||currentPassword.length<8||newPassword.length<8||!passwordConfirmation}/></View>:null}
  </KeyboardAvoidingView>;
  return <><ScrollView contentContainerStyle={styles.accountScroll}>
    <View style={styles.accountHero}><Text style={styles.accountHeroLabel}>GIMNASIO</Text><Text numberOfLines={2} ellipsizeMode="tail" adjustsFontSizeToFit maxFontSizeMultiplier={1.35} style={styles.accountHeroGym}>{user.gym.name}</Text></View>
    <View style={[styles.subscriptionCard,(expired||verificationRequired)&&styles.subscriptionCardExpired]}>
      <View style={styles.subscriptionHead}><View style={[styles.subscriptionIcon,(expired||verificationRequired)&&styles.subscriptionIconExpired]}><Ionicons name={(expired||verificationRequired)?'alert-circle-outline':'shield-checkmark-outline'} size={23} color={(expired||verificationRequired)?palette.danger:palette.action}/></View><View style={styles.rowMain}><Text style={styles.subscriptionEyebrow}>MEMBRESÍA DE GYMFLOW MINI</Text><Text style={[styles.subscriptionName,(expired||verificationRequired)&&styles.subscriptionNameExpired]}>{gymSubscriptionLabel(plan)}</Text></View><View style={[styles.subscriptionBadge,(expired||verificationRequired)&&styles.subscriptionBadgeExpired]}><Text style={[styles.subscriptionBadgeText,(expired||verificationRequired)&&styles.subscriptionBadgeTextExpired]}>{status}</Text></View></View>
      <View style={styles.subscriptionDates}><View><Text style={styles.subscriptionDateLabel}>FECHA DE VENCIMIENTO</Text><Text style={styles.subscriptionDateValue}>{expiry}</Text></View>{!expired&&!verificationRequired?<Text style={styles.subscriptionRemaining}>{remaining} día{remaining===1?'':'s'} restante{remaining===1?'':'s'}</Text>:null}</View>
      <Text style={[styles.subscriptionActionCopy,(expired||verificationRequired)&&styles.subscriptionExpiredCopy]}>{actionCopy}</Text>
      {user.subscriptionRequest&&!changingRequest?<View style={styles.accountPendingRequest}><View style={styles.accountRequestCode}><Text style={styles.accountRequestLabel}>SOLICITUD PENDIENTE</Text><Text selectable style={styles.accountRequestValue}>{user.subscriptionRequest.code}</Text></View><Text style={styles.accountRequestedPlan}>{user.subscriptionRequest.plan==='MONTHLY'?'Plan mensual · 5 000 CUP':'Plan anual · 50 000 CUP'}</Text><Pressable disabled={!!requestingPlan} accessibilityRole="link" accessibilityLabel="Contactar por WhatsApp" onPress={()=>openWhatsApp(requestWhatsAppMessage(user))} style={({pressed})=>[styles.whatsappButton,styles.whatsappButtonInGroup,pressed&&styles.tabPressed]}><Ionicons name="logo-whatsapp" size={19} color={palette.white}/><Text style={styles.whatsappButtonText}>Contactar por WhatsApp</Text></Pressable><PrimaryButton label={requestingPlan?'Comprobando…':'Comprobar activación'} onPress={refreshRequest} disabled={!!requestingPlan}/><Pressable disabled={!!requestingPlan} onPress={()=>setChangingRequest(true)} style={styles.changePlanButton}><Text style={styles.changePlanText}>Cambiar la solicitud</Text></Pressable></View>:<View style={styles.subscriptionActionGroup}>{actions.map((action,index)=><Pressable key={action.label} disabled={!!requestingPlan} accessibilityRole="button" accessibilityLabel={action.label} onPress={()=>void runSubscriptionAction(action)} style={({pressed}) => [styles.planRequestButton,index>0&&styles.planRequestButtonSecondary,!!requestingPlan&&styles.disabled,pressed&&styles.tabPressed]}>{requestingPlan===action.plan?<ActivityIndicator color={index>0?palette.action:palette.white}/>:<Ionicons name={action.label.startsWith('Cambiar')?'swap-horizontal-outline':'calendar-outline'} size={19} color={index>0?palette.action:palette.white}/>}<Text style={[styles.planRequestButtonText,index>0&&styles.planRequestButtonTextSecondary]}>{action.label}</Text></Pressable>)}</View>}
    </View>
    <View style={styles.accountCard}><AccountRow label="Administrador" value={user.name}/><AccountRow label="Correo" value={user.email}/><AccountRow label="Gimnasio" value={user.gym.name}/><AccountRow label="Moneda" value={user.gym.currency} last/></View>
    <Pressable accessibilityRole="button" onPress={()=>onPasswordOpenChange(true)} style={({pressed})=>[styles.securityButton,pressed&&styles.tabPressed]}><View style={styles.securityIcon}><Ionicons name="key-outline" size={22} color={palette.action}/></View><View style={styles.rowMain}><Text style={styles.securityTitle}>Cambiar contraseña</Text><Text style={styles.securityCopy}>Actualiza tu acceso e invalida las demás sesiones</Text></View><Ionicons name="chevron-forward" size={20} color={palette.secondary}/></Pressable>
    <Pressable accessibilityRole="link" accessibilityLabel="Contactar soporte por WhatsApp" onPress={()=>openWhatsApp(`Hola, soy ${user.name}, administrador de ${user.gym.name}. Necesito soporte con GymFlow Mini.`)} style={({pressed})=>[styles.supportButton,pressed&&styles.tabPressed]}><View style={styles.supportIcon}><Ionicons name="logo-whatsapp" size={23} color={palette.white}/></View><View style={styles.rowMain}><Text style={styles.supportTitle}>Soporte por WhatsApp</Text><Text style={styles.supportCopy}>Contacta directamente con el equipo de GymFlow Mini</Text></View><Ionicons name="open-outline" size={19} color={palette.white}/></Pressable>
    {SHOW_THEME_SELECTOR ? <ThemeSelector value={themePreference} onChange={onThemeChange}/> : null}
    <Pressable accessibilityRole="button" onPress={confirmLogout} style={({pressed}) => [styles.logoutButton, pressed && styles.logoutButtonPressed]}><View style={styles.logoutIcon}><Ionicons name="log-out-outline" size={22} color={palette.danger}/></View><View style={styles.rowMain}><Text style={styles.logoutTitle}>Cerrar sesión</Text><Text style={styles.logoutCopy}>Salir de esta cuenta en el dispositivo</Text></View></Pressable>
    <Text style={styles.accountVersion}>GYMFLOW MINI · PILOTO CUBA · V0.1</Text>
  </ScrollView></>;
}

function AccountRow({ label, value, last }: { label: string; value: string; last?: boolean }) { return <View style={[styles.accountRow,last&&styles.accountRowLast]}><Text style={styles.accountLabel}>{label}</Text><Text numberOfLines={2} ellipsizeMode="tail" maxFontSizeMultiplier={1.3} style={styles.accountValue}>{value}</Text></View>; }

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
  const [loading, setLoading] = useState(true); const [search, setSearch] = useState(''); const [memberFilter, setMemberFilter] = useState<MemberFilter>(initialFilter); const [addOpen, setAddOpen] = useState(false); const [selected, setSelected] = useState<Member | null>(null); const [editing, setEditing] = useState<Member | null>(null); const [assigning, setAssigning] = useState<Member | null>(null); const [renewing, setRenewing] = useState<Member | null>(null); const [editingScheduled, setEditingScheduled] = useState<Member | null>(null);
  const load = useCallback(() => { setLoading(true); Promise.all([offline.members(scope), offline.plans(scope)]).then(([m, p]) => { setMembers(m); setPlans(p); }).catch(showError).finally(() => setLoading(false)); }, [scope]);
  const refresh = useCallback(() => { void syncNow(scope).then(load); }, [scope, load]);
  const confirmDelete = (member: Member) => Alert.alert('Eliminar miembro', `¿Deseas eliminar a ${member.firstName} ${member.lastName}? Se archivará como inactivo, se cancelarán su membresía y cobro activos, y todo quedará visible en el historial.`, [{ text:'Cancelar', style:'cancel' }, { text:'Eliminar', style:'destructive', onPress:() => { try { ensureActiveSubscription(); void offline.deleteMember(scope, member.id).then(() => { setSelected(null); showSuccess('Miembro archivado y operaciones activas anuladas.'); load(); }).catch(showError); } catch(error) { showError(error); } } }]);
  const confirmDeleteScheduled = (member: Member) => { const scheduled=scheduledMembership(member); if (!scheduled) return; Alert.alert('Eliminar renovación', `¿Deseas eliminar la renovación programada del plan ${contractedPlan(scheduled).name}? La membresía actual no cambiará.`, [{text:'Cancelar',style:'cancel'},{text:'Eliminar',style:'destructive',onPress:()=>{ try { ensureActiveSubscription(); void offline.deleteScheduledMembership(scope,member.id,scheduled.id).then(()=>{setSelected(null);load();}).catch(showError); } catch(error) { showError(error); } }}]); };
  const expiredCount = members.filter(hasExpiredMembership).length;
  const upcomingCount = members.filter(member => !!upcomingMembership(member)).length;
  const filterOptions: Array<{ id: MemberFilter; label: string; count: number }> = [{ id:'ALL', label:'Todos', count:members.length }, { id:'ACTIVE', label:'Activos', count:members.filter(member => member.status === 'ACTIVE').length }, { id:'INACTIVE', label:'Inactivos', count:members.filter(member => member.status === 'INACTIVE').length }, { id:'UPCOMING', label:'Por vencer', count:upcomingCount }, { id:'EXPIRED', label:'Vencidas', count:expiredCount }];
  const filteredMembers = members.filter(member => memberFilter === 'ALL' ? true : memberFilter === 'ACTIVE' ? member.status === 'ACTIVE' : memberFilter === 'INACTIVE' ? member.status === 'INACTIVE' : memberFilter === 'UPCOMING' ? !!upcomingMembership(member) : hasExpiredMembership(member));
  const query=search.trim().toLocaleLowerCase('es'); const visibleMembers=query ? filteredMembers.filter(member => `${member.firstName} ${member.lastName} ${member.code ?? ''} ${member.ci} ${member.age ?? ''} ${sexLabel(member.sex)} ${member.phone ?? ''} ${member.address ?? ''}`.toLocaleLowerCase('es').includes(query)) : filteredMembers;
  useEffect(load, [load, revision]);
  if (addOpen || editing) return <MemberForm scope={scope} open member={editing} plans={plans} onClose={() => { setAddOpen(false); setEditing(null); }} onSaved={() => { setAddOpen(false); setEditing(null); load(); }} />;
  return <>
    <FlatList
      data={visibleMembers}
      keyExtractor={member => member.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} colors={[activeDarkTheme ? '#c9f47b' : '#1d6b4d']} tintColor={activeDarkTheme ? '#c9f47b' : '#1d6b4d'} progressBackgroundColor={activeDarkTheme ? '#212923' : '#fff'} />}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={16}
      windowSize={7}
      removeClippedSubviews={Platform.OS === 'android'}
      ListHeaderComponent={<>
        <PrimaryButton label="Registrar miembro" icon="person-add-outline" onPress={() => withActiveSubscription(() => setAddOpen(true))} />
        <View style={styles.memberSearch}><Ionicons name="search-outline" size={21} color={activeDarkTheme ? darkPalette.action : palette.action}/><TextInput accessibilityLabel="Buscar miembros" value={search} onChangeText={setSearch} placeholder="Nombre, código, CI o teléfono" placeholderTextColor={activeDarkTheme ? '#aab7b0' : '#657169'} autoCorrect={false} style={styles.memberSearchInput} maxFontSizeMultiplier={1.35}/>{search ? <Pressable accessibilityRole="button" accessibilityLabel="Limpiar búsqueda" onPress={() => setSearch('')} style={styles.memberSearchClear}><Ionicons name="close" size={20} color={activeDarkTheme ? darkPalette.secondary : palette.secondary}/></Pressable> : null}</View>
        <View style={styles.memberFilters}>{filterOptions.map(option => { const active=memberFilter===option.id; return <Pressable key={option.id} accessibilityRole="button" accessibilityState={{selected:active}} onPress={() => setMemberFilter(option.id)} style={[styles.memberFilter,active&&styles.memberFilterActive]}><Text style={[styles.memberFilterText,active&&styles.memberFilterTextActive]}>{option.label}</Text><View style={[styles.memberFilterCount,active&&styles.memberFilterCountActive]}><Text style={[styles.memberFilterCountText,active&&styles.memberFilterCountTextActive]}>{option.count}</Text></View></Pressable>;})}</View>
        <SectionTitle title={query ? `${visibleMembers.length} resultado${visibleMembers.length === 1 ? '' : 's'}` : `${visibleMembers.length} miembro${visibleMembers.length === 1 ? '' : 's'}`} subtitle={memberFilter === 'EXPIRED' ? 'Miembros activos sin una membresía vigente' : memberFilter === 'UPCOMING' ? 'Membresías que vencen en los próximos 10 días' : query ? `Búsqueda dentro del filtro seleccionado` : "Toca un miembro para ver sus opciones"} />
      </>}
      renderItem={({ item:member }) => { const current = editableMembership(member) ?? member.memberships[0]; const currentStatus=current ? effectiveMembershipStatus(current) : undefined; const expiring=upcomingMembership(member); return <Pressable accessibilityRole="button" accessibilityLabel={`Opciones de ${member.firstName} ${member.lastName}`} onPress={() => setSelected(member)} style={({pressed}) => [styles.memberRow, styles.memberListRow, pressed && styles.memberRowPressed]}>
        <View style={styles.memberAvatar}><Text style={styles.memberAvatarText}>{member.firstName[0]}{member.lastName[0]}</Text></View><View style={styles.rowMain}><Text numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.35} style={styles.rowTitle}>{member.firstName} {member.lastName}</Text><Text numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.3} style={styles.rowSubtitle}>{member.code ? `Código ${member.code} · ` : ''}CI {member.ci}</Text><View style={styles.memberPlanLine}><View style={[styles.memberPlanDot, currentStatus === 'ACTIVE' && styles.memberPlanDotActive, expiring&&styles.memberPlanDotUpcoming, currentStatus === 'EXPIRED' && styles.memberPlanDotExpired]}/><Text numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.3} style={[styles.memberPlanText,expiring&&styles.memberPlanTextUpcoming,currentStatus === 'EXPIRED'&&styles.memberPlanTextExpired]}>{current ? expiring ? `${contractedPlan(current).name} · vence ${formatDate(current.endDate)}` : `${contractedPlan(current).name} · ${membershipStatusLabel(currentStatus!)}` : 'Sin plan asignado'}</Text></View></View><Ionicons name="chevron-forward" size={22} color={activeDarkTheme ? darkPalette.secondary : palette.secondary}/>
      </Pressable>; }}
      ListEmptyComponent={loading ? <LoadingSkeleton/> : <View style={styles.card}><Empty text={query ? "No se encontraron miembros" : memberFilter === 'UPCOMING' ? "No hay membresías próximas a vencer" : memberFilter === 'EXPIRED' ? "No hay membresías vencidas" : memberFilter === 'INACTIVE' ? "No hay miembros inactivos" : memberFilter === 'ACTIVE' ? "No hay miembros activos" : "Registra tu primer miembro"} /></View>}
    />
    <MemberActions member={selected} onClose={() => setSelected(null)} onEdit={() => withActiveSubscription(() => { if (selected) setEditing(selected); setSelected(null); })} onPlan={() => withActiveSubscription(() => { if (selected) setAssigning(selected); setSelected(null); })} onRenew={() => withActiveSubscription(() => { if (selected) setRenewing(selected); setSelected(null); })} onEditScheduled={() => withActiveSubscription(() => { if (selected) setEditingScheduled(selected); setSelected(null); })} onDeleteScheduled={() => withActiveSubscription(() => { if (selected) confirmDeleteScheduled(selected); })} onDelete={() => withActiveSubscription(() => { if (selected) confirmDelete(selected); })} />
    <AssignPlanForm scope={scope} member={assigning} plans={plans} onClose={() => setAssigning(null)} onSaved={() => { setAssigning(null); load(); }} />
    {SHOW_SCHEDULED_MEMBERSHIP_UI ? <RenewMembershipForm scope={scope} member={renewing} plans={plans} onClose={() => setRenewing(null)} onSaved={() => { setRenewing(null); load(); }} /> : null}
    {SHOW_SCHEDULED_MEMBERSHIP_UI ? <ScheduledMembershipForm scope={scope} member={editingScheduled} plans={plans} onClose={() => setEditingScheduled(null)} onSaved={() => { setEditingScheduled(null); load(); }} /> : null}
  </>;
}

function MemberActions({ member, onClose, onEdit, onPlan, onRenew, onEditScheduled, onDeleteScheduled, onDelete }: { member: Member | null; onClose: () => void; onEdit: () => void; onPlan: () => void; onRenew: () => void; onEditScheduled: () => void; onDeleteScheduled: () => void; onDelete: () => void }) {
  const active = member ? member.memberships.find(membership => membership.status === 'ACTIVE' && new Date(membership.endDate).getTime() >= Date.now()) : undefined;
  const editable = member ? editableMembership(member) : undefined;
  const scheduled = member ? scheduledMembership(member) : undefined;
  const membership = active ?? editable ?? member?.memberships[0];
  const fullName = member ? `${member.firstName} ${member.lastName}` : 'Opciones del miembro';
  return <Sheet open={!!member} title={fullName} onClose={onClose}>
    <View style={styles.memberProfile}>
      <View style={styles.memberProfileAvatar}><Text style={styles.memberProfileInitials}>{member ? `${member.firstName[0]}${member.lastName[0]}` : ''}</Text></View>
      <View style={styles.rowMain}><Text numberOfLines={2} ellipsizeMode="tail" maxFontSizeMultiplier={1.35} style={styles.memberProfileName}>{fullName}</Text><Text numberOfLines={1} ellipsizeMode="tail" style={styles.memberProfileMeta}>CI {member?.ci}{member?.phone ? ` · ${member.phone}` : ''}</Text><Text numberOfLines={2} ellipsizeMode="tail" maxFontSizeMultiplier={1.3} style={[styles.memberProfilePlan,membership&&effectiveMembershipStatus(membership)==='EXPIRED'&&styles.memberPlanTextExpired]}>{membership ? `${contractedPlan(membership).name} · ${membershipStatusLabel(effectiveMembershipStatus(membership))}` : 'Sin membresía vigente'}</Text>{active?<Text style={styles.memberProfileExpiry}>Vence el {formatDate(active.endDate)} · {remainingDaysLabel(active.endDate)}</Text>:null}</View>
    </View>
    {SHOW_SCHEDULED_MEMBERSHIP_UI&&scheduled?<View style={styles.scheduledMembershipCard}>
      <Text style={styles.scheduledMembershipLabel}>PRÓXIMA MEMBRESÍA · PROGRAMADA</Text><Text style={styles.scheduledMembershipPlan}>{contractedPlan(scheduled).name}</Text><Text style={styles.scheduledMembershipDates}>Inicia {formatDate(scheduled.startDate)} · vence {formatDate(scheduled.endDate)}</Text>
      <View style={styles.scheduledMembershipActions}><Pressable accessibilityRole="button" onPress={onEditScheduled} style={({pressed})=>[styles.scheduledMembershipButton,pressed&&styles.tabPressed]}><Ionicons name="create-outline" size={15} color={palette.action}/><Text style={styles.scheduledMembershipButtonText}>Editar</Text></Pressable><Pressable accessibilityRole="button" onPress={onDeleteScheduled} style={({pressed})=>[styles.scheduledMembershipButton,styles.scheduledMembershipDeleteButton,pressed&&styles.tabPressed]}><Ionicons name="trash-outline" size={15} color={palette.danger}/><Text style={[styles.scheduledMembershipButtonText,styles.memberActionDeleteText]}>Eliminar</Text></Pressable></View>
    </View>:null}
    <View style={styles.memberActionGrid}>
      <Pressable accessibilityRole="button" onPress={onEdit} style={({pressed})=>[styles.memberActionCard,pressed&&styles.memberActionCardPressed]}><View style={styles.memberActionIcon}><Ionicons name="create-outline" size={20} color={palette.action}/></View><View style={styles.rowMain}><Text style={styles.memberActionTitle}>Editar datos</Text><Text style={styles.memberActionCopy}>Nombre, CI, teléfono, dirección y estado</Text></View><Ionicons name="chevron-forward" size={21} color={palette.secondary}/></Pressable>
      <Pressable accessibilityRole="button" onPress={onPlan} style={({pressed})=>[styles.memberActionCard,styles.memberActionCardPlan,pressed&&styles.memberActionCardPressed]}><View style={[styles.memberActionIcon,styles.memberActionIconPlan]}><Ionicons name="card-outline" size={20} color={palette.action}/></View><View style={styles.rowMain}><Text style={styles.memberActionTitle}>{active?'Gestionar membresía':'Asignar plan'}</Text><Text style={styles.memberActionCopy}>{active?'Puedes cancelarla':'Crear una nueva membresía para este miembro'}</Text></View><Ionicons name="chevron-forward" size={21} color={palette.secondary}/></Pressable>
      {SHOW_SCHEDULED_MEMBERSHIP_UI&&active&&!scheduled?<Pressable accessibilityRole="button" onPress={onRenew} style={({pressed})=>[styles.memberActionCard,styles.memberActionCardRenew,pressed&&styles.memberActionCardPressed]}><View style={[styles.memberActionIcon,styles.memberActionIconRenew]}><Ionicons name="calendar-outline" size={20} color={palette.warning}/></View><View style={styles.rowMain}><Text style={styles.memberActionTitle}>Programar renovación</Text><Text style={styles.memberActionCopy}>Elige el plan que comenzará cuando venza el actual</Text></View><Ionicons name="chevron-forward" size={21} color={palette.secondary}/></Pressable>:null}
      <Pressable accessibilityRole="button" accessibilityLabel="Eliminar miembro" onPress={onDelete} style={({pressed})=>[styles.memberActionCard,styles.memberActionCardDelete,pressed&&styles.memberActionCardPressed]}><View style={[styles.memberActionIcon,styles.memberActionIconDelete]}><Ionicons name="trash-outline" size={20} color={palette.danger}/></View><View style={styles.rowMain}><Text style={[styles.memberActionTitle,styles.memberActionDeleteText]}>Eliminar miembro</Text><Text style={styles.memberActionCopy}>Elimina el registro o lo archiva si tiene historial</Text></View></Pressable>
    </View>
  </Sheet>;
}

function PlansScreen({ scope, revision }: ScreenProps) {
  const [plans, setPlans] = useState<Plan[]>([]); const [loading, setLoading] = useState(true); const [open, setOpen] = useState(false); const [selected, setSelected] = useState<Plan | null>(null); const [editing, setEditing] = useState<Plan | null>(null); const [planFilter, setPlanFilter] = useState<PlanFilter>('ALL');
  const load = useCallback(() => { setLoading(true); offline.plans(scope).then(setPlans).catch(showError).finally(() => setLoading(false)); }, [scope]);
  const refresh = useCallback(() => { void syncNow(scope).then(load); }, [scope, load]);
  const onlineAction = async (action: () => void) => { if (!subscriptionIsActive()) { showError(new Error(subscriptionErrorMessage())); return; } if (!await hasInternetConnection()) { showOnlineRequired(); return; } action(); };
  const confirmDelete = (plan: Plan) => { void onlineAction(() => Alert.alert('Eliminar plan inactivo', `¿Deseas eliminar el plan ${plan.name}? Solo se borrará definitivamente si no tiene historial. Si fue utilizado, permanecerá archivado para conservar la trazabilidad.`, [{ text:'Cancelar', style:'cancel' }, { text:'Eliminar', style:'destructive', onPress:() => { void api.deletePlan(plan.id).then(async result => { await syncNow(scope); setSelected(null); showSuccess(result.disposition === 'DELETED' ? 'Plan eliminado definitivamente.' : 'Plan conservado como historial e inactivo.'); load(); }).catch(showError); } }])); };
  const reactivate = (plan: Plan) => { void onlineAction(() => Alert.alert('Reactivar plan', `¿Deseas volver a activar el plan ${plan.name}? Estará disponible para nuevas membresías.`, [{ text:'Cancelar', style:'cancel' }, { text:'Reactivar', onPress:() => { void api.updatePlan(plan.id, { isActive:true }).then(() => syncNow(scope)).then(() => { setSelected(null); showSuccess('Plan reactivado correctamente.'); load(); }).catch(showError); } }])); };
  const filterOptions: Array<{ id: PlanFilter; label: string; count: number }> = [{ id:'ALL', label:'Todos', count:plans.length }, { id:'ACTIVE', label:'Activos', count:plans.filter(plan => plan.isActive).length }, { id:'INACTIVE', label:'Inactivos', count:plans.filter(plan => !plan.isActive).length }];
  const visiblePlans = plans.filter(plan => planFilter === 'ALL' || (planFilter === 'ACTIVE' ? plan.isActive : !plan.isActive));
  useEffect(load, [load, revision]);
  if (open || editing) return <PlanForm scope={scope} open plan={editing} onClose={() => { setOpen(false); setEditing(null); }} onSaved={() => { setOpen(false); setEditing(null); load(); }} />;
  return <><ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} colors={[activeDarkTheme ? '#c9f47b' : '#1d6b4d']} tintColor={activeDarkTheme ? '#c9f47b' : '#1d6b4d'} progressBackgroundColor={activeDarkTheme ? '#212923' : '#fff'} />} contentContainerStyle={styles.scroll}>
    <PrimaryButton label="+ Crear plan" onPress={() => { void onlineAction(() => setOpen(true)); }} />
    <View style={styles.memberFilters}>{filterOptions.map(option => { const active=planFilter===option.id; return <Pressable key={option.id} accessibilityRole="button" accessibilityState={{selected:active}} onPress={() => setPlanFilter(option.id)} style={[styles.memberFilter,active&&styles.memberFilterActive]}><Text style={[styles.memberFilterText,active&&styles.memberFilterTextActive]}>{option.label}</Text><View style={[styles.memberFilterCount,active&&styles.memberFilterCountActive]}><Text style={[styles.memberFilterCountText,active&&styles.memberFilterCountTextActive]}>{option.count}</Text></View></Pressable>;})}</View>
    <SectionTitle title={`${visiblePlans.length} plan${visiblePlans.length === 1 ? '' : 'es'}`} subtitle={planFilter === 'INACTIVE' ? 'Puedes reactivar o eliminar los planes inactivos' : planFilter === 'ACTIVE' ? 'Planes disponibles para nuevas membresías' : 'Todos los planes del gimnasio'} />
    {visiblePlans.map(plan => <Pressable accessibilityRole="button" onPress={() => setSelected(plan)} key={plan.id} style={({pressed}) => [styles.planCard, pressed && styles.planCardPressed]}><View style={styles.rowMain}><View style={styles.planTitleLine}><Text numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.3} style={styles.planName}>{plan.name}</Text><View style={[styles.planState, plan.isActive && styles.planStateActive]}><Text style={[styles.planStateText, plan.isActive && styles.planStateTextActive]}>{plan.isActive ? 'Activo' : 'Inactivo'}</Text></View></View><Text numberOfLines={2} ellipsizeMode="tail" maxFontSizeMultiplier={1.3} style={styles.rowSubtitle}>{plan.durationDays} días{plan.description ? ` · ${plan.description}` : ''}</Text></View><Text numberOfLines={1} adjustsFontSizeToFit style={styles.planPrice}>{money(plan.price)}</Text><Ionicons name="chevron-forward" size={22} color={palette.secondary}/></Pressable>)}
    {!visiblePlans.length && (loading ? <LoadingSkeleton rows={4}/> : <View style={styles.card}><Empty text={planFilter === 'INACTIVE' ? 'No hay planes inactivos' : planFilter === 'ACTIVE' ? 'No hay planes activos' : 'Crea tu primer plan'} /></View>)}
  </ScrollView><PlanActions plan={selected} onClose={() => setSelected(null)} onEdit={() => { void onlineAction(() => { if (selected) setEditing(selected); setSelected(null); }); }} onReactivate={() => { if (selected) reactivate(selected); }} onDelete={() => { if (selected) confirmDelete(selected); }}/></>;
}

function PaymentsScreen({ scope, revision }: ScreenProps) {
  const [payments, setPayments] = useState<Payment[]>([]); const [loading, setLoading] = useState(true); const [selected, setSelected] = useState<Payment | null>(null);
  const [monthFilter, setMonthFilter] = useState<PaymentMonthFilter>('ALL'); const [yearFilter, setYearFilter] = useState<PaymentYearFilter>('ALL'); const [exporting, setExporting] = useState(false);
  const load = useCallback(() => { setLoading(true); offline.payments(scope).then(setPayments).catch(showError).finally(() => setLoading(false)); }, [scope]);
  const refresh = useCallback(() => { void syncNow(scope).then(load); }, [scope, load]);
  useEffect(load, [load, revision]);
  const duePayments = payments.filter(payment => paymentIsDue(payment));
  const years = Array.from(new Set([new Date().getFullYear(), ...duePayments.map(payment => paymentCreatedDate(payment)?.getFullYear()).filter((year): year is number => year !== undefined)])).sort((a,b) => b-a);
  const filteredPayments = duePayments.filter(payment => { const date=paymentCreatedDate(payment); if (monthFilter === 'ALL' && yearFilter === 'ALL') return true; if (!date) return false; return (monthFilter === 'ALL' || date.getMonth() === monthFilter) && (yearFilter === 'ALL' || date.getFullYear() === yearFilter); });
  const period = paymentPeriodLabel(monthFilter, yearFilter);
  const debt = filteredPayments.reduce((sum, payment) => payment.status === 'CANCELLED' ? sum : sum + Math.max(0, Number(payment.amount) - Number(payment.paidAmount)), 0);
  const pendingCount = filteredPayments.filter(payment => payment.status !== 'CANCELLED' && Number(payment.amount) > Number(payment.paidAmount)).length;
  const exportExcel = async () => { setExporting(true); try { await exportPaymentsExcel(filteredPayments, period); } catch(error) { const message=error instanceof Error?error.message:String(error); if(!/cancel/i.test(message)) showError(error); } finally { setExporting(false); } };
  return <><FlatList
    data={filteredPayments}
    keyExtractor={payment => payment.id}
    refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} colors={[activeDarkTheme ? '#c9f47b' : '#1d6b4d']} tintColor={activeDarkTheme ? '#c9f47b' : '#1d6b4d'} progressBackgroundColor={activeDarkTheme ? '#212923' : '#fff'} />}
    contentContainerStyle={styles.scroll}
    initialNumToRender={12}
    windowSize={7}
    removeClippedSubviews={Platform.OS === 'android'}
    ItemSeparatorComponent={() => <View style={styles.listSeparator}/>}
    ListHeaderComponent={<>
      <View style={[styles.debtCard,styles.debtCardGreen]}><View style={[styles.debtGlowLarge,styles.debtGlowLargeGreen]}/><View style={styles.debtGlowSmall}/><View style={styles.debtHeader}><View style={[styles.debtIcon,styles.debtIconGreen]}><Text style={styles.debtIconText}>$</Text></View><View style={styles.rowMain}><Text style={[styles.debtLabel,styles.debtLabelGreen]}>TOTAL POR COBRAR</Text><Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={[styles.debtSubtitle,styles.debtSubtitleGreen]}>{period}</Text></View></View><Text maxFontSizeMultiplier={1.25} adjustsFontSizeToFit numberOfLines={1} style={[styles.debtValue,styles.debtValueGreen]}>{money(debt)}</Text><View style={[styles.debtFooter,styles.debtFooterGreen]}><Text style={[styles.debtPending,styles.debtPendingGreen]}>{pendingCount} cobro{pendingCount === 1 ? '' : 's'} pendiente{pendingCount === 1 ? '' : 's'}</Text><View style={[styles.debtState,styles.debtStateGreen]}><View style={[styles.debtStateDot,styles.debtStateDotGreen]}/><Text style={[styles.debtStateText,styles.debtStateTextGreen]}>Por gestionar</Text></View></View></View>
      <View style={styles.paymentFilters}><Text style={styles.paymentFilterTitle}>Filtrar cobros</Text><Text style={styles.paymentFilterLabel}>Año</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paymentFilterOptions}><FilterChip label="Todos" active={yearFilter === 'ALL'} onPress={() => setYearFilter('ALL')}/>{years.map(year => <FilterChip key={year} label={String(year)} active={yearFilter === year} onPress={() => setYearFilter(year)}/>)}</ScrollView><Text style={styles.paymentFilterLabel}>Mes</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.paymentFilterOptions}><FilterChip label="Todos" active={monthFilter === 'ALL'} onPress={() => setMonthFilter('ALL')}/>{monthNames.map((month,index) => <FilterChip key={month} label={month.slice(0,3)} active={monthFilter === index} onPress={() => setMonthFilter(index)}/>)}</ScrollView><View style={styles.paymentFilterFooter}><Text numberOfLines={2} style={styles.paymentFilterResult}>{filteredPayments.length} cobro{filteredPayments.length === 1 ? '' : 's'} · {period}</Text><Pressable accessibilityRole="button" accessibilityLabel="Descargar cobros filtrados en Excel" disabled={exporting || !filteredPayments.length} onPress={() => void exportExcel()} style={({pressed}) => [styles.excelButton,(exporting || !filteredPayments.length) && styles.disabled,pressed && styles.tabPressed]}>{exporting ? <ActivityIndicator size="small" color={palette.white}/> : <Ionicons name="download-outline" size={18} color={palette.white}/>}<Text style={styles.excelButtonText}>{exporting ? 'Guardando…' : 'Descargar'}</Text></Pressable></View></View>
      <SectionTitle title="Cobros" subtitle={`Mostrando ${period.toLocaleLowerCase('es-CU')}`} />
    </>}
    renderItem={({ item:payment }) => {
      const total = Number(payment.amount);
      const paid = Math.min(total, Math.max(0, Number(payment.paidAmount)));
      const balance = Math.max(0, total - paid);
      const status = paymentDisplayStatus(payment, total, paid, balance);
      const disabled = balance <= 0 || payment.status === 'CANCELLED';
      const progress = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
      return <Pressable disabled={disabled} onPress={() => withActiveSubscription(() => setSelected(payment))} style={({pressed}) => [styles.paymentDetailRow,payment.status==='CANCELLED'&&styles.paymentDetailRowCancelled,pressed && styles.paymentDetailRowPressed]}>
        <View style={styles.paymentDetailHead}><View style={styles.rowMain}><Text numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.35} style={styles.rowTitle}>{payment.member.firstName} {payment.member.lastName}</Text><Text numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.3} style={styles.rowSubtitle}>{contractedPlan(payment.membership).name}{(payment.membership.periodCount ?? 1) > 1 ? ` · ${payment.membership.periodCount} períodos` : ''}</Text></View><View style={[styles.paymentBadge, status.tone === 'success' && styles.paymentBadgeSuccess, status.tone === 'danger' && styles.paymentBadgeDanger]}><Text style={[styles.paymentBadgeText, status.tone === 'success' && styles.paymentBadgeTextSuccess, status.tone === 'danger' && styles.paymentBadgeTextDanger]}>{status.label}</Text></View></View>
        <View style={styles.paymentAmounts}><View><Text style={styles.paymentAmountLabel}>{payment.status==='CANCELLED'?'PAGO ANULADO':'PAGADO'}</Text><Text style={[styles.paymentPaid,payment.status==='CANCELLED'&&styles.paymentPaidCancelled]}>{money(paid)}</Text></View><View><Text style={[styles.paymentAmountLabel, styles.paymentAmountRight]}>{payment.status==='CANCELLED'?'IMPORTE CANCELADO':'TOTAL'}</Text><Text style={[styles.paymentTotal,payment.status==='CANCELLED'&&styles.paymentTotalCancelled]}>{money(total)}</Text></View></View>
        <View style={styles.paymentProgress}><View style={[styles.paymentProgressFill, { width: `${progress}%` }]} /></View>
        {payment.movements.length ? <View style={styles.paymentOperations}><Text style={styles.paymentOperationsTitle}>OPERACIONES</Text>{payment.movements.map(movement => <View key={movement.id} style={styles.paymentOperation}><Text style={styles.paymentOperationAmount}>Abono {money(movement.amount)}</Text><Text style={styles.paymentOperationDate}>{formatDateTime(movement.occurredAt)}</Text></View>)}</View> : <Text style={styles.paymentNoOperations}>Sin operaciones registradas</Text>}
        {payment.status==='CANCELLED'?<Text style={styles.paymentCancelledCopy}>Importe y abonos excluidos de los totales · Registro conservado</Text>:!disabled ? <Text style={styles.paymentBalanceCopy}>Saldo pendiente: {money(balance)} · Toca para cobrar</Text> : null}
      </Pressable>;
    }}
    ListEmptyComponent={loading ? <LoadingSkeleton rows={4}/> : <View style={styles.card}><Empty text={payments.length ? 'No hay cobros en el período seleccionado' : 'No hay cobros registrados'} /></View>}
  /><PaymentForm scope={scope} payment={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); load(); }} /></>;
}

function MemberForm({ scope, open, member, plans, onClose, onSaved }: FormProps & { member: Member | null; plans: Plan[] }) {
  const [ci, setCi] = useState(''); const [code, setCode] = useState(''); const [firstName, setFirstName] = useState(''); const [lastName, setLastName] = useState(''); const [age, setAge] = useState(''); const [sex, setSex] = useState<MemberSex | ''>(''); const [phone, setPhone] = useState(''); const [address, setAddress] = useState(''); const [status, setStatus] = useState('ACTIVE'); const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(0); const [planId, setPlanId] = useState(''); const [periodCount, setPeriodCount] = useState(1); const [initialPayment, setInitialPayment] = useState('');
  const keyboardOpen = useKeyboardOpen();
  const scrollRef = useRef<ScrollView>(null);
  const revealFocusedInput = useRevealFocusedInput(scrollRef, 120);
  const availablePlans = plans.filter(plan => plan.isActive);
  const selectedInitialPlan = availablePlans.find(plan => plan.id === planId);
  const initialEndDate = selectedInitialPlan ? addDays(new Date().toISOString(), selectedInitialPlan.durationDays * periodCount) : undefined;
  const totalPages = member ? 4 : 5;
  useEffect(() => { if (!open) return; setPage(0); setPlanId(''); setPeriodCount(1); setInitialPayment(''); setCi(member?.ci ?? ''); setCode(member?.code ?? ''); setFirstName(member?.firstName ?? ''); setLastName(member?.lastName ?? ''); setAge(member?.age ? String(member.age) : ''); setSex(member?.sex ?? ''); setPhone(member?.phone ?? ''); setAddress(member?.address ?? ''); setStatus(member?.status ?? 'ACTIVE'); }, [open, member]);
  const save = async () => { setSaving(true); try { ensureActiveSubscription(); const input = { ci, code: code.trim() || null, firstName: firstName.trim(), lastName: lastName.trim(), age: age ? Number(age) : null, sex: sex || null, phone: phone.trim(), address: address.trim() }; if (member) await offline.updateMember(scope, member.id, { ...input, status }); else { if (!planId) throw new Error('Selecciona el plan inicial'); await offline.createMember(scope, input); await syncNow(scope); const createdMember=(await offline.members(scope)).find(item => item.ci === ci); if (!createdMember) throw new Error('No se pudo encontrar el miembro recién creado'); await offline.assignPlan(scope, { memberId:createdMember.id, planId, periodCount, ...(Number(initialPayment)>0?{initialPayment:Number(initialPayment),paymentMethod:'CASH'}:{}) }); } Keyboard.dismiss(); showSuccess(member ? 'Datos del miembro actualizados.' : 'Miembro y membresía registrados.'); onSaved(); } catch (error) { showError(error); } finally { setSaving(false); } };
  const validAge = !age || (Number.isInteger(Number(age)) && Number(age) >= 1 && Number(age) <= 120);
  const pageValid = [!!firstName.trim() && !!lastName.trim(), ci.length === 11, validAge, true, !!planId][page];
  const pageTitles = ['Datos personales', 'Identificación', 'Información adicional', 'Contacto y estado', 'Plan inicial'];
  const goBack = () => { Keyboard.dismiss(); if (page > 0) setPage((value) => value - 1); else onClose(); };
  const goForward = () => { Keyboard.dismiss(); if (page < totalPages - 1) setPage((value) => value + 1); else void save(); };
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { goBack(); return true; });
    return () => subscription.remove();
  }, [page, onClose]);
  return <View style={styles.memberFormPage}>
    <View style={styles.memberFormHeader}><View style={styles.memberFormHeaderRow}><Pressable accessibilityRole="button" accessibilityLabel={page > 0 ? 'Paso anterior' : 'Volver a miembros'} onPress={goBack} style={({pressed}) => [styles.memberFormBack, pressed && styles.tabPressed]}><Ionicons name="arrow-back" size={19} color={activeDarkTheme ? darkPalette.text : palette.ink}/><Text style={styles.memberFormBackText}>{page > 0 ? 'Atrás' : 'Volver'}</Text></Pressable><Text style={styles.memberFormStep}>PASO {page + 1} DE {totalPages}</Text><Pressable accessibilityRole="button" disabled={!pageValid || saving} onPress={goForward} style={[styles.memberFormNext, (!pageValid || saving) && styles.disabled]}><Text style={styles.memberFormNextText}>{page === totalPages - 1 ? saving ? 'Guardando…' : 'Guardar' : 'Siguiente'}</Text><Ionicons name={page === totalPages - 1 ? 'checkmark' : 'arrow-forward'} size={16} color={palette.white}/></Pressable></View><View style={styles.memberFormProgress}>{Array.from({length:totalPages},(_,step) => <View key={step} style={[styles.memberFormProgressPart, step <= page && styles.memberFormProgressPartActive]}/>)}</View><Text style={styles.memberFormTitle}>{pageTitles[page]}</Text><Text style={styles.memberFormCopy}>{member ? 'Editando los datos del miembro.' : page === 4 ? 'Selecciona obligatoriamente la membresía inicial.' : 'Registrando un nuevo miembro.'}</Text></View>
    <ScrollView ref={scrollRef} key={page} style={styles.memberFormScroll} contentContainerStyle={[styles.memberFormContent, keyboardOpen && styles.memberFormContentKeyboard]} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} showsVerticalScrollIndicator={keyboardOpen}>
      <KeyboardScrollContext.Provider value={revealFocusedInput}>
      {page === 0 ? <><Field label="Nombre" value={firstName} onChangeText={setFirstName} /><Field label="Apellidos" value={lastName} onChangeText={setLastName} /></> : null}
      {page === 1 ? <><Field label="Carnet de identidad (11 dígitos)" value={ci} onChangeText={(value) => setCi(value.replace(/\D/g, '').slice(0, 11))} keyboardType="number-pad" maxLength={11} /><Field label="Código interno (opcional)" value={code} onChangeText={(value) => setCode(value.slice(0, 40))} maxLength={40} /></> : null}
      {page === 2 ? <><Field label="Edad (opcional)" value={age} onChangeText={(value) => setAge(value.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" maxLength={3} /><Text style={styles.fieldLabel}>Sexo (opcional)</Text><View style={styles.statusChoices}>{([['MALE','Masculino'],['FEMALE','Femenino'],['OTHER','Otro']] as Array<[MemberSex,string]>).map(([value,label]) => <Pressable key={value} onPress={() => setSex(sex === value ? '' : value)} style={[styles.statusChoice, sex === value && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, sex === value && styles.statusChoiceTextActive]}>{label}</Text></Pressable>)}</View></> : null}
      {page === 3 ? <><Field label="Teléfono" value={phone} onChangeText={setPhone} keyboardType="phone-pad" /><Field label="Dirección" value={address} onChangeText={setAddress} />{member && <><Text style={styles.fieldLabel}>Estado</Text><View style={styles.statusChoices}><Pressable onPress={() => setStatus('ACTIVE')} style={[styles.statusChoice, status === 'ACTIVE' && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, status === 'ACTIVE' && styles.statusChoiceTextActive]}>Activo</Text></Pressable><Pressable onPress={() => setStatus('INACTIVE')} style={[styles.statusChoice, status === 'INACTIVE' && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, status === 'INACTIVE' && styles.statusChoiceTextActive]}>Inactivo</Text></Pressable></View></>}</> : null}
      {page === 4 && !member ? <>{availablePlans.length ? <><View style={styles.choices}>{availablePlans.map(plan => <Pressable accessibilityRole="radio" accessibilityState={{checked:planId===plan.id}} key={plan.id} onPress={() => setPlanId(plan.id)} style={[styles.choice,planId===plan.id&&styles.choiceActive]}><Text numberOfLines={2} ellipsizeMode="tail" maxFontSizeMultiplier={1.3} style={styles.choiceTitle}>{plan.name}</Text><Text style={styles.choicePrice}>{money(plan.price)} · {plan.durationDays} días</Text></Pressable>)}</View><PeriodSelector value={periodCount} onChange={setPeriodCount}/>{selectedInitialPlan?<MembershipPurchasePreview plan={selectedInitialPlan} periodCount={periodCount} endDate={initialEndDate}/>:null}<Field label="Pago inicial en efectivo (opcional)" value={initialPayment} onChangeText={setInitialPayment} keyboardType="numeric" /></> : <View style={styles.planRequiredEmpty}><Ionicons name="alert-circle-outline" size={26} color={palette.warning}/><Text style={styles.planRequiredTitle}>No hay planes activos</Text><Text style={styles.planRequiredCopy}>Vuelve a Planes, crea o activa un plan y después registra el miembro.</Text></View>}</> : null}
      </KeyboardScrollContext.Provider>
    </ScrollView>
  </View>;
}

function PlanActions({ plan, onClose, onEdit, onReactivate, onDelete }: { plan: Plan | null; onClose: () => void; onEdit: () => void; onReactivate: () => void; onDelete: () => void }) {
  return <Sheet open={!!plan} title="Opciones del plan" onClose={onClose}>
    <View style={styles.planProfile}><View style={styles.planProfileIcon}><Ionicons name="pricetag-outline" size={23} color={palette.action}/></View><View style={styles.rowMain}><Text numberOfLines={2} ellipsizeMode="tail" style={styles.memberProfileName}>{plan?.name}</Text><Text style={styles.memberProfileMeta}>{plan?.durationDays} días · {plan ? money(plan.price) : ''}</Text><Text style={[styles.planProfileState, !plan?.isActive && styles.planProfileStateInactive]}>{plan?.isActive ? 'Disponible para nuevas membresías' : 'Plan inactivo'}</Text></View></View>
    <View style={styles.memberActionGrid}>
      <Pressable accessibilityRole="button" onPress={onEdit} style={({pressed}) => [styles.memberActionCard, pressed && styles.memberActionCardPressed]}><View style={styles.memberActionIcon}><Ionicons name="create-outline" size={20} color={palette.action}/></View><View style={styles.rowMain}><Text style={styles.memberActionTitle}>Editar plan</Text><Text style={styles.memberActionCopy}>Nombre, precio, duración, descripción y estado</Text></View><Ionicons name="chevron-forward" size={21} color={palette.secondary}/></Pressable>
      {plan && !plan.isActive ? <><Pressable accessibilityRole="button" accessibilityLabel="Reactivar plan" onPress={onReactivate} style={({pressed}) => [styles.memberActionCard, styles.memberActionCardPlan, pressed && styles.memberActionCardPressed]}><View style={[styles.memberActionIcon, styles.memberActionIconPlan]}><Ionicons name="refresh-outline" size={20} color={palette.action}/></View><View style={styles.rowMain}><Text style={styles.memberActionTitle}>Reactivar plan</Text><Text style={styles.memberActionCopy}>Volverá a estar disponible para nuevas membresías</Text></View><Ionicons name="chevron-forward" size={21} color={palette.secondary}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Eliminar plan inactivo" onPress={onDelete} style={({pressed}) => [styles.memberActionCard, styles.memberActionCardDelete, pressed && styles.memberActionCardPressed]}><View style={[styles.memberActionIcon, styles.memberActionIconDelete]}><Ionicons name="trash-outline" size={20} color={palette.danger}/></View><View style={styles.rowMain}><Text style={[styles.memberActionTitle, styles.memberActionDeleteText]}>Eliminar plan</Text><Text style={styles.memberActionCopy}>Solo se borrará si no compromete la trazabilidad</Text></View></Pressable></> : null}
    </View>
  </Sheet>;
}

function PlanForm({ scope, open, plan, onClose, onSaved }: FormProps & { plan: Plan | null }) {
  const [name, setName] = useState(''); const [price, setPrice] = useState(''); const [days, setDays] = useState('30'); const [description, setDescription] = useState(''); const [isActive, setIsActive] = useState(true); const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(0);
  const keyboardOpen = useKeyboardOpen();
  const scrollRef = useRef<ScrollView>(null);
  const revealFocusedInput = useRevealFocusedInput(scrollRef, 120);
  useEffect(() => { if (!open) return; setPage(0); setName(plan?.name ?? ''); setPrice(plan?.price ? String(plan.price) : ''); setDays(plan ? String(plan.durationDays) : '30'); setDescription(plan?.description ?? ''); setIsActive(plan?.isActive ?? true); }, [open, plan]);
  const save = async () => { setSaving(true); try { ensureActiveSubscription(); if (!await hasInternetConnection()) { showOnlineRequired(); return; } const input={ name:name.trim(), price:Number(price), durationDays:Number(days), description:description.trim(), isActive }; if (plan) await api.updatePlan(plan.id, input); else await api.createPlan(input); await syncNow(scope); Keyboard.dismiss(); showSuccess(plan ? 'Plan actualizado correctamente.' : 'Plan creado correctamente.'); onSaved(); } catch(error) { showError(error); } finally { setSaving(false); } };
  const pageValid = page === 0 ? !!name.trim() : !!price && Number(price) > 0 && !!days && Number(days) > 0;
  const goBack = () => { Keyboard.dismiss(); if (page > 0) setPage(0); else onClose(); };
  const goForward = () => { Keyboard.dismiss(); if (page === 0) setPage(1); else void save(); };
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { goBack(); return true; });
    return () => subscription.remove();
  }, [page, onClose]);
  return <View style={styles.memberFormPage}>
    <View style={styles.memberFormHeader}><View style={styles.memberFormHeaderRow}><Pressable accessibilityRole="button" accessibilityLabel={page > 0 ? 'Paso anterior' : 'Volver a planes'} onPress={goBack} style={({pressed}) => [styles.memberFormBack, pressed && styles.tabPressed]}><Ionicons name="arrow-back" size={19} color={activeDarkTheme ? darkPalette.text : palette.ink}/><Text style={styles.memberFormBackText}>{page > 0 ? 'Atrás' : 'Volver'}</Text></Pressable><Text style={styles.memberFormStep}>PASO {page + 1} DE 2</Text><Pressable accessibilityRole="button" disabled={!pageValid || saving} onPress={goForward} style={[styles.memberFormNext, (!pageValid || saving) && styles.disabled]}><Text style={styles.memberFormNextText}>{page === 1 ? saving ? 'Guardando…' : 'Guardar' : 'Siguiente'}</Text><Ionicons name={page === 1 ? 'checkmark' : 'arrow-forward'} size={16} color={palette.white}/></Pressable></View><View style={styles.memberFormProgress}>{[0,1].map((step) => <View key={step} style={[styles.memberFormProgressPart, step <= page && styles.memberFormProgressPartActive]}/>)}</View><Text style={styles.memberFormTitle}>{page === 0 ? 'Información del plan' : 'Precio y duración'}</Text><Text style={styles.memberFormCopy}>{plan ? 'Editando los datos del plan.' : 'Creando un nuevo plan.'}</Text></View>
    <ScrollView ref={scrollRef} key={page} style={styles.memberFormScroll} contentContainerStyle={[styles.memberFormContent, keyboardOpen && styles.memberFormContentKeyboard]} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} showsVerticalScrollIndicator={keyboardOpen}>
      <KeyboardScrollContext.Provider value={revealFocusedInput}>
      {page === 0 ? <><Field label="Nombre del plan" value={name} onChangeText={setName} /><Field label="Descripción (opcional)" value={description} onChangeText={(value) => setDescription(value.slice(0, 300))} maxLength={300} /></> : null}
      {page === 1 ? <><Field label={`Precio en ${activeCurrency}`} value={price} onChangeText={setPrice} keyboardType="numeric" /><Field label="Duración en días" value={days} onChangeText={setDays} keyboardType="number-pad" />{plan ? <><Text style={styles.fieldLabel}>Disponibilidad</Text><View style={styles.statusChoices}><Pressable onPress={() => setIsActive(true)} style={[styles.statusChoice, isActive && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, isActive && styles.statusChoiceTextActive]}>Activo</Text></Pressable><Pressable onPress={() => setIsActive(false)} style={[styles.statusChoice, !isActive && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, !isActive && styles.statusChoiceTextActive]}>Inactivo</Text></Pressable></View></> : null}</> : null}
      </KeyboardScrollContext.Provider>
    </ScrollView>
  </View>;
}

function AssignPlanForm({ scope, member, plans, onClose, onSaved }: { scope: string; member: Member | null; plans: Plan[]; onClose: () => void; onSaved: () => void }) {
  const membership = member ? editableMembership(member) : undefined;
  const membershipLocked = !!membership && effectiveMembershipStatus(membership) === 'ACTIVE';
  const availablePlans = plans.filter(plan => membershipLocked ? plan.id === membership.plan.id : plan.isActive || plan.id === membership?.plan.id);
  const [planId, setPlanId] = useState(''); const [periodCount, setPeriodCount] = useState(1); const [amount, setAmount] = useState(''); const [status, setStatus] = useState('ACTIVE'); const [saving, setSaving] = useState(false);
  useEffect(() => { setPlanId(membership?.plan.id ?? availablePlans.find(plan => plan.isActive)?.id ?? ''); setPeriodCount(1); setStatus(membership?.status ?? 'ACTIVE'); setAmount(''); }, [member, membership?.id, membership?.plan.id, membership?.status, plans]);
  const selectedPlan = availablePlans.find(plan => plan.id === planId);
  const previewEndDate = membership ? membership.endDate : selectedPlan ? addDays(new Date().toISOString(), selectedPlan.durationDays * periodCount) : undefined;
  const save = async () => { if (!member || !planId) return; setSaving(true); try { ensureActiveSubscription(); if (membership) await offline.updateMembership(scope, member.id, membership.id, { planId, status }); else await offline.assignPlan(scope, { memberId: member.id, planId, periodCount, ...(Number(amount) > 0 ? { initialPayment: Number(amount), paymentMethod: 'CASH' } : {}) }); showSuccess(membership && status === 'CANCELLED' ? 'Membresía cancelada y cobro anulado.' : membership ? 'Membresía actualizada.' : 'Membresía asignada correctamente.'); onSaved(); } catch (error) { showError(error); } finally { setSaving(false); } };
  return <Sheet open={!!member} title={`${membership ? 'Editar membresía' : 'Plan'} de ${member?.firstName ?? ''}`} onClose={onClose} footer={<PrimaryButton label={saving ? "Guardando…" : membership ? "Guardar cambios" : "Asignar plan"} disabled={saving || !planId} onPress={() => void save()} />}>
    {membership && <><View style={styles.currentPlanCard}><Text style={styles.currentMembershipLabel}>PLAN CONTRATADO</Text><Text style={styles.currentPlanName}>{contractedPlan(membership).name}</Text><Text style={styles.currentPlanMeta}>{money(Number(contractedPlan(membership).price) * (membership.periodCount ?? 1))} · {contractedPlan(membership).durationDays * (membership.periodCount ?? 1)} días · {membershipStatusLabel(effectiveMembershipStatus(membership))}</Text><Text style={styles.currentPlanMeta}>Desde {formatDate(membership.startDate)} · vence {formatDate(membership.endDate)}</Text></View><View style={styles.membershipExpiryPreview}><View><Text style={styles.membershipExpiryLabel}>{selectedPlan?.id!==membership.plan.id?'NUEVO VENCIMIENTO':'FECHA DE VENCIMIENTO'}</Text><Text style={styles.membershipExpiryDate}>{previewEndDate?formatDate(previewEndDate):'—'}</Text></View><Text style={styles.membershipExpiryDays}>{previewEndDate?remainingDaysLabel(previewEndDate):'—'}</Text></View></>}
    <Text style={styles.fieldLabel}>{membershipLocked?'Plan de la membresía':'Selecciona el plan'}</Text><View style={styles.choices}>{availablePlans.map(plan => <Pressable disabled={membershipLocked} key={plan.id} onPress={() => setPlanId(plan.id)} style={[styles.choice, planId === plan.id && styles.choiceActive]}><Text style={styles.choiceTitle}>{plan.name}{plan.id === membership?.plan.id ? ' · Actual' : ''}</Text><Text style={styles.choicePrice}>{money(plan.price)}</Text></Pressable>)}</View>
    {membership ? <><Text style={styles.fieldLabel}>Estado de la membresía</Text><View style={styles.statusChoices}>{['ACTIVE','CANCELLED'].map(value=><Pressable key={value} onPress={() => setStatus(value)} style={[styles.statusChoice, status === value && styles.statusChoiceActive]}><Text style={[styles.statusChoiceText, status === value && styles.statusChoiceTextActive]}>{membershipStatusLabel(value)}</Text></Pressable>)}</View></> : <><PeriodSelector value={periodCount} onChange={setPeriodCount}/>{selectedPlan?<MembershipPurchasePreview plan={selectedPlan} periodCount={periodCount} endDate={previewEndDate}/>:null}<Field label="Abono inicial (opcional)" value={amount} onChangeText={setAmount} keyboardType="numeric" /></>}
  </Sheet>;
}

function RenewMembershipForm({ scope, member, plans, onClose, onSaved }: { scope: string; member: Member | null; plans: Plan[]; onClose: () => void; onSaved: () => void }) {
  const current = member ? activeMembership(member) : undefined;
  const availablePlans = plans.filter(plan => plan.isActive);
  const [planId, setPlanId] = useState(''); const [periodCount, setPeriodCount] = useState(1); const [amount, setAmount] = useState(''); const [saving, setSaving] = useState(false);
  useEffect(() => { setPlanId(current && availablePlans.some(plan => plan.id===current.plan.id) ? current.plan.id : availablePlans[0]?.id ?? ''); setPeriodCount(1); setAmount(''); }, [member, current?.id, current?.plan.id, plans]);
  const selectedPlan = availablePlans.find(plan => plan.id===planId);
  const startDate = current?.endDate;
  const endDate = startDate&&selectedPlan ? addDays(startDate,selectedPlan.durationDays * periodCount) : undefined;
  const save = async () => { if (!member || !current || !planId) return; setSaving(true); try { ensureActiveSubscription(); await offline.renewMembership(scope,member.id,current.id,{ planId, periodCount, ...(Number(amount)>0?{initialPayment:Number(amount),paymentMethod:'CASH'}:{}) }); onSaved(); } catch(error) { showError(error); } finally { setSaving(false); } };
  return <Sheet open={!!member} title={`Programar renovación de ${member?.firstName ?? ''}`} onClose={onClose} footer={<PrimaryButton label={saving?'Programando…':'Programar renovación'} disabled={saving||!planId||!current} onPress={() => void save()}/>}>
    {current?<View style={styles.currentPlanCard}><Text style={styles.currentMembershipLabel}>PLAN CONTRATADO</Text><Text style={styles.currentPlanName}>{contractedPlan(current).name}</Text><Text style={styles.currentPlanMeta}>{money(contractedPlan(current).price)} · {contractedPlan(current).durationDays} días · Activa</Text><Text style={styles.currentPlanMeta}>Desde {formatDate(current.startDate)} · vence {formatDate(current.endDate)}</Text></View>:null}
    <Text style={styles.sheetCopy}>La membresía actual continuará activa hasta su vencimiento.</Text>
    <View style={styles.membershipExpiryPreview}><View><Text style={styles.membershipExpiryLabel}>PRÓXIMO PERÍODO</Text><Text style={styles.membershipExpiryDate}>{startDate?`Inicia ${formatDate(startDate)}`:'—'}</Text><Text style={styles.scheduledMembershipDates}>{endDate?`Vence ${formatDate(endDate)}`:'Selecciona un plan'}</Text></View><Text style={styles.membershipExpiryDays}>{selectedPlan?`${selectedPlan.durationDays * periodCount} días`:'—'}</Text></View>
    <Text style={styles.fieldLabel}>Plan de la renovación</Text><View style={styles.choices}>{availablePlans.map(plan=><Pressable key={plan.id} onPress={()=>setPlanId(plan.id)} style={[styles.choice,planId===plan.id&&styles.choiceActive]}><Text style={styles.choiceTitle}>{plan.name}{plan.id===current?.plan.id?' · Mismo plan':''}</Text><Text style={styles.choicePrice}>{money(plan.price)} · {plan.durationDays} días</Text></Pressable>)}</View>
    <PeriodSelector value={periodCount} onChange={setPeriodCount}/>{selectedPlan?<MembershipPurchasePreview plan={selectedPlan} periodCount={periodCount} endDate={endDate}/>:null}<Field label="Abono inicial (opcional)" value={amount} onChangeText={setAmount} keyboardType="numeric" />
  </Sheet>;
}

function ScheduledMembershipForm({ scope, member, plans, onClose, onSaved }: { scope: string; member: Member | null; plans: Plan[]; onClose: () => void; onSaved: () => void }) {
  const scheduled = member ? scheduledMembership(member) : undefined;
  const availablePlans = plans.filter(plan => plan.isActive || plan.id===scheduled?.plan.id);
  const [planId,setPlanId] = useState(''); const [saving,setSaving] = useState(false);
  useEffect(()=>setPlanId(scheduled?.plan.id ?? ''),[member,scheduled?.id,scheduled?.plan.id]);
  const selectedPlan=availablePlans.find(plan=>plan.id===planId);
  const previewEndDate=scheduled&&selectedPlan?addDays(scheduled.startDate,selectedPlan.durationDays * (scheduled.periodCount ?? 1)):undefined;
  const save=async()=>{ if(!member||!scheduled||!planId)return; setSaving(true); try { ensureActiveSubscription(); await offline.updateMembership(scope,member.id,scheduled.id,{planId,status:'SCHEDULED'}); onSaved(); } catch(error) { showError(error); } finally { setSaving(false); } };
  return <Sheet open={!!member} title="Editar renovación programada" onClose={onClose} footer={<PrimaryButton label={saving?'Guardando…':'Guardar cambios'} disabled={saving||!planId||!scheduled} onPress={()=>void save()}/>}>
    <View style={styles.membershipExpiryPreview}><View><Text style={styles.membershipExpiryLabel}>PERÍODO PROGRAMADO</Text><Text style={styles.membershipExpiryDate}>{scheduled?`Inicia ${formatDate(scheduled.startDate)}`:'—'}</Text><Text style={styles.scheduledMembershipDates}>{previewEndDate?`Vence ${formatDate(previewEndDate)}`:'—'}</Text></View><Text style={styles.membershipExpiryDays}>{selectedPlan?`${selectedPlan.durationDays * (scheduled?.periodCount ?? 1)} días`:'—'}</Text></View>
    <Text style={styles.fieldLabel}>Plan programado</Text><View style={styles.choices}>{availablePlans.map(plan=><Pressable key={plan.id} onPress={()=>setPlanId(plan.id)} style={[styles.choice,planId===plan.id&&styles.choiceActive]}><Text style={styles.choiceTitle}>{plan.name}{plan.id===scheduled?.plan.id?' · Actual':''}</Text><Text style={styles.choicePrice}>{money(plan.price)} · {plan.durationDays} días</Text></Pressable>)}</View>
  </Sheet>;
}

function PaymentForm({ scope, payment, onClose, onSaved }: { scope: string; payment: Payment | null; onClose: () => void; onSaved: () => void }) {
  const balance = payment ? Number(payment.amount) - Number(payment.paidAmount) : 0; const [amount, setAmount] = useState('');
  useEffect(() => setAmount(payment ? String(balance) : ''), [payment, balance]);
  return <Sheet open={!!payment} title="Registrar abono" onClose={onClose} footer={<PrimaryButton label="Confirmar cobro" disabled={!amount || Number(amount) <= 0 || Number(amount) > balance} onPress={() => { try { ensureActiveSubscription(); if (payment) void offline.applyPayment(scope, payment.id, { amount: Number(amount), method: 'CASH' }).then(() => { showSuccess('Cobro registrado correctamente.'); onSaved(); }).catch(showError); } catch(error) { showError(error); } }} />}><Text style={styles.sheetCopy}>Saldo de {payment?.member.firstName}: <Text style={styles.bold}>{money(balance)}</Text></Text><Field label="Importe recibido en efectivo" value={amount} onChangeText={setAmount} keyboardType="numeric" /></Sheet>;
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
  const names: Record<SyncIssue['type'], string> = { MEMBER_CREATE: 'Registrar miembro', MEMBER_UPDATE: 'Editar miembro', MEMBER_DELETE: 'Eliminar miembro', PLAN_CREATE: 'Crear plan', PLAN_UPDATE: 'Editar plan', PLAN_DELETE: 'Eliminar plan', MEMBERSHIP_ASSIGN: 'Asignar plan', MEMBERSHIP_UPDATE: 'Editar membresía', MEMBERSHIP_RENEW: 'Renovar plan', MEMBERSHIP_DELETE: 'Eliminar renovación', PAYMENT_APPLY: 'Registrar cobro' };
  return <Sheet open={open} title="Cambios por revisar" onClose={onClose}>
    <Text style={styles.sheetCopy}>El servidor rechazó estos cambios. Los datos válidos ya fueron sincronizados.</Text>
    {issues.map((issue) => <View key={issue.id} style={styles.issueCard}><Text style={styles.issueTitle}>{names[issue.type]}</Text><Text style={styles.issueDate}>{new Date(issue.occurredAt).toLocaleString('es-CU')}</Text><Text style={styles.issueError}>{issue.error}</Text><Pressable onPress={() => discardSyncIssue(scope, issue.id).then(load).catch(showError)}><Text style={styles.discard}>Descartar aviso</Text></Pressable></View>)}
    {!issues.length && <Empty text="No hay cambios pendientes de revisión" />}
  </Sheet>;
}

type FormProps = { scope: string; open: boolean; onClose: () => void; onSaved: () => void };
function Sheet({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
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
      <Animated.View style={[styles.sheet, { paddingBottom:Math.max(20,insets.bottom + 12) }, !!displayedFooter.current && keyboardOpen && styles.formSheet, { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange:[0,1], outputRange:[52,0] }) }, { scale: progress.interpolate({ inputRange:[0,1], outputRange:[.985,1] }) }] }]}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHead}><Text numberOfLines={2} ellipsizeMode="tail" maxFontSizeMultiplier={1.3} style={styles.sheetTitle}>{displayedTitle.current}</Text><Pressable accessibilityRole="button" accessibilityLabel="Cerrar modal" onPress={onClose} style={({pressed}) => [styles.closeButton, pressed && styles.closeButtonPressed]}><Ionicons name="close" size={25} color={activeDarkTheme ? darkPalette.secondary : palette.secondary}/></Pressable></View>
        <ScrollView ref={scrollRef} style={displayedFooter.current && keyboardOpen ? keyboardFixStyles.formScroll : keyboardFixStyles.sheetScroll} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} contentContainerStyle={keyboardFixStyles.sheetContent} showsVerticalScrollIndicator={!!displayedFooter.current} indicatorStyle={activeDarkTheme ? 'white' : 'black'} scrollEventThrottle={32} onLayout={(event) => updateScrollHint({ viewportHeight: event.nativeEvent.layout.height })} onContentSizeChange={(_width, height) => updateScrollHint({ contentHeight: height })} onScroll={(event) => updateScrollHint({ offsetY: event.nativeEvent.contentOffset.y })}><KeyboardScrollContext.Provider value={revealFocusedInput}>{displayedChildren.current}</KeyboardScrollContext.Provider></ScrollView>
        {displayedFooter.current ? <View style={styles.sheetFooter}>{showScrollHint ? <View pointerEvents="none" style={styles.scrollHint}><Text style={styles.scrollHintText}>Desliza para ver más</Text><Ionicons name="chevron-down" size={15} color={activeDarkTheme ? darkPalette.secondary : palette.secondary} /></View> : null}{displayedFooter.current}</View> : null}
      </Animated.View>
      </KeyboardAvoidingView>
    </View>
    <ToastHost active={mounted} priority={1} />
  </Modal>;
}
const keyboardFixStyles = StyleSheet.create({
  keyboardAvoiding: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  formScroll: { flex: 1 },
  sheetScroll: { flexShrink: 1 },
  sheetContent: { paddingBottom: 8 },
});
function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) { const revealFocusedInput = useContext(KeyboardScrollContext); const { label, onFocus, ...input } = props; return <View style={styles.field}><Text maxFontSizeMultiplier={1.35} style={styles.fieldLabel}>{label}</Text><TextInput placeholderTextColor={activeDarkTheme ? '#aab7b0' : '#657169'} maxFontSizeMultiplier={1.35} style={styles.input} {...input} onFocus={(event) => { onFocus?.(event); revealFocusedInput?.(event.nativeEvent.target); }} /></View>; }
function ProvinceField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open,setOpen]=useState(false);
  const select=(province:string)=>{onChange(province);setOpen(false);};
  return <View style={styles.field}><Text maxFontSizeMultiplier={1.35} style={styles.fieldLabel}>Provincia (opcional)</Text><Pressable accessibilityRole="button" accessibilityLabel="Seleccionar provincia" accessibilityState={{expanded:open}} onPress={()=>{Keyboard.dismiss();setOpen(true);}} style={({pressed})=>[styles.input,styles.provinceTrigger,pressed&&styles.tabPressed]}><Text style={[styles.provinceValue,!value&&styles.provincePlaceholder]}>{value||'Seleccionar provincia'}</Text><Ionicons name="chevron-down" size={18} color={activeDarkTheme?darkPalette.secondary:palette.secondary}/></Pressable><Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={()=>setOpen(false)}><View style={styles.provinceModalRoot}><Pressable accessibilityRole="button" accessibilityLabel="Cerrar selector" style={StyleSheet.absoluteFill} onPress={()=>setOpen(false)}/><SafeAreaView edges={['bottom']} style={styles.provinceSheet}><View style={styles.provinceHead}><Text style={styles.provinceTitle}>Selecciona tu provincia</Text><Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={()=>setOpen(false)} style={styles.closeButton}><Ionicons name="close" size={22} color={activeDarkTheme?darkPalette.text:palette.ink}/></Pressable></View><ScrollView showsVerticalScrollIndicator={false}><Pressable onPress={()=>select('')} style={[styles.provinceOption,!value&&styles.provinceOptionSelected]}><Text style={[styles.provinceOptionText,!value&&styles.provinceOptionTextSelected]}>Sin especificar</Text>{!value&&<Ionicons name="checkmark" size={19} color={palette.action}/>}</Pressable>{cubanProvinces.map(province=><Pressable key={province} onPress={()=>select(province)} style={[styles.provinceOption,value===province&&styles.provinceOptionSelected]}><Text style={[styles.provinceOptionText,value===province&&styles.provinceOptionTextSelected]}>{province}</Text>{value===province&&<Ionicons name="checkmark" size={19} color={palette.action}/>}</Pressable>)}</ScrollView></SafeAreaView></View></Modal></View>;
}
function PasswordField({ value, visible, onChangeText, onToggleVisibility, onSubmit }: { value: string; visible: boolean; onChangeText: (value: string) => void; onToggleVisibility: () => void; onSubmit: () => void }) { const revealFocusedInput = useContext(KeyboardScrollContext); return <View style={styles.field}><Text maxFontSizeMultiplier={1.35} style={styles.fieldLabel}>Contraseña</Text><View style={styles.passwordInputShell}><TextInput accessibilityLabel="Contraseña" value={value} onChangeText={onChangeText} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={onSubmit} placeholderTextColor={activeDarkTheme ? '#aab7b0' : '#657169'} maxFontSizeMultiplier={1.35} style={styles.passwordInput} onFocus={(event) => revealFocusedInput?.(event.nativeEvent.target)}/><Pressable accessibilityRole="button" accessibilityLabel={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} accessibilityState={{expanded:visible}} onPress={onToggleVisibility} style={({pressed}) => [styles.passwordVisibilityButton, pressed && styles.tabPressed]}><Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={21} color={activeDarkTheme ? darkPalette.secondary : palette.secondary}/></Pressable></View></View>; }
function PrimaryButton({ label, icon, onPress, disabled }: { label: string; icon?: TabIconName; onPress: () => void; disabled?: boolean }) { return <Pressable accessibilityRole="button" accessibilityState={{disabled:!!disabled}} onPress={onPress} disabled={disabled} style={({pressed}) => [styles.primary, disabled && styles.disabled, pressed && styles.tabPressed]}>{icon ? <Ionicons name={icon} size={20} color={palette.white}/> : null}<Text maxFontSizeMultiplier={1.3} style={styles.primaryText}>{label}</Text></Pressable>; }
function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityState={{selected:active}} onPress={onPress} style={[styles.paymentFilterChip,active&&styles.paymentFilterChipActive]}><Text style={[styles.paymentFilterChipText,active&&styles.paymentFilterChipTextActive]}>{label}</Text></Pressable>; }
function PeriodSelector({ value, onChange }: { value: number; onChange: (value: number) => void }) { return <><Text style={styles.fieldLabel}>Cantidad de períodos</Text><View style={styles.periodStepper}><Pressable accessibilityRole="button" accessibilityLabel="Reducir períodos" disabled={value<=1} onPress={() => onChange(Math.max(1,value-1))} style={({pressed})=>[styles.periodStepButton,value<=1&&styles.disabled,pressed&&styles.tabPressed]}><Ionicons name="remove" size={21} color={activeDarkTheme?darkPalette.text:palette.ink}/></Pressable><View style={styles.periodStepValue}><Text style={styles.periodStepNumber}>{value}</Text><Text style={styles.periodStepCaption}>{value===1?'PERÍODO':'PERÍODOS'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Aumentar períodos" disabled={value>=24} onPress={() => onChange(Math.min(24,value+1))} style={({pressed})=>[styles.periodStepButton,value>=24&&styles.disabled,pressed&&styles.tabPressed]}><Ionicons name="add" size={21} color={activeDarkTheme?darkPalette.text:palette.ink}/></Pressable></View></>; }
function MembershipPurchasePreview({ plan, periodCount, endDate }: { plan: Plan; periodCount: number; endDate?: string }) { return <View style={styles.purchasePreview}><View><Text style={styles.purchasePreviewLabel}>TOTAL</Text><Text style={styles.purchasePreviewValue}>{money(Number(plan.price) * periodCount)}</Text><Text style={styles.purchasePreviewMeta}>{plan.durationDays * periodCount} días · {periodCount} período{periodCount===1?'':'s'}</Text></View><View><Text style={[styles.purchasePreviewLabel,styles.paymentAmountRight]}>VENCIMIENTO</Text><Text style={styles.purchasePreviewDate}>{endDate?formatDate(endDate):'—'}</Text></View></View>; }
function Metric({ label, value, wide }: { label: string; value: string | number; wide?: boolean }) { return <View style={[styles.metric, wide && styles.metricWide]}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>; }
function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) { return <View style={styles.sectionTitle}><Text style={styles.sectionHeading}>{title}</Text><Text style={styles.sectionCopy}>{subtitle}</Text></View>; }
function Row({ title, subtitle, value }: { title: string; subtitle: string; value: string }) { return <View style={styles.paymentRow}><View style={styles.rowMain}><Text numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.35} style={styles.rowTitle}>{title}</Text><Text maxFontSizeMultiplier={1.3} style={styles.rowSubtitle}>{subtitle}</Text></View><Text numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.25} style={styles.income}>{value}</Text></View>; }
function Empty({ text }: { text: string }) { return <Text style={styles.empty}>{text}</Text>; }
function showError(error: unknown) { publishErrorToast(error instanceof Error ? error.message : typeof error === 'string' ? error : 'Ocurrió un error'); }
function showSuccess(message: string) { publishToast(message, 'success'); }
function showPending(message: string) { publishToast(message, 'warning'); }
function showRejected(message: string) { publishToast(message, 'rejected'); }
async function hasInternetConnection() { const state=await Network.getNetworkStateAsync().catch(() => null); return state?.isConnected !== false; }
function showOnlineRequired() { showError(new Error('Debes conectarte a internet para crear, editar o eliminar planes.')); }
function effectiveMembershipStatus(membership: Membership) { const now=Date.now(); if ((membership.status === 'ACTIVE' || membership.status === 'SCHEDULED') && new Date(membership.endDate).getTime() < now) return 'EXPIRED'; if (membership.status === 'SCHEDULED' && new Date(membership.startDate).getTime() <= now) return 'ACTIVE'; return membership.status; }
function activeMembership(member: Member) { return member.memberships.find(membership => effectiveMembershipStatus(membership) === 'ACTIVE'); }
function scheduledMembership(member: Member) { return member.memberships.find(membership => membership.status === 'SCHEDULED' && new Date(membership.startDate).getTime() > Date.now()); }
function upcomingMembership(member: Member) { if (member.status !== 'ACTIVE') return undefined; const membership=activeMembership(member); if (!membership) return undefined; const limit=new Date(); limit.setDate(limit.getDate()+10); limit.setHours(23,59,59,999); return new Date(membership.endDate).getTime() <= limit.getTime() ? membership : undefined; }
function editableMembership(member: Member) { return activeMembership(member); }
function hasExpiredMembership(member: Member) { const latest=member.memberships[0]; return member.status === 'ACTIVE' && !!latest && effectiveMembershipStatus(latest) === 'EXPIRED' && !activeMembership(member) && !scheduledMembership(member); }
function membershipStatusLabel(status: string) { return ({ ACTIVE:'Activa', SCHEDULED:'Programada', EXPIRED:'Vencida', CANCELLED:'Cancelada' } as Record<string,string>)[status] ?? status; }
function sexLabel(sex?: MemberSex | null) { return sex ? ({ MALE:'Masculino', FEMALE:'Femenino', OTHER:'Otro' } as Record<MemberSex,string>)[sex] : ''; }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleDateString('es-CU', { day:'2-digit', month:'short', year:'numeric' }) : 'Sin fecha'; }
function formatDateTime(value: string) { return new Date(value).toLocaleString('es-CU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
function remainingDaysLabel(value: string) { const days=Math.max(0,Math.ceil((new Date(value).getTime()-Date.now())/86_400_000)); return `${days} día${days === 1 ? '' : 's'} restante${days === 1 ? '' : 's'}`; }
function addDays(value: string, days: number) { const date=new Date(value); date.setDate(date.getDate()+days); return date.toISOString(); }
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

function withReadableType<T extends StyleSheet.NamedStyles<T>>(source: T): T {
  Object.values(source).forEach(style => {
    const textStyle = style as { fontSize?: number };
    if (typeof textStyle.fontSize === 'number' && textStyle.fontSize <= 10) textStyle.fontSize = 12;
  });
  return source;
}

const baseStyles = StyleSheet.create(withReadableType({
  center:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:palette.brand},app:{flex:1,backgroundColor:palette.background},content:{flex:1},minTouch:{minHeight:44},
  errorToastLayer:{...StyleSheet.absoluteFillObject,zIndex:1000,elevation:30},errorToast:{position:'absolute',top:Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 10 : 54,left:14,right:14,minHeight:72,padding:13,flexDirection:'row',alignItems:'flex-start',gap:10,borderWidth:1,borderColor:'#f8b4ad',borderRadius:15,backgroundColor:'#b42318',shadowColor:'#7a1710',shadowOffset:{width:0,height:6},shadowOpacity:.3,shadowRadius:12,elevation:24},successToast:{borderColor:'#7cc89f',backgroundColor:'#167247',shadowColor:'#0b4a2d'},warningToast:{borderColor:'#f3c26b',backgroundColor:'#a86108',shadowColor:'#6f3c03'},errorToastBody:{flex:1},errorToastTitle:{color:'#fff',fontSize:13,fontWeight:'900'},errorToastMessage:{marginTop:3,color:'#fff',fontSize:12,lineHeight:17,fontWeight:'600'},errorToastClose:{width:44,height:44,marginTop:-7,marginRight:-7,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:'#ffffff1f'},
  loginPage:{flex:1,backgroundColor:palette.brand,paddingHorizontal:24,paddingTop:36},loginKeyboardAvoiding:{flex:1},loginScroll:{flexGrow:1},loginBrand:{marginTop:8,color:palette.white,fontSize:22,fontWeight:'800'},mini:{color:palette.accent,fontSize:11,letterSpacing:2},loginTitle:{marginTop:44,color:palette.white,fontSize:34,fontWeight:'800',letterSpacing:-1.2},loginCopy:{marginTop:10,color:'#c4d5cd',fontSize:15,lineHeight:22},loginCard:{marginTop:34,padding:20,borderRadius:20,backgroundColor:palette.white},loginJoin:{marginTop:20,alignItems:'center',gap:4},loginJoinText:{color:'#c4d5cd',fontSize:13},loginJoinLink:{color:palette.accent,fontSize:13,fontWeight:'800',textDecorationLine:'underline'},version:{marginTop:'auto',marginBottom:24,textAlign:'center',color:'#a9c3b7',fontSize:10,letterSpacing:2},
  registerScroll:{flexGrow:1,paddingBottom:28},authBack:{minHeight:44,marginLeft:-8,flexDirection:'row',alignItems:'center',gap:7,alignSelf:'flex-start',paddingHorizontal:8},authBackText:{color:palette.white,fontSize:13,fontWeight:'800'},registerTitle:{marginTop:24,color:palette.white,fontSize:31,fontWeight:'800',letterSpacing:-1},registrationNote:{marginTop:2,marginBottom:4,color:palette.secondary,fontSize:11,lineHeight:16,fontWeight:'600'},forgotPasswordButton:{minHeight:36,alignSelf:'flex-end',justifyContent:'center'},forgotPasswordText:{color:palette.action,fontSize:11,fontWeight:'900'},resendCodeButton:{minHeight:42,alignItems:'center',justifyContent:'center'},
  offerPage:{flex:1,backgroundColor:palette.background},offerScroll:{flexGrow:1,paddingHorizontal:22,paddingTop:28,paddingBottom:24},offerBrand:{color:palette.brand,fontSize:22,fontWeight:'900'},offerMini:{color:palette.action,fontSize:11,letterSpacing:2},offerEyebrow:{marginTop:38,color:palette.action,fontSize:10,fontWeight:'900',letterSpacing:1.25},offerTitle:{marginTop:8,color:palette.ink,fontSize:30,lineHeight:35,fontWeight:'900',letterSpacing:-1},offerCopy:{marginTop:10,color:palette.secondary,fontSize:14,lineHeight:21},offerList:{marginTop:26,gap:12},offerCard:{minHeight:94,padding:14,flexDirection:'row',alignItems:'center',gap:12,borderWidth:1,borderColor:palette.line,borderRadius:18,backgroundColor:palette.white},offerCardFeatured:{borderColor:'#83b79d',backgroundColor:'#f2faf5'},offerCardDisabled:{opacity:.65},offerIcon:{width:45,height:45,borderRadius:14,alignItems:'center',justifyContent:'center',backgroundColor:'#e5f2e9'},offerIconFeatured:{backgroundColor:palette.action},offerCardTitle:{color:palette.ink,fontSize:15,fontWeight:'900'},offerCardDetail:{marginTop:5,color:palette.secondary,fontSize:10,fontWeight:'700'},offerPriceWrap:{alignItems:'flex-end',gap:8},offerPrice:{color:palette.action,fontSize:12,fontWeight:'900'},trialProtection:{marginTop:18,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6},trialProtectionText:{flex:1,color:palette.secondary,fontSize:10,lineHeight:15,fontWeight:'700'},offerLogout:{minHeight:44,marginTop:'auto',alignItems:'center',justifyContent:'center'},offerLogoutText:{color:palette.secondary,fontSize:12,fontWeight:'800'},pendingCard:{marginTop:28,padding:22,borderWidth:1,borderColor:'#ead7bd',borderRadius:22,backgroundColor:palette.white},pendingIcon:{width:54,height:54,borderRadius:18,alignItems:'center',justifyContent:'center',backgroundColor:'#fff1df'},pendingTitle:{marginTop:8,color:palette.ink,fontSize:25,fontWeight:'900'},pendingCopy:{marginTop:10,color:palette.secondary,fontSize:13,lineHeight:20},requestCode:{marginTop:22,padding:15,alignItems:'center',gap:6,borderRadius:14,backgroundColor:'#f2f5f3'},requestCodeLabel:{color:palette.secondary,fontSize:9,fontWeight:'900',letterSpacing:1},requestCodeValue:{color:palette.action,fontSize:24,fontWeight:'900',letterSpacing:1.5},pendingPlan:{marginTop:12,paddingVertical:12,flexDirection:'row',justifyContent:'space-between',gap:12,borderBottomWidth:1,borderBottomColor:palette.line},pendingPlanLabel:{color:palette.secondary,fontSize:11,fontWeight:'700'},pendingPlanValue:{color:palette.ink,fontSize:11,fontWeight:'900'},pendingActions:{marginTop:20,gap:12},offerWhatsapp:{height:49,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderRadius:13,backgroundColor:'#1fa855'},offerWhatsappText:{color:palette.white,fontSize:12,fontWeight:'900'},changePlanButton:{minHeight:44,marginTop:4,alignItems:'center',justifyContent:'center'},changePlanText:{color:palette.action,fontSize:11,fontWeight:'900'},
  topbar:{paddingTop:18,paddingHorizontal:20,paddingBottom:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,backgroundColor:palette.background},topbarTitle:{flex:1,minWidth:0},kicker:{color:palette.action,fontSize:11,fontWeight:'800',letterSpacing:1.2},screenTitle:{marginTop:3,fontSize:27,fontWeight:'800',color:palette.ink,letterSpacing:-.8},avatar:{width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center',backgroundColor:palette.accent},
  syncBar:{minHeight:44,marginHorizontal:16,marginBottom:4,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:9,borderRadius:12,backgroundColor:'#e8f5ce'},syncOffline:{backgroundColor:'#fff4e8'},syncError:{backgroundColor:'#fee9e5'},syncDot:{width:9,height:9,borderRadius:5,backgroundColor:palette.warning},syncDotOk:{backgroundColor:palette.action},syncMain:{flex:1},syncTitle:{color:palette.ink,fontSize:11,fontWeight:'800'},syncDetail:{marginTop:1,color:palette.secondary,fontSize:9},syncAction:{color:palette.action,fontSize:10,fontWeight:'800'},
  accountScroll:{padding:16,paddingBottom:40},accountHero:{padding:26,alignItems:'center',borderRadius:22,backgroundColor:palette.brand},accountHeroLabel:{color:'#c4d5cd',fontSize:9,fontWeight:'800',letterSpacing:1.3},accountHeroGym:{marginTop:8,color:palette.white,fontSize:23,fontWeight:'900',textAlign:'center'},accountCard:{marginTop:12,paddingHorizontal:17,borderWidth:1,borderColor:palette.line,borderRadius:17,backgroundColor:palette.white},accountRow:{minHeight:61,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:18,borderBottomWidth:1,borderBottomColor:'#edf0ee'},accountRowLast:{borderBottomWidth:0},accountLabel:{color:palette.secondary,fontSize:10,fontWeight:'700'},accountValue:{flex:1,color:palette.ink,fontSize:12,fontWeight:'800',textAlign:'right'},securityButton:{minHeight:69,marginTop:12,padding:13,flexDirection:'row',alignItems:'center',gap:12,borderWidth:1,borderColor:palette.line,borderRadius:15,backgroundColor:palette.white},securityIcon:{width:42,height:42,alignItems:'center',justifyContent:'center',borderRadius:13,backgroundColor:'#e5f2e9'},securityTitle:{color:palette.ink,fontSize:13,fontWeight:'900'},securityCopy:{marginTop:4,color:palette.secondary,fontSize:9},supportButton:{minHeight:69,marginTop:12,padding:13,flexDirection:'row',alignItems:'center',gap:12,borderRadius:15,backgroundColor:'#1fa855'},supportIcon:{width:42,height:42,alignItems:'center',justifyContent:'center',borderRadius:13,backgroundColor:'#ffffff24'},supportTitle:{color:palette.white,fontSize:13,fontWeight:'900'},supportCopy:{marginTop:4,color:'#e7f7ed',fontSize:9},logoutButton:{minHeight:69,marginTop:18,padding:13,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:'#efcec9',borderRadius:15,backgroundColor:'#fff9f8'},logoutButtonPressed:{opacity:.7},logoutIcon:{width:42,height:42,marginRight:12,alignItems:'center',justifyContent:'center',borderRadius:13,backgroundColor:'#fee5e1'},logoutIconText:{color:palette.danger,fontSize:20,fontWeight:'900'},logoutTitle:{color:palette.danger,fontSize:13,fontWeight:'900'},logoutCopy:{marginTop:4,color:palette.secondary,fontSize:9},accountVersion:{marginTop:28,color:palette.secondary,fontSize:9,letterSpacing:1.2,textAlign:'center'},
  subscriptionCard:{marginTop:12,padding:17,borderWidth:1,borderColor:'#cfe3d6',borderRadius:17,backgroundColor:'#f4faf6'},subscriptionCardExpired:{borderColor:'#efc9c3',backgroundColor:'#fff8f7'},subscriptionHead:{flexDirection:'row',alignItems:'center',gap:11},subscriptionIcon:{width:43,height:43,alignItems:'center',justifyContent:'center',borderRadius:14,backgroundColor:'#e2f3e8'},subscriptionIconExpired:{backgroundColor:'#fee7e3'},subscriptionEyebrow:{color:palette.secondary,fontSize:8,fontWeight:'900',letterSpacing:.7},subscriptionName:{marginTop:4,color:palette.action,fontSize:15,fontWeight:'900'},subscriptionNameExpired:{color:palette.danger},subscriptionBadge:{paddingVertical:5,paddingHorizontal:8,borderRadius:10,backgroundColor:'#e1f4e8'},subscriptionBadgeExpired:{backgroundColor:'#fee7e3'},subscriptionBadgeText:{color:palette.action,fontSize:8,fontWeight:'900'},subscriptionBadgeTextExpired:{color:palette.danger},subscriptionDates:{marginTop:15,paddingTop:13,flexDirection:'row',alignItems:'flex-end',justifyContent:'space-between',gap:12,borderTopWidth:1,borderTopColor:'#dbe9df'},subscriptionDateLabel:{color:palette.secondary,fontSize:8,fontWeight:'900',letterSpacing:.7},subscriptionDateValue:{marginTop:5,color:palette.ink,fontSize:12,fontWeight:'800'},subscriptionRemaining:{color:palette.action,fontSize:9,fontWeight:'800'},subscriptionExpiredCopy:{marginTop:14,color:palette.danger,fontSize:10,lineHeight:15,fontWeight:'700'},whatsappButton:{height:47,marginTop:13,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderRadius:12,backgroundColor:'#1fa855'},whatsappButtonText:{color:palette.white,fontSize:11,fontWeight:'900'},
  subscriptionActionCopy:{marginTop:14,color:palette.secondary,fontSize:10,lineHeight:15,fontWeight:'700'},subscriptionActionGroup:{marginTop:13,gap:8},planRequestButton:{minHeight:47,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderRadius:12,backgroundColor:palette.action},planRequestButtonSecondary:{borderWidth:1,borderColor:'#b9d8c5',backgroundColor:'#f7fbf8'},planRequestButtonText:{color:palette.white,fontSize:11,fontWeight:'900'},planRequestButtonTextSecondary:{color:palette.action},whatsappButtonInGroup:{marginTop:0},whatsappButtonSecondary:{borderWidth:1,borderColor:'#b9d8c5',backgroundColor:'#f7fbf8'},whatsappButtonTextSecondary:{color:palette.action},
  accountPendingRequest:{marginTop:12,gap:9},accountRequestCode:{padding:11,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10,borderRadius:10,backgroundColor:'#fff1df'},accountRequestLabel:{color:'#996018',fontSize:9,fontWeight:'900',letterSpacing:.7},accountRequestValue:{color:'#996018',fontSize:16,fontWeight:'900',letterSpacing:1},accountRequestedPlan:{color:palette.ink,fontSize:11,fontWeight:'800',textAlign:'center'},
  themeCard:{marginTop:14,padding:17,borderWidth:1,borderColor:palette.line,borderRadius:17,backgroundColor:palette.white},themeTitle:{color:palette.ink,fontSize:15,fontWeight:'900'},themeCopy:{marginTop:4,color:palette.secondary,fontSize:10,lineHeight:14},themeOptions:{marginTop:14,gap:8},themeOption:{minHeight:57,paddingHorizontal:13,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:palette.line,borderRadius:12,backgroundColor:'#fbfcfb'},themeOptionActive:{borderColor:palette.action,backgroundColor:'#eef7e1'},themeOptionPressed:{opacity:.76},themeOptionTitle:{color:palette.ink,fontSize:12,fontWeight:'800'},themeOptionTitleActive:{color:palette.action},themeOptionCopy:{marginTop:3,color:palette.secondary,fontSize:9},themeRadio:{width:19,height:19,marginLeft:12,alignItems:'center',justifyContent:'center',borderWidth:2,borderColor:'#9aa69f',borderRadius:10},themeRadioActive:{borderColor:palette.action},themeRadioDot:{width:9,height:9,borderRadius:5,backgroundColor:palette.action},
  scroll:{padding:16,paddingBottom:35},hero:{padding:24,borderRadius:20,backgroundColor:palette.brand},heroLabel:{color:'#c4d5cd',fontSize:10,fontWeight:'700',letterSpacing:1.3},heroValue:{marginTop:9,color:palette.white,fontSize:30,fontWeight:'800',letterSpacing:-1},heroHint:{marginTop:7,color:palette.accent,fontSize:11},metricGrid:{marginTop:12,flexDirection:'row',flexWrap:'wrap',gap:10},metric:{width:'48.3%',padding:17,borderWidth:1,borderColor:palette.line,borderRadius:15,backgroundColor:palette.white},metricWide:{width:'100%'},metricLabel:{color:palette.secondary,fontSize:11},metricValue:{marginTop:9,color:palette.ink,fontSize:21,fontWeight:'800'},
  upcomingCard:{marginTop:14,padding:16,borderWidth:1,borderColor:'#f1d2b2',borderRadius:17,backgroundColor:'#fff8ef'},upcomingHead:{flexDirection:'row',alignItems:'center',gap:10},upcomingIcon:{width:38,height:38,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:'#ffecd3'},upcomingTitle:{color:palette.ink,fontSize:13,fontWeight:'900'},upcomingCopy:{marginTop:3,color:palette.secondary,fontSize:9},upcomingCount:{minWidth:32,height:32,paddingHorizontal:8,alignItems:'center',justifyContent:'center',borderRadius:16,backgroundColor:palette.warning},upcomingCountText:{color:palette.white,fontSize:12,fontWeight:'900'},upcomingRow:{marginTop:12,paddingTop:11,flexDirection:'row',alignItems:'center',gap:12,borderTopWidth:1,borderTopColor:'#f1d2b2'},upcomingName:{color:palette.ink,fontSize:11,fontWeight:'800'},upcomingPlan:{marginTop:3,color:palette.secondary,fontSize:9},upcomingDate:{color:palette.warning,fontSize:9,fontWeight:'900',textAlign:'right'},upcomingDays:{marginTop:3,color:palette.secondary,fontSize:8,textAlign:'right'},upcomingAction:{marginTop:13,paddingTop:12,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,borderTopWidth:1,borderTopColor:'#f1d2b2'},upcomingActionText:{color:palette.warning,fontSize:10,fontWeight:'900'},upcomingEmpty:{marginTop:13,color:palette.secondary,fontSize:10,textAlign:'center'},
  sectionTitle:{marginTop:26,marginBottom:10},sectionHeading:{fontSize:18,fontWeight:'800',color:palette.ink},sectionCopy:{marginTop:3,color:palette.secondary,fontSize:11},card:{overflow:'hidden',borderWidth:1,borderColor:palette.line,borderRadius:16,backgroundColor:palette.white},paymentRow:{minHeight:65,padding:14,flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderBottomColor:'#edf0ee'},rowMain:{flex:1},rowTitle:{fontSize:13,fontWeight:'700',color:palette.ink},rowSubtitle:{marginTop:4,color:palette.secondary,fontSize:10},income:{color:palette.action,fontSize:12,fontWeight:'800'},empty:{padding:26,textAlign:'center',color:palette.secondary},logoutHint:{marginTop:28,textAlign:'center',color:palette.secondary,fontSize:10},
  statisticsTabs:{marginBottom:15,padding:4,flexDirection:'row',gap:4,borderWidth:1,borderColor:palette.line,borderRadius:15,backgroundColor:palette.white},statisticsTab:{minHeight:44,flex:1,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5,borderRadius:11},statisticsTabActive:{backgroundColor:'#e8f5ce'},statisticsTabText:{color:palette.secondary,fontSize:11,fontWeight:'800'},statisticsTabTextActive:{color:palette.action},statisticsHero:{padding:20,flexDirection:'row',alignItems:'center',gap:14,borderRadius:20,backgroundColor:palette.brand},statisticsEyebrow:{color:'#c4d5cd',fontSize:10,fontWeight:'900',letterSpacing:1.1},statisticsHeroValue:{marginTop:5,color:palette.white,fontSize:34,fontWeight:'900'},statisticsHeroCopy:{marginTop:3,color:'#c4d5cd',fontSize:11},variationBadge:{maxWidth:'48%',paddingVertical:9,paddingHorizontal:11,flexDirection:'row',alignItems:'center',gap:5,borderRadius:12,backgroundColor:'#e8f5ce'},variationBadgeDown:{backgroundColor:'#fee9e5'},variationText:{color:palette.action,fontSize:11,fontWeight:'900'},variationTextDown:{color:palette.danger},statisticsCard:{padding:16,borderWidth:1,borderColor:palette.line,borderRadius:16,backgroundColor:palette.white},barList:{gap:15},barRow:{gap:6},barLabels:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},barLabel:{color:palette.secondary,fontSize:12,fontWeight:'700'},barValue:{color:palette.ink,fontSize:12,fontWeight:'900'},barTrack:{height:9,overflow:'hidden',borderRadius:5,backgroundColor:'#edf1ee'},barFill:{height:'100%',borderRadius:5,backgroundColor:palette.action},statisticsNotice:{marginTop:14,padding:13,flexDirection:'row',alignItems:'flex-start',gap:9,borderWidth:1,borderColor:'#e5ddd0',borderRadius:13,backgroundColor:'#fffbf4'},statisticsNoticeText:{flex:1,color:palette.secondary,fontSize:11,lineHeight:17,fontWeight:'600'},statusComparison:{gap:10},statusRatio:{padding:15,borderWidth:1,borderColor:palette.line,borderRadius:15,backgroundColor:palette.white},statusRatioTitle:{marginBottom:10,color:palette.ink,fontSize:13,fontWeight:'900'},ratioTrack:{height:11,overflow:'hidden',borderRadius:6,backgroundColor:'#e8ddd8'},ratioFill:{height:'100%',borderRadius:6,backgroundColor:palette.action},ratioLegend:{marginTop:9,flexDirection:'row',justifyContent:'space-between',gap:10},ratioPrimary:{flex:1,color:palette.action,fontSize:10,fontWeight:'800'},ratioSecondary:{flex:1,textAlign:'right',color:palette.secondary,fontSize:10,fontWeight:'700'},planStatisticCard:{marginBottom:10,padding:15,borderWidth:1,borderColor:palette.line,borderRadius:16,backgroundColor:palette.white},planStatisticHead:{flexDirection:'row',alignItems:'center'},planRank:{width:34,height:34,marginRight:10,alignItems:'center',justifyContent:'center',borderRadius:11,backgroundColor:'#e8f5ce'},planRankText:{color:palette.action,fontSize:13,fontWeight:'900'},planStatisticName:{color:palette.ink,fontSize:14,fontWeight:'900'},planStatisticRevenue:{marginTop:3,color:palette.action,fontSize:11,fontWeight:'800'},planStatisticGrid:{marginTop:14,paddingTop:13,flexDirection:'row',gap:8,borderTopWidth:1,borderTopColor:palette.line},statisticValue:{flex:1},statisticValueLabel:{color:palette.secondary,fontSize:8,fontWeight:'900',letterSpacing:.4},statisticValueNumber:{marginTop:5,color:palette.ink,fontSize:13,fontWeight:'900'},debtOverdue:{color:palette.danger,fontWeight:'800'},debtAmount:{marginLeft:10,color:palette.danger,fontSize:12,fontWeight:'900'},
  paymentFilters:{marginTop:14,padding:15,borderWidth:1,borderColor:palette.line,borderRadius:17,backgroundColor:palette.white},paymentFilterTitle:{color:palette.ink,fontSize:14,fontWeight:'900'},paymentFilterLabel:{marginTop:13,marginBottom:7,color:palette.secondary,fontSize:11,fontWeight:'900',letterSpacing:.7,textTransform:'uppercase'},paymentFilterOptions:{gap:7,paddingRight:5},paymentFilterChip:{minHeight:44,paddingHorizontal:14,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:palette.line,borderRadius:22,backgroundColor:'#fbfcfb'},paymentFilterChipActive:{borderColor:palette.action,backgroundColor:'#e8f5ce'},paymentFilterChipText:{color:palette.secondary,fontSize:11,fontWeight:'800'},paymentFilterChipTextActive:{color:palette.action},paymentFilterFooter:{marginTop:15,paddingTop:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10,borderTopWidth:1,borderTopColor:'#edf0ee'},paymentFilterResult:{flex:1,color:palette.secondary,fontSize:11,lineHeight:16},excelButton:{minWidth:104,minHeight:44,paddingHorizontal:13,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,borderRadius:11,backgroundColor:palette.action},excelButtonText:{color:palette.white,fontSize:12,fontWeight:'900'},paymentList:{gap:12},listSeparator:{height:12},paymentDetailRow:{padding:16,borderWidth:1,borderColor:palette.line,borderRadius:16,backgroundColor:palette.white,shadowColor:palette.brand,shadowOffset:{width:0,height:3},shadowOpacity:.06,shadowRadius:8,elevation:2},paymentDetailRowCancelled:{borderColor:'#efc9c3',backgroundColor:'#fff8f7'},paymentDetailRowPressed:{borderColor:'#b9cfbf',backgroundColor:'#f5f8f6'},paymentDetailHead:{flexDirection:'row',alignItems:'flex-start',gap:10},paymentBadge:{minHeight:28,paddingVertical:5,paddingHorizontal:9,justifyContent:'center',borderRadius:12,backgroundColor:'#fff0d8'},paymentBadgeSuccess:{backgroundColor:'#e1f4e8'},paymentBadgeDanger:{backgroundColor:'#fee6e2'},paymentBadgeText:{color:'#996018',fontSize:10,fontWeight:'900'},paymentBadgeTextSuccess:{color:palette.action},paymentBadgeTextDanger:{color:palette.danger},paymentAmounts:{marginTop:14,flexDirection:'row',justifyContent:'space-between'},paymentAmountLabel:{color:palette.secondary,fontSize:10,fontWeight:'800',letterSpacing:.8},paymentAmountRight:{textAlign:'right'},paymentPaid:{marginTop:4,color:palette.action,fontSize:14,fontWeight:'900'},paymentPaidCancelled:{color:palette.danger,textDecorationLine:'line-through'},paymentTotal:{marginTop:4,color:palette.ink,fontSize:14,fontWeight:'900',textAlign:'right'},paymentTotalCancelled:{color:palette.danger,textDecorationLine:'line-through'},paymentProgress:{height:5,marginTop:12,overflow:'hidden',borderRadius:3,backgroundColor:'#e8ece9'},paymentProgressFill:{height:'100%',borderRadius:3,backgroundColor:palette.action},paymentOperations:{marginTop:13,paddingTop:10,borderTopWidth:1,borderTopColor:'#edf0ee'},paymentOperationsTitle:{marginBottom:3,color:palette.secondary,fontSize:10,fontWeight:'900',letterSpacing:.8},paymentOperation:{minHeight:44,paddingVertical:7,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},paymentOperationAmount:{color:palette.action,fontSize:12,fontWeight:'800'},paymentOperationDate:{color:palette.secondary,fontSize:11},paymentNoOperations:{marginTop:11,color:palette.secondary,fontSize:11},paymentBalanceCopy:{marginTop:8,color:palette.warning,fontSize:11,fontWeight:'800'},paymentCancelledCopy:{marginTop:10,paddingTop:9,borderTopWidth:1,borderTopColor:'#efc9c3',color:palette.danger,fontSize:11,fontWeight:'800'},
  memberSearch:{height:52,marginTop:14,paddingLeft:14,paddingRight:4,gap:10,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:palette.line,borderRadius:14,backgroundColor:palette.white},memberSearchIcon:{marginRight:9,color:palette.action,fontSize:21},memberSearchInput:{height:'100%',flex:1,color:palette.ink,fontSize:13},memberSearchClear:{width:44,height:44,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:'#eef2ef'},memberSearchClearText:{color:palette.secondary,fontSize:20,lineHeight:22},memberFormPage:{flex:1,backgroundColor:palette.background},memberFormHeader:{paddingHorizontal:16,paddingTop:8,paddingBottom:13,borderBottomWidth:1,borderBottomColor:palette.line,backgroundColor:palette.background},memberFormHeaderRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},memberFormBack:{minWidth:72,minHeight:44,flexDirection:'row',alignItems:'center',gap:6},memberFormBackText:{color:palette.ink,fontSize:12,fontWeight:'800'},memberFormStep:{color:palette.secondary,fontSize:10,fontWeight:'900',letterSpacing:.7},memberFormNext:{minWidth:100,minHeight:44,paddingHorizontal:10,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5,borderRadius:11,backgroundColor:palette.action},memberFormNextText:{color:palette.white,fontSize:12,fontWeight:'900'},memberFormProgress:{marginTop:12,marginBottom:13,flexDirection:'row',gap:5},memberFormProgressPart:{height:4,flex:1,borderRadius:2,backgroundColor:'#d9dfdb'},memberFormProgressPartActive:{backgroundColor:palette.action},memberFormTitle:{color:palette.ink,fontSize:22,fontWeight:'900'},memberFormCopy:{marginTop:3,color:palette.secondary,fontSize:12},memberFormScroll:{flex:1},memberFormContent:{padding:16,paddingBottom:32},memberFormContentKeyboard:{paddingBottom:280},memberFormFooter:{paddingHorizontal:16,paddingTop:11,paddingBottom:12,borderTopWidth:1,borderTopColor:palette.line,backgroundColor:palette.white},passwordHeaderSpacer:{minWidth:72},passwordSecurityNotice:{marginBottom:20,padding:14,flexDirection:'row',alignItems:'flex-start',gap:10,borderWidth:1,borderColor:'#cfe3d6',borderRadius:14,backgroundColor:'#f4faf6'},passwordSecurityNoticeText:{flex:1,color:palette.secondary,fontSize:12,lineHeight:18,fontWeight:'600'},
  memberFilters:{paddingTop:12,flexDirection:'row',flexWrap:'wrap',gap:8},memberFilter:{minHeight:44,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:7,borderWidth:1,borderColor:palette.line,borderRadius:22,backgroundColor:palette.white},memberFilterActive:{borderColor:palette.action,backgroundColor:'#eef7e1'},memberFilterText:{color:palette.secondary,fontSize:12,fontWeight:'800'},memberFilterTextActive:{color:palette.action},memberFilterCount:{minWidth:24,height:24,paddingHorizontal:6,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:'#eef2ef'},memberFilterCountActive:{backgroundColor:palette.action},memberFilterCountText:{color:palette.secondary,fontSize:10,fontWeight:'900'},memberFilterCountTextActive:{color:palette.white},memberPlanDotUpcoming:{backgroundColor:palette.warning},memberPlanTextUpcoming:{color:palette.warning,fontWeight:'800'},memberPlanDotExpired:{backgroundColor:palette.warning},memberPlanTextExpired:{color:palette.warning},
  primary:{minHeight:49,flexDirection:'row',gap:8,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:palette.action},primaryText:{color:palette.white,fontSize:14,fontWeight:'800'},disabled:{opacity:.45},memberRow:{minHeight:80,padding:12,flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderBottomColor:'#edf0ee'},memberListRow:{marginBottom:10,borderWidth:1,borderBottomWidth:1,borderColor:palette.line,borderRadius:16,backgroundColor:palette.white},memberRowPressed:{backgroundColor:'#f3f8f4'},memberAvatar:{width:48,height:48,marginRight:11,borderRadius:15,alignItems:'center',justifyContent:'center',backgroundColor:'#e8f5ce'},memberAvatarText:{color:palette.brand,fontSize:13,fontWeight:'900'},memberPlanLine:{marginTop:6,flexDirection:'row',alignItems:'center',gap:5},memberPlanDot:{width:7,height:7,borderRadius:4,backgroundColor:'#c0c7c3'},memberPlanDotActive:{backgroundColor:palette.action},memberPlanText:{flex:1,color:palette.secondary,fontSize:11},memberChevron:{marginLeft:8,color:palette.secondary,fontSize:28,fontWeight:'300'},memberProfile:{marginBottom:12,padding:16,flexDirection:'row',alignItems:'center',borderRadius:16,backgroundColor:'#f3f7f3'},memberProfileAvatar:{width:52,height:52,marginRight:13,alignItems:'center',justifyContent:'center',borderRadius:17,backgroundColor:palette.accent},memberProfileInitials:{color:palette.brand,fontSize:15,fontWeight:'900'},memberProfileName:{color:palette.ink,fontSize:16,fontWeight:'900'},memberProfileMeta:{marginTop:4,color:palette.secondary,fontSize:12},memberProfilePlan:{marginTop:6,color:palette.action,fontSize:12,fontWeight:'700'},memberProfileExpiry:{marginTop:4,color:palette.secondary,fontSize:11,fontWeight:'700'},scheduledMembershipCard:{marginBottom:12,padding:13,borderWidth:1,borderColor:'#f1d2b2',borderRadius:14,backgroundColor:'#fff8ef'},scheduledMembershipLabel:{color:palette.warning,fontSize:10,fontWeight:'900',letterSpacing:.8},scheduledMembershipPlan:{marginTop:5,color:palette.ink,fontSize:13,fontWeight:'900'},scheduledMembershipDates:{marginTop:4,color:palette.secondary,fontSize:11,fontWeight:'700'},scheduledMembershipActions:{marginTop:12,paddingTop:10,flexDirection:'row',gap:8,borderTopWidth:1,borderTopColor:'#f1d2b2'},scheduledMembershipButton:{flex:1,minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,borderWidth:1,borderColor:'#cfe3d6',borderRadius:10,backgroundColor:palette.white},scheduledMembershipDeleteButton:{borderColor:'#f0d8d4'},scheduledMembershipButtonText:{color:palette.action,fontSize:12,fontWeight:'900'},memberActionGrid:{gap:10},memberActionCard:{minHeight:76,padding:13,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:palette.line,borderRadius:15,backgroundColor:'#fbfcfb'},memberActionCardPlan:{borderColor:'#dce8ca',backgroundColor:'#fbfdf7'},memberActionCardRenew:{borderColor:'#f1d2b2',backgroundColor:'#fffaf3'},memberActionCardDelete:{minHeight:64,borderColor:'#f0d8d4',backgroundColor:'#fffafa'},memberActionCardPressed:{opacity:.72,transform:[{scale:.99}]},memberActionIcon:{width:44,height:44,marginRight:12,alignItems:'center',justifyContent:'center',borderRadius:13,backgroundColor:'#e6f1ea'},memberActionIconPlan:{backgroundColor:'#e8f5ce'},memberActionIconRenew:{backgroundColor:'#fff0dc'},memberActionIconDelete:{backgroundColor:'#fee9e5'},memberActionIconText:{color:palette.action,fontSize:19,fontWeight:'900'},memberActionDeleteText:{color:palette.danger},memberActionTitle:{color:palette.ink,fontSize:13,fontWeight:'900'},memberActionCopy:{marginTop:4,color:palette.secondary,fontSize:11,lineHeight:16},memberActionChevron:{marginLeft:8,color:palette.secondary,fontSize:25},planCard:{minHeight:76,marginBottom:10,padding:16,flexDirection:'row',gap:10,justifyContent:'space-between',alignItems:'center',borderWidth:1,borderColor:palette.line,borderRadius:16,backgroundColor:palette.white},planName:{flexShrink:1,fontSize:15,fontWeight:'800',color:palette.ink},planPrice:{maxWidth:100,fontSize:15,fontWeight:'800',color:palette.action},debtCard:{position:'relative',overflow:'hidden',padding:22,borderWidth:1,borderColor:'#f1d2b2',borderRadius:22,backgroundColor:'#fff7ed',shadowColor:palette.warning,shadowOffset:{width:0,height:5},shadowOpacity:.1,shadowRadius:12,elevation:3},debtGlowLarge:{position:'absolute',right:-42,top:-58,width:150,height:150,borderRadius:75,backgroundColor:'#e28d3630'},debtGlowSmall:{position:'absolute',right:58,bottom:-37,width:76,height:76,borderRadius:38,backgroundColor:'#c9f47b45'},debtHeader:{flexDirection:'row',alignItems:'center'},debtIcon:{width:44,height:44,marginRight:12,alignItems:'center',justifyContent:'center',borderRadius:13,backgroundColor:palette.brand},debtIconText:{color:palette.accent,fontSize:18,fontWeight:'900'},debtLabel:{color:palette.warning,fontSize:11,fontWeight:'900',letterSpacing:1.1},debtSubtitle:{marginTop:3,color:palette.secondary,fontSize:12},debtValue:{marginTop:18,color:palette.ink,fontSize:32,fontWeight:'900',letterSpacing:-.8},debtFooter:{marginTop:18,paddingTop:13,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,borderTopWidth:1,borderTopColor:'#f1d2b2'},debtPending:{flex:1,color:palette.ink,fontSize:12,fontWeight:'800'},debtState:{minHeight:32,paddingVertical:5,paddingHorizontal:8,flexDirection:'row',alignItems:'center',gap:5,borderRadius:10,backgroundColor:palette.white},debtStateDot:{width:7,height:7,borderRadius:4,backgroundColor:palette.warning},debtStateText:{color:palette.warning,fontSize:10,fontWeight:'900'},balance:{textAlign:'right',color:palette.ink,fontSize:12,fontWeight:'800'},balanceLabel:{marginTop:3,textAlign:'right',color:palette.secondary,fontSize:11},
  debtCardGreen:{borderColor:'#2d624d',backgroundColor:palette.brand,shadowColor:palette.brand},debtGlowLargeGreen:{backgroundColor:'#2d765855'},debtIconGreen:{backgroundColor:'#ffffff18'},debtLabelGreen:{color:palette.accent},debtSubtitleGreen:{color:'#c4d5cd'},debtValueGreen:{color:palette.white},debtFooterGreen:{borderTopColor:'#ffffff26'},debtPendingGreen:{color:'#e7f0eb'},debtStateGreen:{backgroundColor:'#ffffff14'},debtStateDotGreen:{backgroundColor:palette.accent},debtStateTextGreen:{color:palette.accent},
  modalRoot:{flex:1,justifyContent:'flex-end'},backdrop:{...StyleSheet.absoluteFillObject,backgroundColor:'#13251d99'},sheet:{maxHeight:'82%',paddingHorizontal:22,paddingBottom:32,borderTopLeftRadius:25,borderTopRightRadius:25,backgroundColor:palette.white,shadowColor:'#000',shadowOffset:{width:0,height:-8},shadowOpacity:.16,shadowRadius:20,elevation:18},formSheet:{height:'82%'},sheetHandle:{width:42,height:4,marginTop:9,marginBottom:11,alignSelf:'center',borderRadius:2,backgroundColor:'#d9dfdb'},sheetHead:{marginBottom:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},sheetTitle:{flex:1,fontSize:22,fontWeight:'800',color:palette.ink},closeButton:{width:44,height:44,marginLeft:12,alignItems:'center',justifyContent:'center',borderRadius:13,backgroundColor:'#f1f4f2'},closeButtonPressed:{opacity:.65,transform:[{scale:.94}]},close:{marginTop:-2,fontSize:28,lineHeight:30,color:palette.secondary},sheetFooter:{paddingTop:11,borderTopWidth:1,borderTopColor:palette.line,backgroundColor:palette.white},scrollHint:{height:28,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:4},scrollHintText:{color:palette.secondary,fontSize:12,fontWeight:'700'},field:{marginBottom:14},fieldLabel:{marginBottom:7,color:palette.secondary,fontSize:12,fontWeight:'700'},input:{minHeight:48,paddingHorizontal:14,borderWidth:1,borderColor:palette.line,borderRadius:11,color:palette.ink,fontSize:14,backgroundColor:'#fafbf9'},provinceTrigger:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},provinceValue:{flex:1,color:palette.ink,fontSize:14},provincePlaceholder:{color:palette.secondary},provinceModalRoot:{flex:1,justifyContent:'flex-end',paddingTop:60,backgroundColor:'#13251d99'},provinceSheet:{maxHeight:'78%',paddingHorizontal:20,paddingTop:12,paddingBottom:10,borderTopLeftRadius:24,borderTopRightRadius:24,backgroundColor:palette.white},provinceHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:8},provinceTitle:{flex:1,color:palette.ink,fontSize:20,fontWeight:'900'},provinceOption:{minHeight:48,paddingHorizontal:13,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:palette.line},provinceOptionSelected:{borderRadius:10,borderBottomColor:'transparent',backgroundColor:'#eef7e1'},provinceOptionText:{color:palette.ink,fontSize:14},provinceOptionTextSelected:{color:palette.action,fontWeight:'900'},sheetCopy:{marginBottom:18,color:palette.secondary,fontSize:13},bold:{fontWeight:'800',color:palette.ink},choices:{marginBottom:15,gap:8},choice:{minHeight:56,padding:13,justifyContent:'center',borderWidth:1,borderColor:palette.line,borderRadius:12},choiceActive:{borderColor:palette.action,backgroundColor:'#eef7e1'},choiceTitle:{fontSize:13,fontWeight:'800',color:palette.ink},choicePrice:{marginTop:3,color:palette.secondary,fontSize:12},planRequiredEmpty:{padding:24,alignItems:'center',borderWidth:1,borderColor:'#f1d2b2',borderRadius:16,backgroundColor:'#fff8ef'},planRequiredTitle:{marginTop:10,color:palette.ink,fontSize:14,fontWeight:'900'},planRequiredCopy:{marginTop:6,color:palette.secondary,fontSize:12,lineHeight:17,textAlign:'center'},statusChoices:{marginBottom:18,flexDirection:'row',gap:8},statusChoice:{minHeight:48,flex:1,padding:11,justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:palette.line,borderRadius:10},statusChoiceActive:{borderColor:palette.action,backgroundColor:'#eef7e1'},statusChoiceText:{color:palette.secondary,fontSize:12,fontWeight:'700'},statusChoiceTextActive:{color:palette.action},
  planCardPressed:{opacity:.72,transform:[{scale:.99}]},planTitleLine:{flexDirection:'row',alignItems:'center',gap:7},planState:{paddingVertical:3,paddingHorizontal:7,borderRadius:8,backgroundColor:'#fff0d8'},planStateActive:{backgroundColor:'#e1f4e8'},planStateText:{color:palette.warning,fontSize:8,fontWeight:'800'},planStateTextActive:{color:palette.action},planProfile:{marginBottom:20,padding:16,flexDirection:'row',alignItems:'center',borderRadius:16,backgroundColor:'#f6f9f2'},planProfileIcon:{width:52,height:52,marginRight:13,alignItems:'center',justifyContent:'center',borderRadius:17,backgroundColor:'#e8f5ce'},planProfileIconText:{color:palette.action,fontSize:20,fontWeight:'900'},planProfileState:{marginTop:6,color:palette.action,fontSize:10,fontWeight:'700'},planProfileStateInactive:{color:palette.warning},
  issueCard:{marginBottom:10,padding:14,borderWidth:1,borderColor:'#ead7d2',borderRadius:13,backgroundColor:'#fff8f6'},issueTitle:{color:palette.ink,fontSize:13,fontWeight:'800'},issueDate:{marginTop:3,color:palette.secondary,fontSize:9},issueError:{marginTop:9,color:palette.danger,fontSize:11,lineHeight:16},discard:{marginTop:12,color:palette.action,fontSize:11,fontWeight:'800'},
  tabbar:{minHeight:66,marginHorizontal:12,marginBottom:8,paddingVertical:5,flexDirection:'row',borderWidth:1,borderColor:palette.line,borderRadius:22,backgroundColor:palette.white,shadowColor:palette.brand,shadowOffset:{width:0,height:4},shadowOpacity:.14,shadowRadius:10,elevation:8},tab:{minHeight:48,flex:1,alignItems:'center',justifyContent:'center'},tabPressed:{opacity:.65},tabIconWrap:{width:44,height:30,alignItems:'center',justifyContent:'center'},tabIconWrapActive:{overflow:'hidden',borderRadius:15,backgroundColor:'#e8f5ce'},tabLabel:{marginTop:2,color:palette.secondary,fontSize:11,fontWeight:'700'},tabActive:{color:palette.action,fontWeight:'900'},
  currentPlanCard:{marginBottom:14,padding:14,borderWidth:1,borderColor:'#cfe3d6',borderRadius:13,backgroundColor:'#f4faf6'},currentMembershipLabel:{marginTop:6,color:palette.secondary,fontSize:8,fontWeight:'900',letterSpacing:.8},currentPlanName:{marginTop:5,color:palette.ink,fontSize:14,fontWeight:'900'},currentPlanMeta:{marginTop:4,color:palette.secondary,fontSize:9,fontWeight:'700'},membershipExpiryPreview:{marginTop:-6,marginBottom:18,padding:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:14,borderWidth:1,borderColor:'#cfe3d6',borderRadius:13,backgroundColor:'#f4faf6'},membershipExpiryLabel:{color:palette.secondary,fontSize:8,fontWeight:'900',letterSpacing:.8},membershipExpiryDate:{marginTop:5,color:palette.ink,fontSize:13,fontWeight:'900'},membershipExpiryDays:{color:palette.action,fontSize:10,fontWeight:'900',textAlign:'right'},
  periodStepper:{height:58,marginBottom:16,padding:5,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:palette.line,borderRadius:13,backgroundColor:'#fbfcfb'},periodStepButton:{width:48,height:48,alignItems:'center',justifyContent:'center',borderRadius:10,backgroundColor:'#e8f5ce'},periodStepValue:{flex:1,alignItems:'center',justifyContent:'center'},periodStepNumber:{color:palette.ink,fontSize:18,fontWeight:'900'},periodStepCaption:{marginTop:1,color:palette.secondary,fontSize:10,fontWeight:'900',letterSpacing:.8},purchasePreview:{marginBottom:16,padding:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:14,borderWidth:1,borderColor:'#cfe3d6',borderRadius:13,backgroundColor:'#f4faf6'},purchasePreviewLabel:{color:palette.secondary,fontSize:10,fontWeight:'900',letterSpacing:.8},purchasePreviewValue:{marginTop:5,color:palette.action,fontSize:16,fontWeight:'900'},purchasePreviewMeta:{marginTop:3,color:palette.secondary,fontSize:11,fontWeight:'700'},purchasePreviewDate:{marginTop:5,color:palette.ink,fontSize:12,fontWeight:'900',textAlign:'right'},
  passwordInputShell:{minHeight:48,paddingLeft:14,paddingRight:2,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:palette.line,borderRadius:11,backgroundColor:'#fafbf9'},passwordInput:{minHeight:46,flex:1,color:palette.ink,fontSize:14},passwordVisibilityButton:{width:44,height:44,alignItems:'center',justifyContent:'center',borderRadius:10},
  skeletonList:{gap:10},skeletonRow:{minHeight:80,padding:14,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:palette.line,borderRadius:16,backgroundColor:palette.white},skeletonAvatar:{width:48,height:48,marginRight:12,borderRadius:15,backgroundColor:'#dce5df'},skeletonBody:{flex:1,gap:8},skeletonTitle:{width:'68%',height:14,borderRadius:7,backgroundColor:'#dce5df'},skeletonCopy:{width:'88%',height:10,borderRadius:5,backgroundColor:'#e5ebe7'},skeletonCopyShort:{width:'52%',height:10,borderRadius:5,backgroundColor:'#e5ebe7'},
}));

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
  securityButton:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface},
  securityIcon:{backgroundColor:'#20382c'},
  securityTitle:{color:darkPalette.text},
  securityCopy:{color:darkPalette.secondary},
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
  statisticsTabs:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface},
  statisticsTabActive:{backgroundColor:darkPalette.actionSoft},
  statisticsTabText:{color:darkPalette.secondary},
  statisticsTabTextActive:{color:palette.accent},
  statisticsHero:{backgroundColor:'#123d2c'},
  variationBadge:{backgroundColor:darkPalette.actionSoft},
  variationBadgeDown:{backgroundColor:'#3a211f'},
  variationText:{color:darkPalette.action},
  variationTextDown:{color:'#ef8b82'},
  statisticsCard:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface},
  barLabel:{color:darkPalette.secondary},
  barValue:{color:darkPalette.text},
  barTrack:{backgroundColor:darkPalette.border},
  barFill:{backgroundColor:darkPalette.action},
  statisticsNotice:{borderColor:darkPalette.border,backgroundColor:darkPalette.raised},
  statisticsNoticeText:{color:darkPalette.secondary},
  statusRatio:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface},
  statusRatioTitle:{color:darkPalette.text},
  ratioTrack:{backgroundColor:darkPalette.border},
  ratioFill:{backgroundColor:darkPalette.action},
  ratioPrimary:{color:darkPalette.action},
  ratioSecondary:{color:darkPalette.secondary},
  planStatisticCard:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface},
  planRank:{backgroundColor:darkPalette.actionSoft},
  planRankText:{color:palette.accent},
  planStatisticName:{color:darkPalette.text},
  planStatisticRevenue:{color:darkPalette.action},
  planStatisticGrid:{borderTopColor:darkPalette.border},
  statisticValueLabel:{color:darkPalette.secondary},
  statisticValueNumber:{color:darkPalette.text},
  debtOverdue:{color:'#ef8b82'},
  debtAmount:{color:'#ef8b82'},
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
  paymentDetailRowCancelled:{borderColor:'#5a302d',backgroundColor:'#251817'},
  paymentDetailRowPressed:{borderColor:'#4c7561',backgroundColor:darkPalette.raised},
  paymentBadge:{backgroundColor:'#3a2c19'},
  paymentBadgeSuccess:{backgroundColor:'#183a29'},
  paymentBadgeDanger:{backgroundColor:'#40211f'},
  paymentBadgeText:{color:'#f0b35f'},
  paymentBadgeTextSuccess:{color:darkPalette.action},
  paymentBadgeTextDanger:{color:'#ef8b82'},
  paymentAmountLabel:{color:darkPalette.secondary},
  paymentPaid:{color:darkPalette.action},
  paymentPaidCancelled:{color:'#ef8b82'},
  paymentTotal:{color:darkPalette.text},
  paymentTotalCancelled:{color:'#ef8b82'},
  paymentProgress:{backgroundColor:darkPalette.border},
  paymentProgressFill:{backgroundColor:darkPalette.action},
  paymentOperations:{borderTopColor:darkPalette.border},
  paymentOperationsTitle:{color:darkPalette.secondary},
  paymentOperationAmount:{color:darkPalette.action},
  paymentOperationDate:{color:darkPalette.secondary},
  paymentNoOperations:{color:darkPalette.secondary},
  paymentBalanceCopy:{color:'#f0b35f'},
  paymentCancelledCopy:{borderTopColor:'#5a302d',color:'#ef8b82'},
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
  passwordSecurityNotice:{borderColor:darkPalette.border,backgroundColor:darkPalette.raised},
  passwordSecurityNoticeText:{color:darkPalette.secondary},
  memberRow:{borderBottomColor:darkPalette.border},
  memberListRow:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface},
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
  currentPlanCard:{borderColor:'#3d594a',backgroundColor:'#19231d'},
  currentMembershipLabel:{color:darkPalette.secondary},
  currentPlanName:{color:darkPalette.text},
  currentPlanMeta:{color:darkPalette.secondary},
  scheduledMembershipCard:{borderColor:'#5a482c',backgroundColor:'#261f17'},
  scheduledMembershipLabel:{color:'#f0b35f'},
  scheduledMembershipPlan:{color:darkPalette.text},
  scheduledMembershipDates:{color:darkPalette.secondary},
  scheduledMembershipActions:{borderTopColor:'#5a482c'},
  scheduledMembershipButton:{borderColor:'#3d594a',backgroundColor:darkPalette.surface},
  scheduledMembershipDeleteButton:{borderColor:'#5a302d'},
  scheduledMembershipButtonText:{color:darkPalette.action},
  memberActionCard:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface},
  memberActionCardPlan:{borderColor:'#3d594a',backgroundColor:'#19231d'},
  memberActionCardRenew:{borderColor:'#5a482c',backgroundColor:'#261f17'},
  memberActionCardDelete:{borderColor:'#5a302d',backgroundColor:'#251817'},
  memberActionIcon:{backgroundColor:darkPalette.actionSoft},
  memberActionIconText:{color:darkPalette.action},
  memberActionIconPlan:{backgroundColor:'#2a4127'},
  memberActionIconRenew:{backgroundColor:'#3a2c19'},
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
  provinceValue:{color:darkPalette.text},
  provincePlaceholder:{color:darkPalette.secondary},
  provinceSheet:{backgroundColor:darkPalette.surface},
  provinceTitle:{color:darkPalette.text},
  provinceOption:{borderBottomColor:darkPalette.border},
  provinceOptionSelected:{borderBottomColor:'transparent',backgroundColor:darkPalette.actionSoft},
  provinceOptionText:{color:darkPalette.text},
  provinceOptionTextSelected:{color:darkPalette.action},
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
  periodStepper:{borderColor:darkPalette.border,backgroundColor:'#151b17'},
  periodStepButton:{backgroundColor:darkPalette.actionSoft},
  periodStepNumber:{color:darkPalette.text},
  periodStepCaption:{color:darkPalette.secondary},
  purchasePreview:{borderColor:'#3d594a',backgroundColor:'#19231d'},
  purchasePreviewLabel:{color:darkPalette.secondary},
  purchasePreviewValue:{color:darkPalette.action},
  purchasePreviewMeta:{color:darkPalette.secondary},
  purchasePreviewDate:{color:darkPalette.text},
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
  passwordInputShell:{borderColor:darkPalette.border,backgroundColor:'#151b17'},
  passwordInput:{color:darkPalette.text},
  skeletonRow:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface},
  skeletonAvatar:{backgroundColor:'#354039'},
  skeletonTitle:{backgroundColor:'#354039'},
  skeletonCopy:{backgroundColor:'#2c352f'},
  skeletonCopyShort:{backgroundColor:'#2c352f'},
});

const styles = new Proxy(baseStyles, {
  get(target, property: string | symbol) {
    const baseStyle = Reflect.get(target, property);
    if (typeof property !== 'string' || !activeDarkTheme) return baseStyle;
    const darkStyle = Reflect.get(darkStyles, property);
    return darkStyle ? [baseStyle, darkStyle] : baseStyle;
  },
}) as typeof baseStyles;
