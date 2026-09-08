export const APP_VERSION = (require('../../app.json') as { expo: { version: string } }).expo.version;

export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ?? '';
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ?? '';

const configuredRenewalWhatsApp = (process.env.EXPO_PUBLIC_RENEWAL_WHATSAPP ?? '').replace(/\D/g, '');

export const RENEWAL_WHATSAPP = configuredRenewalWhatsApp.length === 8
  ? `53${configuredRenewalWhatsApp}`
  : configuredRenewalWhatsApp;

export const RENEWAL_MESSAGE = 'Para continuar debes renovar la suscripción de tu gimnasio.';
export const PROFILE_REFRESH_INTERVAL_MS = 30_000;

export const STORAGE_KEYS = {
  theme: 'gymflow_mini_theme',
  onboarding: 'gymflow_mini_onboarding_v1',
} as const;

export const FEATURES = {
  themeSelector: false,
  staffEntry: false,
  scheduledMembership: false,
  attendanceEntry: false,
} as const;
