import { useEffect, useState } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, setUnauthorizedHandler } from './src/api';
import { cancelMembershipNotifications, cancelSubscriptionNotifications } from './src/notifications';
import type { User } from './src/types';
import { STORAGE_KEYS } from './src/core/config';
import { OnboardingScreen } from './src/features/onboarding/OnboardingScreen';
import { AuthScreen } from './src/features/auth/AuthScreen';
import { SubscriptionGate } from './src/features/subscriptions/SubscriptionGate';
import { setAppStylesDark, styles } from './src/theme/appStyles';
import type { ThemePreference } from './src/features/account/AccountScreen';
import { AdminApp } from './src/features/shell/AdminApp';
import { ToastHost, showError, showPending, showRejected, showSuccess } from './src/components/Toast';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function App() {
  const systemScheme = useColorScheme();
  const [themePreference, setThemePreference] = useState<ThemePreference>('light');
  const [user, setUser] = useState<User | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [localSettingsReady, setLocalSettingsReady] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const dark = themePreference === 'system' ? systemScheme === 'dark' : themePreference === 'dark';
  setAppStylesDark(dark);
  useEffect(() => {
    let mounted = true;
    Promise.all([SecureStore.getItemAsync(STORAGE_KEYS.theme).catch(() => null), SecureStore.getItemAsync(STORAGE_KEYS.onboarding).catch(() => null)]).then(([storedTheme, storedOnboarding]) => {
      if (!mounted) return;
      if (storedTheme === 'system' || storedTheme === 'light' || storedTheme === 'dark') setThemePreference(storedTheme);
      const completed = storedOnboarding === 'complete';
      setOnboardingComplete(completed);
      if (!completed) setRestoring(false);
      setLocalSettingsReady(true);
      if (completed) void api.restore().then(restoredUser => { if (mounted) setUser(restoredUser); }).catch(() => undefined).finally(() => { if (mounted) setRestoring(false); });
    });
    return () => { mounted = false; };
  }, []);
  useEffect(() => { if (localSettingsReady) void SplashScreen.hideAsync().catch(() => undefined); }, [localSettingsReady]);
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (user?.gymId) void Promise.all([cancelMembershipNotifications(user.gymId), cancelSubscriptionNotifications(user.gymId)]).catch(() => undefined);
      setUser(null);
      showError(new Error('Tu sesión venció. Inicia sesión nuevamente.'));
    });
    return () => setUnauthorizedHandler();
  }, [user?.gymId]);
  const changeTheme = (nextTheme: ThemePreference) => { setThemePreference(nextTheme); void SecureStore.setItemAsync(STORAGE_KEYS.theme, nextTheme).catch(showError); };
  const finishOnboarding = () => {
    setOnboardingComplete(true);
    setRestoring(true);
    void SecureStore.setItemAsync(STORAGE_KEYS.onboarding, 'complete').catch(showError).finally(() => setRestoring(false));
  };
  const logout = async () => { if (user?.gymId) await Promise.all([cancelMembershipNotifications(user.gymId), cancelSubscriptionNotifications(user.gymId)]).catch(() => undefined); await api.logout(); setUser(null); };
  return <SafeAreaProvider>
    {!localSettingsReady
      ? null
      : restoring
      ? <View style={styles.center}><ActivityIndicator color="#c9f47b" size="large" /></View>
      : !user && !onboardingComplete
        ? <OnboardingScreen onComplete={finishOnboarding}/>
      : !user
        ? <AuthScreen dark={dark} onAuthenticated={setUser} onError={showError} onSuccess={showSuccess}/>
        : !user.gym.subscriptionPlan
          ? <SubscriptionGate user={user} onUserChange={setUser} onLogout={logout} onError={showError} onSuccess={showSuccess} onPending={showPending} onRejected={showRejected}/>
          : <AdminApp user={user} dark={dark} themePreference={themePreference} onThemeChange={changeTheme} onLogout={logout} />}
    <ToastHost />
  </SafeAreaProvider>;
}
