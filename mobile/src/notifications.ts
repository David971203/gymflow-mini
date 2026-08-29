import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import type { Member, Membership } from './types';

export const MEMBERSHIP_NOTIFICATION_SOURCE = 'gymflow-membership-expiry';
const MEMBERSHIP_CHANNEL_ID = 'membership-expirations';
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

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
  memberId: string;
  membershipId: string;
};

function contractedPlanName(membership: Membership) {
  return membership.planName ?? membership.plan.name;
}

function notificationIdentifier(scope: string, membership: Membership, stage: MembershipAlert['stage']) {
  const expiry = new Date(membership.endDate).getTime();
  return `${MEMBERSHIP_NOTIFICATION_SOURCE}_${scope}_${membership.id}_${expiry}_${stage}`;
}

function activeMembershipAlerts(scope: string, members: Member[], now: number) {
  const alerts: MembershipAlert[] = [];
  for (const member of members) {
    if (member.status !== 'ACTIVE') continue;
    for (const membership of member.memberships) {
      if (membership.status !== 'ACTIVE') continue;
      const expiresAt = new Date(membership.endDate);
      const expiryTime = expiresAt.getTime();
      if (Number.isNaN(expiryTime) || expiryTime <= now) continue;
      const fullName = `${member.firstName} ${member.lastName}`.trim();
      const planName = contractedPlanName(membership);
      const warningDate = new Date(expiryTime - THREE_DAYS_MS);
      if (warningDate.getTime() > now) {
        alerts.push({
          identifier:notificationIdentifier(scope, membership, 'warning'),
          title:'Membresía próxima a vencer',
          body:`A ${fullName} le quedan 3 días del plan ${planName}.`,
          date:warningDate,
          stage:'warning',
          memberId:member.id,
          membershipId:membership.id,
        });
      }
      alerts.push({
        identifier:notificationIdentifier(scope, membership, 'expired'),
        title:'Membresía vencida',
        body:`La membresía de ${fullName} (${planName}) vence hoy.`,
        date:expiresAt,
        stage:'expired',
        memberId:member.id,
        membershipId:membership.id,
      });
    }
  }
  return alerts;
}

async function ensureNotificationPermission(Notifications: NotificationsModule) {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(MEMBERSHIP_CHANNEL_ID, {
      name:'Vencimientos de membresías',
      description:'Avisos tres días antes y al vencer una membresía',
      importance:Notifications.AndroidImportance.HIGH,
      sound:'default',
      vibrationPattern:[0, 250, 180, 250],
      lightColor:'#C9F47B',
    });
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
        memberId:alert.memberId,
        membershipId:alert.membershipId,
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
