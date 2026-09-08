import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { ActivityIndicator, AppState, BackHandler, Keyboard, Platform, Pressable, StatusBar, Text, View } from 'react-native';
import * as Network from 'expo-network';
import type { NotificationResponse } from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../api';
import { AttendanceScreen } from '../../AttendanceScreen';
import { PROFILE_REFRESH_INTERVAL_MS, RENEWAL_MESSAGE } from '../../core/config';
import { isMembershipDayBefore, isMembershipDayOnOrBefore } from '../../membershipDates';
import { cancelSubscriptionNotifications, MEMBERSHIP_NOTIFICATION_SOURCE, SUBSCRIPTION_NOTIFICATION_SOURCE, supportsMembershipNotifications, syncMembershipNotifications, syncSubscriptionNotification } from '../../notifications';
import { getSyncIssues, getSyncState, initializeOffline, offline, settleMutation, subscribeOffline, syncNow } from '../../offline';
import { getTrustedClockStatus, persistTrustedClock, SUBSCRIPTION_VALIDATION_MESSAGE } from '../../trustedClock';
import type { GymSubscriptionPlan, SyncState, Tab, User } from '../../types';
import { darkPalette, palette } from '../../theme/colors';
import { styles } from '../../theme/appStyles';
import { ToastHost, showError, showPending, showRejected, showSuccess } from '../../components/Toast';
import { AccountScreen, type ThemePreference } from '../account/AccountScreen';
import { DashboardScreen as AnalyticsDashboardScreen, StatisticsScreen as AnalyticsStatisticsScreen } from '../analytics/AnalyticsScreens';
import type { MemberFilter } from '../members/MembersList';
import { MembersScreen } from '../members/MembersScreen';
import { PaymentsScreen } from '../payments/PaymentsScreen';
import { PlansScreen } from '../plans/PlansScreen';
import { StaffManager } from '../staff/StaffManager';
import { SyncBar, SyncIssues } from '../sync/SyncStatus';

type SubscriptionAccess = 'ACTIVE' | 'EXPIRING_TODAY' | 'EXPIRED' | 'VALIDATION_REQUIRED';
type TabIconName = ComponentProps<typeof Ionicons>['name'];
type AdminAppProps = { user: User; dark: boolean; themePreference: ThemePreference; onThemeChange: (theme: ThemePreference) => void; onLogout: () => void };

const tabs: { id: Tab; icon: TabIconName; activeIcon: TabIconName; label: string; title?: string }[] = [
  { id: 'INICIO', icon: 'home-outline', activeIcon: 'home', label: 'Inicio' },
  { id: 'MIEMBROS', icon: 'people-outline', activeIcon: 'people', label: 'Miembros' },
  { id: 'PLANES', icon: 'pricetags-outline', activeIcon: 'pricetags', label: 'Planes' },
  { id: 'CAJA', icon: 'cash-outline', activeIcon: 'cash', label: 'Caja' },
  { id: 'ESTADISTICAS', icon: 'stats-chart-outline', activeIcon: 'stats-chart', label: 'Datos', title: 'Estadísticas' },
];

