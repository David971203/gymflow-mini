import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import { membershipExpiryInstant, membershipIsCurrent, shiftMembershipDayStart } from './membershipDates';
import type { Member } from './types';

export const MEMBERSHIP_NOTIFICATION_SOURCE = 'gymflow-membership-expiry';
export const SUBSCRIPTION_NOTIFICATION_SOURCE = 'gymflow-subscription-expiry';
const MEMBERSHIP_CHANNEL_ID = 'membership-expirations';
const SUBSCRIPTION_CHANNEL_ID = 'subscription-expirations';

type NotificationsModule = typeof import('expo-notifications');
let notificationsModule: Promise<NotificationsModule> | null = null;

export function supportsMembershipNotifications() {
  return Platform.OS !== 'web' && !isRunningInExpoGo();
}

async function getNotifications() {
  if (!supportsMembershipNotifications()) return null;
  if (!notificationsModule) {
    notificationsModule = import('expo-notifications').then(Notifications => {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      return Notifications;
    });
  }
  return notificationsModule;
}

type MembershipAlert = {
  identifier: string;
  title: string;
  body: string;
  date: Date;
  stage: 'warning' | 'expired';
  count: number;
};

function notificationIdentifier(scope: string, date: Date, stage: MembershipAlert['stage'], count: number) {
  return `${MEMBERSHIP_NOTIFICATION_SOURCE}_${scope}_${date.getTime()}_${stage}_${count}`;
}

function activeMembershipAlerts(scope: string, members: Member[], now: number) {
  const grouped = new Map<string, { date: Date; stage: MembershipAlert['stage']; count: number }>();
  const addAlert = (date: Date, stage: MembershipAlert['stage']) => {
    const key = `${stage}_${date.getTime()}`;
    const current = grouped.get(key);
    grouped.set(key, { date, stage, count:(current?.count ?? 0) + 1 });
  };

  for (const member of members) {
    if (member.status !== 'ACTIVE') continue;
    for (const membership of member.memberships) {
      if (!membershipIsCurrent(membership, now)) continue;
      const expiresAt = membershipExpiryInstant(membership.endDate);
      const expiryTime = expiresAt.getTime();
      if (Number.isNaN(expiryTime) || expiryTime <= now) continue;
      const warningDate = shiftMembershipDayStart(membership.endDate, -3);
      if (warningDate.getTime() > now) addAlert(warningDate, 'warning');
      addAlert(expiresAt, 'expired');
    }
  }

  return [...grouped.values()].map(({ date, stage, count }): MembershipAlert => {
    const plural = count !== 1;
    return {
      identifier:notificationIdentifier(scope, date, stage, count),
      title:stage === 'warning'
        ? `Membresía${plural ? 's' : ''} próxima${plural ? 's' : ''} a vencer`
        : `Membresía${plural ? 's' : ''} vencida${plural ? 's' : ''}`,
      body:stage === 'warning'
        ? `${count} membresía${plural ? 's' : ''} vence${plural ? 'n' : ''} dentro de 3 días. Toca para revisar la lista.`
        : `${count} membresía${plural ? 's' : ''} venci${plural ? 'eron' : 'ó'} hoy. Toca para revisar la lista.`,
      date,
      stage,
      count,
    };
  });
}

