import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { api } from '../../api';
import { BottomSheet, FormField, FormKeyboardContext, useRevealFocusedInput } from '../../components/BottomSheet';
import { APP_VERSION, FEATURES, RENEWAL_MESSAGE, RENEWAL_WHATSAPP } from '../../core/config';
import { membershipRemainingDays, shiftMembershipDayStart } from '../../membershipDates';
import { SUBSCRIPTION_VALIDATION_MESSAGE } from '../../trustedClock';
import type { GymSubscriptionPlan, User } from '../../types';
import { darkPalette, palette } from '../../theme/colors';
import { styles } from '../../theme/appStyles';
import { formatDate } from '../../utils/domainFormatters';

export type ThemePreference = 'system' | 'light' | 'dark';
type SubscriptionAccess = 'ACTIVE' | 'EXPIRING_TODAY' | 'EXPIRED' | 'VALIDATION_REQUIRED';

type AccountScreenProps = {
  user: User;
  onUserChange: (user: User) => void;
  themePreference: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onLogout: () => void;
  passwordOpen: boolean;
  onPasswordOpenChange: (open: boolean) => void;
  onOpenStaff: () => void;
  dark: boolean;
  getSubscriptionAccess: () => { status: SubscriptionAccess; now: number };
  getGymSubscriptionLabel: (plan: GymSubscriptionPlan | null) => string;
  onError: (error: unknown) => void;
  onSuccess: (message: string) => void;
  onPending: (message: string) => void;
  onRejected: (message: string) => void;
  renderModalOverlay?: (active: boolean) => ReactNode;
};