export function AdminApp({ user, dark, themePreference, onThemeChange, onLogout }: AdminAppProps) {
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
  const getSubscriptionAccess = (): { status: SubscriptionAccess; now: number } => {
    const clock = getTrustedClockStatus(scope);
    if (!clock.allowedOffline) return { status: 'VALIDATION_REQUIRED', now: clock.now };
    const subscriptionEndsAt = currentUser.gym.subscriptionEndsAt ?? '';
    const endsAt = new Date(subscriptionEndsAt).getTime();
    if (!subscriptionEndsAt || !Number.isFinite(endsAt) || isMembershipDayBefore(subscriptionEndsAt, clock.now)) return { status: 'EXPIRED', now: clock.now };
    if (isMembershipDayOnOrBefore(subscriptionEndsAt, clock.now)) return { status: 'EXPIRING_TODAY', now: clock.now };
    return { status: 'ACTIVE', now: clock.now };
  };
  const subscriptionIsActive = () => { const status = getSubscriptionAccess().status; return status === 'ACTIVE' || status === 'EXPIRING_TODAY'; };
  const subscriptionErrorMessage = () => getSubscriptionAccess().status === 'VALIDATION_REQUIRED' ? SUBSCRIPTION_VALIDATION_MESSAGE : RENEWAL_MESSAGE;
  const ensureActiveSubscription = () => { if (!subscriptionIsActive()) throw new Error(subscriptionErrorMessage()); };
  const withActiveSubscription = (action: () => void) => { if (!subscriptionIsActive()) { showError(new Error(subscriptionErrorMessage())); return; } action(); };
  const getGymSubscriptionLabel = (plan: GymSubscriptionPlan | null) => !plan ? 'Sin suscripción' : plan === 'TRIAL' ? `Prueba gratuita · ${currentUser.gym.subscriptionTrialDays ?? 7} días` : plan === 'MONTHLY' ? 'Mensual' : 'Anual';
  const visibleTabs = currentUser.role === 'ADMIN' ? tabs : tabs.filter(item => item.id !== 'ESTADISTICAS' && item.id !== 'PERSONAL');
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
    if (!ready) return;
    if (currentUser.role !== 'ADMIN') {
      void cancelSubscriptionNotifications(scope).catch(showError);
      return;
    }
    void syncSubscriptionNotification(scope, currentUser.gym.name, currentUser.gym.subscriptionEndsAt).catch(showError);
  }, [ready, scope, currentUser.role, currentUser.gym.name, currentUser.gym.subscriptionEndsAt]);
  useEffect(() => {
    if (!supportsMembershipNotifications()) return;
    let mounted = true;
    let removeListener: (() => void) | undefined;
    const openMembershipNotification = (response: NotificationResponse) => {
      const data = response.notification.request.content.data;
      if (data?.scope !== scope) return;
      if (data.source === SUBSCRIPTION_NOTIFICATION_SOURCE) {
        setTab('CUENTA');
        return;
      }
      if (data.source !== MEMBERSHIP_NOTIFICATION_SOURCE) return;
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
      if (tab === 'PERSONAL') { setTab('CUENTA'); return true; }
      if (tab !== 'INICIO') { setTab('INICIO'); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [issuesOpen, accountPasswordOpen, tab]);
  if (!ready) return <View style={styles.center}><ActivityIndicator color="#c9f47b" size="large" /></View>;
  const nestedAccountPage = tab === 'CUENTA' && accountPasswordOpen;
  const currentScreenTitle = tab === 'PERSONAL' ? 'Personal y acceso' : tab === 'ASISTENCIA' ? 'Asistencia' : tab === 'CUENTA' ? 'Cuenta' : visibleTabs.find((item) => item.id === tab)?.title ?? visibleTabs.find((item) => item.id === tab)?.label;
  return <SafeAreaView style={styles.app} edges={['top','right','bottom','left']}><StatusBar translucent backgroundColor="transparent" barStyle={dark ? "light-content" : "dark-content"} />
    {!nestedAccountPage ? <View style={styles.topbar}>
      {tab === 'PERSONAL' ? <Pressable accessibilityRole="button" accessibilityLabel="Volver a Cuenta" onPress={() => setTab('CUENTA')} style={({pressed}) => [styles.memberFormBack,pressed&&styles.tabPressed]}><Ionicons name="arrow-back" size={19} color={dark?darkPalette.text:palette.ink}/><Text style={styles.memberFormBackText}>Volver</Text></Pressable> : tab === 'ASISTENCIA' ? <Pressable accessibilityRole="button" accessibilityLabel="Volver al inicio" onPress={() => setTab('INICIO')} style={({pressed}) => [styles.topbarBack,dark&&{backgroundColor:darkPalette.raised},pressed&&styles.tabPressed]}><Ionicons name="arrow-back" size={23} color={dark?darkPalette.text:palette.ink}/></Pressable> : null}
      <View style={styles.topbarTitle}><Text numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.3} style={styles.kicker}>{currentUser.gym.name.toUpperCase()}</Text><Text maxFontSizeMultiplier={1.3} numberOfLines={tab==='PERSONAL'?1:undefined} adjustsFontSizeToFit={tab==='PERSONAL'} minimumFontScale={0.7} style={[styles.screenTitle,tab==='PERSONAL'&&{fontSize:22}]}>{currentScreenTitle}</Text></View>
      <Pressable accessibilityRole="button" accessibilityState={{selected:tab==='CUENTA'}} accessibilityLabel="Abrir cuenta" onPress={() => setTab('CUENTA')} style={({pressed}) => [styles.avatar,tab==='CUENTA'&&styles.avatarActive,dark&&tab!=='CUENTA'&&{backgroundColor:darkPalette.raised},pressed&&styles.tabPressed]}><Ionicons name={tab==='CUENTA'?'person':'person-outline'} size={23} color={tab==='CUENTA'||!dark?palette.brand:darkPalette.text}/></Pressable>
    </View> : null}
    {!nestedAccountPage && (!keyboardOpen || (tab !== 'MIEMBROS' && tab !== 'PLANES')) && <SyncBar state={syncState} onPress={() => { void refreshProfile(); syncState.rejected > 0 ? setIssuesOpen(true) : void syncNow(scope); }} />}
    <View style={styles.content}>
      {tab === 'INICIO' && <AnalyticsDashboardScreen scope={scope} revision={revision} currency={currentUser.gym.currency} dark={dark} onError={showError} onOpenAttendance={() => setTab('ASISTENCIA')} onOpenUpcoming={() => { setMemberEntryFilter('UPCOMING'); setTab('MIEMBROS'); }} />}
      {tab === 'MIEMBROS' && <MembersScreen scope={scope} revision={revision} initialFilter={memberEntryFilter} canDelete={currentUser.role === 'ADMIN'} currency={currentUser.gym.currency} dark={dark} ensureSubscription={ensureActiveSubscription} withActiveSubscription={withActiveSubscription} hasInternet={hasInternetConnection} reportMutation={reportMutation} onError={showError} onSuccess={showSuccess} onPending={showPending} onRejected={showRejected} renderModalOverlay={active => <ToastHost active={active} priority={1} />} />}
      {tab === 'ASISTENCIA' && <AttendanceScreen scope={scope} revision={revision} dark={dark} assertCanOperate={ensureActiveSubscription} onError={showError} onSuccess={showSuccess} />}
      {tab === 'PLANES' && <PlansScreen scope={scope} revision={revision} readOnly={currentUser.role !== 'ADMIN'} currency={currentUser.gym.currency} dark={dark} subscriptionIsActive={subscriptionIsActive} subscriptionErrorMessage={subscriptionErrorMessage} ensureSubscription={ensureActiveSubscription} hasInternet={hasInternetConnection} onOnlineRequired={showOnlineRequired} onError={showError} onSuccess={showSuccess} reportMutation={reportMutation} renderModalOverlay={active=><ToastHost active={active} priority={1}/>}/>}
      {tab === 'CAJA' && <PaymentsScreen scope={scope} revision={revision} currency={currentUser.gym.currency} dark={dark} withActiveSubscription={withActiveSubscription} ensureSubscription={ensureActiveSubscription} reportMutation={reportMutation} onError={showError} renderModalOverlay={active=><ToastHost active={active} priority={1}/>}/>}
      {tab === 'ESTADISTICAS' && <AnalyticsStatisticsScreen scope={scope} revision={revision} currency={currentUser.gym.currency} dark={dark} onError={showError}/>}
      {tab === 'PERSONAL' && currentUser.role === 'ADMIN' && <StaffManager currentUserId={currentUser.id} requesterName={currentUser.name} gymName={currentUser.gym.name} dark={dark} subscriptionIsActive={subscriptionIsActive} subscriptionErrorMessage={subscriptionErrorMessage} withActiveSubscription={withActiveSubscription} ensureActiveSubscription={ensureActiveSubscription} hasInternetConnection={hasInternetConnection} onError={showError} onSuccess={showSuccess} renderModalOverlay={active => <ToastHost active={active} priority={1} />} />}
      {tab === 'CUENTA' && <AccountScreen user={currentUser} onUserChange={setCurrentUser} themePreference={themePreference} onThemeChange={onThemeChange} onLogout={onLogout} passwordOpen={accountPasswordOpen} onPasswordOpenChange={setAccountPasswordOpen} onOpenStaff={() => setTab('PERSONAL')} dark={dark} getSubscriptionAccess={getSubscriptionAccess} getGymSubscriptionLabel={getGymSubscriptionLabel} onError={showError} onSuccess={showSuccess} onPending={showPending} onRejected={showRejected} renderModalOverlay={active => <ToastHost active={active} priority={1} />} />}
    </View>
    {!nestedAccountPage ? <View style={styles.tabbar}>{visibleTabs.map((item) => { const active=tab===item.id||(tab==='ASISTENCIA'&&item.id==='INICIO'); return <Pressable accessibilityRole="tab" accessibilityState={{selected:active}} accessibilityLabel={item.label} key={item.id} onPress={() => { if (item.id === 'MIEMBROS') setMemberEntryFilter('ALL'); setTab(item.id); }} style={({pressed}) => [styles.tab,pressed&&styles.tabPressed]}><View style={[styles.tabIconWrap,active&&styles.tabIconWrapActive]}><Ionicons name={active?item.activeIcon:item.icon} size={21} color={active?(dark?'#c9f47b':'#1d6b4d'):(dark?'#adb7b1':'#657169')}/></View><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[styles.tabLabel,active&&styles.tabActive]}>{item.label}</Text></Pressable>;})}</View> : null}
    <SyncIssues open={issuesOpen} scope={scope} revision={revision} dark={dark} onClose={() => setIssuesOpen(false)} onError={showError} renderModalOverlay={active => <ToastHost active={active} priority={1} />} />
  </SafeAreaView>;
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

async function reportMutation(scope: string, operationId: string, acceptedMessage: string, pendingMessage = 'Cambio guardado en este dispositivo. Se confirmará al recuperar conexión.') {
  const result = await settleMutation(scope, operationId);
  if (result.status === 'REJECTED') {
    showRejected(result.message ?? 'El servidor rechazó el cambio');
    return result.status;
  }
  if (result.status === 'PENDING') showPending(pendingMessage);
  else showSuccess(acceptedMessage);
  return result.status;
}

async function hasInternetConnection() {
  const state = await Network.getNetworkStateAsync().catch(() => null);
  return state?.isConnected !== false;
}

function showOnlineRequired() {
  showError(new Error('Debes conectarte a internet para crear, editar o eliminar planes.'));
}