async function ensureNotificationPermission(Notifications: NotificationsModule) {
  if (Platform.OS === 'android') {
    await Promise.all([
      Notifications.setNotificationChannelAsync(MEMBERSHIP_CHANNEL_ID, {
        name:'Vencimientos de membresías',
        description:'Avisos tres días antes y al vencer una membresía',
        importance:Notifications.AndroidImportance.HIGH,
        sound:'default',
        vibrationPattern:[0, 250, 180, 250],
        lightColor:'#C9F47B',
      }),
      Notifications.setNotificationChannelAsync(SUBSCRIPTION_CHANNEL_ID, {
        name:'Suscripción de GymFlow Mini',
        description:'Avisos sobre el vencimiento de la suscripción del gimnasio',
        importance:Notifications.AndroidImportance.HIGH,
        sound:'default',
        vibrationPattern:[0, 250, 180, 250],
        lightColor:'#C9F47B',
      }),
    ]);
  }
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
  return permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

export async function syncMembershipNotifications(scope: string, members: Member[]) {
  const Notifications = await getNotifications();
  if (!Notifications || !await ensureNotificationPermission(Notifications)) return false;
  const alerts = activeMembershipAlerts(scope, members, Date.now());
  const desired = new Map(alerts.map(alert => [alert.identifier, alert]));
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const managed = scheduled.filter(request => request.content.data?.source === MEMBERSHIP_NOTIFICATION_SOURCE && request.content.data?.scope === scope);

  await Promise.all(managed.filter(request => !desired.has(request.identifier)).map(request => Notifications.cancelScheduledNotificationAsync(request.identifier)));
  const existing = new Set(managed.map(request => request.identifier));
  await Promise.all(alerts.filter(alert => !existing.has(alert.identifier)).map(alert => Notifications.scheduleNotificationAsync({
    identifier:alert.identifier,
    content:{
      title:alert.title,
      body:alert.body,
      sound:'default',
      color:'#173F31',
      priority:Notifications.AndroidNotificationPriority.HIGH,
      data:{
        source:MEMBERSHIP_NOTIFICATION_SOURCE,
        scope,
        stage:alert.stage,
        count:alert.count,
      },
    },
    trigger:{ type:Notifications.SchedulableTriggerInputTypes.DATE, date:alert.date, channelId:MEMBERSHIP_CHANNEL_ID },
  })));
  return true;
}

export async function cancelMembershipNotifications(scope: string) {
  const Notifications = await getNotifications();
  if (!Notifications) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const managed = scheduled.filter(request => request.content.data?.source === MEMBERSHIP_NOTIFICATION_SOURCE && request.content.data?.scope === scope);
  await Promise.all(managed.map(request => Notifications.cancelScheduledNotificationAsync(request.identifier)));
}

export async function syncSubscriptionNotification(scope: string, gymName: string, subscriptionEndsAt: string | null) {
  const Notifications = await getNotifications();
  if (!Notifications || !await ensureNotificationPermission(Notifications)) return false;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const managed = scheduled.filter(request => request.content.data?.source === SUBSCRIPTION_NOTIFICATION_SOURCE && request.content.data?.scope === scope);
  const endsAt = subscriptionEndsAt ? new Date(subscriptionEndsAt) : new Date(Number.NaN);
  const warningDate = new Date(endsAt);
  warningDate.setDate(warningDate.getDate() - 3);
  const desiredIdentifier = Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now() || warningDate.getTime() <= Date.now()
    ? null
    : `${SUBSCRIPTION_NOTIFICATION_SOURCE}_${scope}_${endsAt.getTime()}_warning`;

  await Promise.all(managed.filter(request => request.identifier !== desiredIdentifier).map(request => Notifications.cancelScheduledNotificationAsync(request.identifier)));
  if (!desiredIdentifier || managed.some(request => request.identifier === desiredIdentifier)) return true;
  await Notifications.scheduleNotificationAsync({
    identifier:desiredIdentifier,
    content:{
      title:'Tu suscripción vence en 3 días',
      body:`La suscripción de ${gymName} está próxima a vencer. Toca para revisarla en Cuenta.`,
      sound:'default',
      color:'#173F31',
      priority:Notifications.AndroidNotificationPriority.HIGH,
      data:{ source:SUBSCRIPTION_NOTIFICATION_SOURCE, scope, stage:'warning' },
    },
    trigger:{ type:Notifications.SchedulableTriggerInputTypes.DATE, date:warningDate, channelId:SUBSCRIPTION_CHANNEL_ID },
  });
  return true;
}

export async function cancelSubscriptionNotifications(scope: string) {
  const Notifications = await getNotifications();
  if (!Notifications) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const managed = scheduled.filter(request => request.content.data?.source === SUBSCRIPTION_NOTIFICATION_SOURCE && request.content.data?.scope === scope);
  await Promise.all(managed.map(request => Notifications.cancelScheduledNotificationAsync(request.identifier)));
}