export function AccountScreen({ user, onUserChange, themePreference, onThemeChange, onLogout, passwordOpen, onPasswordOpenChange, onOpenStaff, dark, getSubscriptionAccess, getGymSubscriptionLabel, onError, onSuccess, onPending, onRejected, renderModalOverlay }: AccountScreenProps) {
  const [requestingPlan,setRequestingPlan]=useState<GymSubscriptionPlan|null>(null);
  const [changingRequest,setChangingRequest]=useState(false);
  const [profileOpen,setProfileOpen]=useState(false);
  const [currentPassword,setCurrentPassword]=useState(''); const [newPassword,setNewPassword]=useState(''); const [passwordConfirmation,setPasswordConfirmation]=useState(''); const [savingPassword,setSavingPassword]=useState(false);
  const passwordScrollRef=useRef<ScrollView>(null); const revealPasswordField=useRevealFocusedInput(passwordScrollRef,120); const keyboardOpen=useKeyboardOpen();
  const confirmLogout = () => Alert.alert('Cerrar sesión', '¿Deseas salir de GymFlow Mini en este dispositivo?', [{ text:'Cancelar', style:'cancel' }, { text:'Cerrar sesión', style:'destructive', onPress:onLogout }]);
  const plan = user.gym.subscriptionPlan;
  const access = getSubscriptionAccess();
  const verificationRequired = access.status === 'VALIDATION_REQUIRED';
  const expired = access.status === 'EXPIRED';
  const expiringToday = access.status === 'EXPIRING_TODAY';
  const requiresAttention = expired || verificationRequired || expiringToday;
  const remaining = user.gym.subscriptionEndsAt ? membershipRemainingDays(user.gym.subscriptionEndsAt, access.now) : 0;
  const openWhatsApp = (message:string) => { if(!RENEWAL_WHATSAPP){onError(new Error('Configura el número de renovación de GymFlow Mini.'));return;} const url=`https://wa.me/${RENEWAL_WHATSAPP}?text=${encodeURIComponent(message)}`; void Linking.openURL(url).catch(() => onError(new Error('Comprueba que WhatsApp esté instalado.'))); };
  const expiry = formatDate(user.gym.subscriptionEndsAt);
  const renewalWindowOpen = expired || remaining <= 3;
  const renewalAvailableDate = user.gym.subscriptionEndsAt ? formatDate(shiftMembershipDayStart(user.gym.subscriptionEndsAt,-3).toISOString()) : '';
  const scheduledPlan = user.gym.scheduledSubscriptionPlan;
  const gatedHint = scheduledPlan ? `Ya está programado el plan ${scheduledPlan==='MONTHLY'?'mensual':'anual'}.` : `Disponible desde el ${renewalAvailableDate}, cuando falten 3 días.`;
  const actions: Array<{label:string;plan:Exclude<GymSubscriptionPlan,'TRIAL'>;action:'RENEW'|'CHANGE';disabled:boolean;hint?:string}> = plan==='TRIAL'
    ? [
        { label:'Adquirir plan mensual', plan:'MONTHLY', action:'CHANGE', disabled:!!scheduledPlan, hint:scheduledPlan?gatedHint:undefined },
        { label:'Adquirir plan anual', plan:'ANNUAL', action:'CHANGE', disabled:!!scheduledPlan, hint:scheduledPlan?gatedHint:undefined },
      ]
    : plan==='MONTHLY'
      ? [
          { label:'Renovar plan mensual', plan:'MONTHLY', action:'RENEW', disabled:!!scheduledPlan||!renewalWindowOpen, hint:!!scheduledPlan||!renewalWindowOpen?gatedHint:undefined },
          { label:'Cambiar a plan anual', plan:'ANNUAL', action:'CHANGE', disabled:!!scheduledPlan, hint:scheduledPlan?gatedHint:undefined },
        ]
      : [
          { label:'Renovar plan anual', plan:'ANNUAL', action:'RENEW', disabled:!!scheduledPlan||!renewalWindowOpen, hint:!!scheduledPlan||!renewalWindowOpen?gatedHint:undefined },
          { label:'Cambiar a plan mensual', plan:'MONTHLY', action:'CHANGE', disabled:!!scheduledPlan||!renewalWindowOpen, hint:!!scheduledPlan||!renewalWindowOpen?gatedHint:undefined },
        ];
  const requestWhatsAppMessage=(current:User)=>{const request=current.subscriptionRequest;if(!request)return'';const requestedPlan=request.plan==='MONTHLY'?'mensual':'anual';const operation=request.action==='RENEW'?'renovar':request.action==='CHANGE'?'cambiar al':'activar el';return `Hola, soy ${current.name}. Quiero ${operation} plan ${requestedPlan} para ${current.gym.name}. Código de solicitud: ${request.code}. Teléfono: ${current.phone??'no indicado'}. Correo: ${current.email}.`;};
  const runSubscriptionAction=async(action:(typeof actions)[number])=>{setRequestingPlan(action.plan);try{const updated=await api.selectSubscription(action.plan,action.action);onUserChange(updated);setChangingRequest(false);}catch(error){onError(error);}finally{setRequestingPlan(null);}};
  const refreshRequest=async()=>{const requestCode=user.subscriptionRequest?.code;setRequestingPlan(user.subscriptionRequest?.plan??'MONTHLY');try{const updated=await api.refreshProfile();onUserChange(updated);setChangingRequest(false);const resolved=requestCode&&updated.latestSubscriptionRequest?.code===requestCode?updated.latestSubscriptionRequest:null;if(resolved?.status==='REJECTED')onRejected('La solicitud fue rechazada. Tu plan anterior no sufrió cambios.');else if(resolved?.status==='CANCELLED')onError(new Error('La solicitud fue cancelada o reemplazada.'));else if(updated.subscriptionRequest?.code===requestCode)onPending('La solicitud continúa pendiente.');else if(resolved?.status==='APPROVED'&&updated.gym.scheduledSubscriptionPlan)onSuccess(`La operación fue aprobada. El plan ${updated.gym.scheduledSubscriptionPlan==='MONTHLY'?'mensual':'anual'} comenzará el ${formatDate(updated.gym.scheduledSubscriptionStartsAt??null)}.`);else if(resolved?.status==='APPROVED')onSuccess('La operación fue aprobada y tu plan está actualizado.');else onError(new Error('La solicitud ya no está pendiente. Actualiza o crea una nueva solicitud.'));}catch(error){onError(error);}finally{setRequestingPlan(null);}};
  const status = verificationRequired ? 'Verificar' : !plan ? 'Sin plan' : expired ? 'Vencida' : expiringToday ? 'Vence hoy' : 'Activa';
  const actionCopy = scheduledPlan
    ? `Tu cambio al plan ${scheduledPlan==='MONTHLY'?'mensual':'anual'} comenzará el ${formatDate(user.gym.scheduledSubscriptionStartsAt??null)}. Hasta entonces conservas el plan actual.`
    : verificationRequired
    ? SUBSCRIPTION_VALIDATION_MESSAGE
    : !plan
      ? 'Activa una suscripción para habilitar nuevamente todas las operaciones.'
      : expired
        ? RENEWAL_MESSAGE
        : expiringToday
          ? user.subscriptionRequest&&!changingRequest
            ? 'Puedes seguir usando todas las funciones durante el día de hoy mientras se comprueba tu pago P2P.'
            : 'Puedes seguir usando todas las funciones durante el día de hoy mientras gestionas el pago P2P.'
          : user.subscriptionRequest&&!changingRequest
            ? 'Tu solicitud está pendiente. El plan actual seguirá disponible hasta su vencimiento.'
            : plan==='TRIAL'
              ? 'Tu prueba está activa. Puedes adquirir un plan sin perder los días restantes.'
              : '';
  const accountSubscriptionCopy = user.role === 'ADMIN'
    ? actionCopy
    : expiringToday
      ? 'Puedes seguir usando todas las funciones durante el día de hoy. Un administrador gestiona el pago P2P y la renovación.'
      : 'Un administrador gestiona la renovación y los cambios del plan.';
  const closePasswordPage=()=>{Keyboard.dismiss();onPasswordOpenChange(false);};
  const savePassword=async()=>{if(newPassword!==passwordConfirmation){onError(new Error('Las contraseñas no coinciden'));return;}setSavingPassword(true);try{const updated=await api.changePassword({currentPassword,newPassword});onUserChange(updated);onPasswordOpenChange(false);setCurrentPassword('');setNewPassword('');setPasswordConfirmation('');onSuccess('Contraseña actualizada. Las demás sesiones se invalidarán al conectarse.');}catch(error){onError(error);}finally{setSavingPassword(false);}};
  useEffect(()=>{if(passwordOpen)return;setCurrentPassword('');setNewPassword('');setPasswordConfirmation('');},[passwordOpen]);
  if(passwordOpen)return <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={styles.memberFormPage}>
    <View style={styles.memberFormHeader}><View style={styles.memberFormHeaderRow}><Pressable accessibilityRole="button" accessibilityLabel="Volver a cuenta" onPress={closePasswordPage} style={({pressed})=>[styles.memberFormBack,pressed&&styles.tabPressed]}><Ionicons name="arrow-back" size={19} color={dark?darkPalette.text:palette.ink}/><Text style={styles.memberFormBackText}>Volver</Text></Pressable><Text style={styles.memberFormStep}>SEGURIDAD</Text><View style={styles.passwordHeaderSpacer}/></View><Text style={styles.memberFormTitle}>Cambiar contraseña</Text><Text style={styles.memberFormCopy}>Protege el acceso a tu cuenta con una contraseña nueva.</Text></View>
    <ScrollView ref={passwordScrollRef} style={styles.memberFormScroll} contentContainerStyle={[styles.memberFormContent,keyboardOpen&&styles.memberFormContentKeyboard]} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} showsVerticalScrollIndicator={keyboardOpen}><FormKeyboardContext.Provider value={revealPasswordField}><View style={styles.passwordSecurityNotice}><Ionicons name="shield-checkmark-outline" size={21} color={dark?darkPalette.action:palette.action}/><Text style={styles.passwordSecurityNoticeText}>Necesitas conexión. Después del cambio, las demás sesiones dejarán de ser válidas cuando intenten conectarse.</Text></View><FormField dark={dark} label="Contraseña actual" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry autoCapitalize="none"/><FormField dark={dark} label="Nueva contraseña" value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none"/><FormField dark={dark} label="Confirma la nueva contraseña" value={passwordConfirmation} onChangeText={setPasswordConfirmation} secureTextEntry autoCapitalize="none" returnKeyType="done" onSubmitEditing={()=>void savePassword()}/><Text style={styles.registrationNote}>La nueva contraseña debe tener al menos 8 caracteres.</Text></FormKeyboardContext.Provider></ScrollView>
    {!keyboardOpen?<View style={styles.memberFormFooter}><PrimaryButton label={savingPassword?'Guardando…':'Guardar contraseña'} onPress={()=>void savePassword()} disabled={savingPassword||currentPassword.length<8||newPassword.length<8||!passwordConfirmation}/></View>:null}
  </KeyboardAvoidingView>;
  return <><ScrollView contentContainerStyle={styles.accountScroll}>
    <View style={styles.accountHero}><Text style={styles.accountHeroLabel}>GIMNASIO</Text><Text numberOfLines={2} ellipsizeMode="tail" adjustsFontSizeToFit maxFontSizeMultiplier={1.35} style={styles.accountHeroGym}>{user.gym.name}</Text></View>
    <View style={[styles.subscriptionCard,requiresAttention&&styles.subscriptionCardExpired]}>
      <View style={styles.subscriptionHead}><View style={[styles.subscriptionIcon,requiresAttention&&styles.subscriptionIconExpired]}><Ionicons name={requiresAttention?'alert-circle-outline':'shield-checkmark-outline'} size={23} color={requiresAttention?palette.danger:palette.action}/></View><View style={styles.rowMain}><Text style={styles.subscriptionEyebrow}>SUSCRIPCIÓN DE GYMFLOW MINI</Text><Text style={[styles.subscriptionName,requiresAttention&&styles.subscriptionNameExpired]}>{getGymSubscriptionLabel(plan)}</Text></View><View style={[styles.subscriptionBadge,requiresAttention&&styles.subscriptionBadgeExpired]}><Text style={[styles.subscriptionBadgeText,requiresAttention&&styles.subscriptionBadgeTextExpired]}>{status}</Text></View></View>
      <View style={styles.subscriptionDates}><View><Text style={styles.subscriptionDateLabel}>FECHA DE VENCIMIENTO</Text><Text style={styles.subscriptionDateValue}>{expiry}</Text></View>{!expired&&!verificationRequired?<Text style={styles.subscriptionRemaining}>{expiringToday?'Disponible durante todo el día':`${remaining} día${remaining===1?'':'s'} restante${remaining===1?'':'s'}`}</Text>:null}</View>
      <Text style={[styles.subscriptionActionCopy,requiresAttention&&styles.subscriptionExpiredCopy]}>{accountSubscriptionCopy}</Text>
      {user.role === 'ADMIN' ? user.subscriptionRequest&&!changingRequest?<View style={styles.accountPendingRequest}><View style={styles.accountRequestCode}><Text style={styles.accountRequestLabel}>SOLICITUD PENDIENTE</Text><Text selectable style={styles.accountRequestValue}>{user.subscriptionRequest.code}</Text></View><Text style={styles.accountRequestedPlan}>{user.subscriptionRequest.action==='RENEW'?'Renovación':'Cambio'} · {user.subscriptionRequest.plan==='MONTHLY'?'Plan mensual · 5 000 CUP':'Plan anual · 50 000 CUP'}</Text><Pressable disabled={!!requestingPlan} accessibilityRole="link" accessibilityLabel="Contactar por WhatsApp" onPress={()=>openWhatsApp(requestWhatsAppMessage(user))} style={({pressed})=>[styles.whatsappButton,styles.whatsappButtonInGroup,pressed&&styles.tabPressed]}><Ionicons name="logo-whatsapp" size={19} color={palette.white}/><Text style={styles.whatsappButtonText}>Contactar por WhatsApp</Text></Pressable><PrimaryButton label={requestingPlan?'Comprobando…':'Comprobar activación'} onPress={refreshRequest} disabled={!!requestingPlan}/><Pressable disabled={!!requestingPlan} onPress={()=>setChangingRequest(true)} style={styles.changePlanButton}><Text style={styles.changePlanText}>Cambiar la solicitud</Text></Pressable></View>:<View style={styles.subscriptionActionGroup}>{actions.map((action,index)=><View key={action.label}><Pressable disabled={!!requestingPlan||action.disabled} accessibilityRole="button" accessibilityState={{disabled:!!requestingPlan||action.disabled}} accessibilityLabel={action.label} onPress={()=>void runSubscriptionAction(action)} style={({pressed}) => [styles.planRequestButton,index>0&&styles.planRequestButtonSecondary,(!!requestingPlan||action.disabled)&&styles.disabled,pressed&&styles.tabPressed]}>{requestingPlan===action.plan?<ActivityIndicator color={index>0?palette.action:palette.white}/>:<Ionicons name={action.label.startsWith('Cambiar')?'swap-horizontal-outline':'calendar-outline'} size={19} color={index>0?palette.action:palette.white}/>}<Text style={[styles.planRequestButtonText,index>0&&styles.planRequestButtonTextSecondary]}>{action.label}</Text></Pressable>{action.hint?<Text style={styles.planRequestDisabledHint}>{action.hint}</Text>:null}</View>)}</View> : null}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Ver mis datos" onPress={()=>setProfileOpen(true)} style={({pressed})=>[styles.securityButton,pressed&&styles.tabPressed]}><View style={styles.securityIcon}><Ionicons name="person-outline" size={22} color={palette.action}/></View><View style={styles.rowMain}><Text style={styles.securityTitle}>Mis datos</Text><Text numberOfLines={1} style={styles.securityCopy}>{user.name}</Text></View><Ionicons name="chevron-forward" size={20} color={palette.secondary}/></Pressable>
    {FEATURES.staffEntry && user.role === 'ADMIN' ? <Pressable accessibilityRole="button" onPress={onOpenStaff} style={({pressed})=>[styles.securityButton,pressed&&styles.tabPressed]}><View style={styles.securityIcon}><Ionicons name="people-outline" size={22} color={palette.action}/></View><View style={styles.rowMain}><Text style={styles.securityTitle}>Personal y acceso</Text><Text style={styles.securityCopy}>Gestiona recepcionistas y solicita administradores</Text></View><Ionicons name="chevron-forward" size={20} color={palette.secondary}/></Pressable> : null}
    <Pressable accessibilityRole="button" onPress={()=>onPasswordOpenChange(true)} style={({pressed})=>[styles.securityButton,pressed&&styles.tabPressed]}><View style={styles.securityIcon}><Ionicons name="key-outline" size={22} color={palette.action}/></View><View style={styles.rowMain}><Text style={styles.securityTitle}>Cambiar contraseña</Text><Text style={styles.securityCopy}>Actualiza tu acceso e invalida las demás sesiones</Text></View><Ionicons name="chevron-forward" size={20} color={palette.secondary}/></Pressable>
    <Pressable accessibilityRole="link" accessibilityLabel="Contactar soporte por WhatsApp" onPress={()=>openWhatsApp(`Hola, soy ${user.name}, administrador de ${user.gym.name}. Necesito soporte con GymFlow Mini.`)} style={({pressed})=>[styles.supportButton,pressed&&styles.tabPressed]}><View style={styles.supportIcon}><Ionicons name="logo-whatsapp" size={23} color={palette.white}/></View><View style={styles.rowMain}><Text style={styles.supportTitle}>Soporte por WhatsApp</Text><Text style={styles.supportCopy}>Contacta directamente con el equipo de GymFlow Mini</Text></View><Ionicons name="open-outline" size={19} color={palette.white}/></Pressable>
    {FEATURES.themeSelector ? <ThemeSelector value={themePreference} onChange={onThemeChange}/> : null}
    <Pressable accessibilityRole="button" onPress={confirmLogout} style={({pressed}) => [styles.logoutButton, pressed && styles.logoutButtonPressed]}><View style={styles.logoutIcon}><Ionicons name="log-out-outline" size={22} color={palette.danger}/></View><View style={styles.rowMain}><Text style={styles.logoutTitle}>Cerrar sesión</Text><Text style={styles.logoutCopy}>Salir de esta cuenta en el dispositivo</Text></View></Pressable>
    <Text style={styles.accountVersion}>© 2026 GYMFLOW MINI · TODOS LOS DERECHOS RESERVADOS · V{APP_VERSION}</Text>
  </ScrollView><BottomSheet dark={dark} overlay={renderModalOverlay?.(profileOpen)} open={profileOpen} title="Mis datos" onClose={()=>setProfileOpen(false)}><View style={styles.accountCard}><AccountRow label="Nombre" value={user.name}/><AccountRow label="Correo" value={user.email}/><AccountRow label="Gimnasio" value={user.gym.name}/>{user.gym.municipality&&user.gym.province?<AccountRow label="Ubicación" value={`${user.gym.municipality}, ${user.gym.province}`}/>:null}<AccountRow label="Moneda" value={user.gym.currency} last/></View></BottomSheet></>;
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


function useKeyboardOpen() {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return keyboardOpen;
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.primary, disabled && styles.disabled, pressed && styles.tabPressed]}><Text maxFontSizeMultiplier={1.3} style={styles.primaryText}>{label}</Text></Pressable>;
}
