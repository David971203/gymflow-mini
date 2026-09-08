import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../api';
import { RENEWAL_WHATSAPP } from '../../core/config';
import { palette } from '../../theme/colors';
import type { GymSubscriptionPlan, User } from '../../types';

type SubscriptionGateProps = {
  user: User;
  onUserChange: (user: User) => void;
  onLogout: () => void;
  onError: (error: unknown) => void;
  onSuccess: (message: string) => void;
  onPending: (message: string) => void;
  onRejected: (message: string) => void;
};

export function SubscriptionGate(props: SubscriptionGateProps) {
  if (props.user.role !== 'ADMIN') {
    return <StaffSubscriptionBlocked user={props.user} onLogout={props.onLogout}/>;
  }
  return <SubscriptionSetup {...props}/>;
}

function SubscriptionSetup({ user, onUserChange, onLogout, onError, onSuccess, onPending, onRejected }: SubscriptionGateProps) {
  const [loading,setLoading]=useState<GymSubscriptionPlan|null>(null);
  const request=user.subscriptionRequest;
  const openWhatsApp=(current:User)=>{
    if(!RENEWAL_WHATSAPP){onError(new Error('Configura el número de WhatsApp de GymFlow Mini.'));return;}
    const pending=current.subscriptionRequest;
    if(!pending)return;
    const message=pending.plan==='TRIAL'
      ?`Hola, soy ${current.name}. Solicito verificar manualmente mi teléfono +53 ${current.phone??'no indicado'} para activar la prueba de ${current.gym.name}. Código ${pending.code}. Estoy escribiendo desde el mismo número registrado.`
      :`Hola, soy ${current.name}. Solicito el plan ${pending.plan==='MONTHLY'?'mensual':'anual'} para ${current.gym.name}. Código ${pending.code}. Teléfono ${current.phone??'no indicado'} y correo ${current.email}.`;
    void Linking.openURL(`https://wa.me/${RENEWAL_WHATSAPP}?text=${encodeURIComponent(message)}`).catch(()=>onError(new Error('Comprueba que WhatsApp esté instalado.')));
  };
  const choose=async(plan:GymSubscriptionPlan)=>{setLoading(plan);try{const updated=await api.selectSubscription(plan,'ACTIVATE');onUserChange(updated);if(plan==='TRIAL')openWhatsApp(updated);}catch(error){onError(error);}finally{setLoading(null);}};
  const resendTrial=async()=>{setLoading('TRIAL');try{const updated=await api.selectSubscription('TRIAL','ACTIVATE');onUserChange(updated);openWhatsApp(updated);}catch(error){onError(error);}finally{setLoading(null);}};
  const refresh=async()=>{
    const requestCode=request?.code;
    setLoading(request?.plan??'MONTHLY');
    try{
      const updated=await api.refreshProfile();
      onUserChange(updated);
      const resolved=requestCode&&updated.latestSubscriptionRequest?.code===requestCode?updated.latestSubscriptionRequest:null;
      if(resolved?.status==='REJECTED')onRejected('La solicitud fue rechazada. Revisa el pago o elige otro plan.');
      else if(resolved?.status==='CANCELLED')onError(new Error('La solicitud fue cancelada o reemplazada. Puedes elegir otro plan.'));
      else if(updated.subscriptionRequest?.code===requestCode)onPending('La solicitud continúa pendiente.');
      else if(updated.gym.subscriptionPlan)onSuccess('Tu plan ya está activo.');
      else onError(new Error('La solicitud ya no está pendiente. Elige un plan para continuar.'));
    }catch(error){onError(error);}finally{setLoading(null);}
  };

  return <SafeAreaView style={styles.offerPage} edges={['top','right','bottom','left']}><StatusBar style="dark"/><ScrollView contentContainerStyle={styles.offerScroll} showsVerticalScrollIndicator={false}><Text style={styles.offerBrand}>GymFlow <Text style={styles.offerMini}>MINI</Text></Text>
    {request?<View style={styles.pendingCard}><View style={styles.pendingIcon}><Ionicons name="time-outline" size={28} color={palette.warning}/></View><Text style={styles.offerEyebrow}>SOLICITUD EN REVISIÓN</Text><Text style={styles.pendingTitle}>Tu cuenta ya está creada</Text><Text style={styles.pendingCopy}>{request.plan==='TRIAL'?'Escríbenos desde el mismo número registrado. Verificaremos manualmente el teléfono y activaremos tu prueba.':'Coordina el pago P2P por WhatsApp. Cuando aprobemos la operación podrás entrar a la plataforma.'}</Text><View style={styles.requestCode}><Text style={styles.requestCodeLabel}>CÓDIGO DE SOLICITUD</Text><Text selectable style={styles.requestCodeValue}>{request.code}</Text></View><View style={styles.pendingPlan}><Text style={styles.pendingPlanLabel}>Plan solicitado</Text><Text style={styles.pendingPlanValue}>{request.plan==='TRIAL'?'Prueba gratuita · 7 días':request.plan==='MONTHLY'?'Mensual · 5 000 CUP':'Anual · 50 000 CUP'}</Text></View><View style={styles.pendingActions}><Pressable disabled={!!loading} accessibilityRole="link" accessibilityLabel="Contactar por WhatsApp" onPress={()=>request.plan==='TRIAL'?void resendTrial():openWhatsApp(user)} style={styles.offerWhatsapp}><Ionicons name="logo-whatsapp" size={21} color={palette.white}/><Text style={styles.offerWhatsappText}>{request.plan==='TRIAL'?'Reenviar por WhatsApp':'Contactar por WhatsApp'}</Text></Pressable><PrimaryButton label={loading?'Comprobando…':'Comprobar activación'} onPress={refresh} disabled={!!loading}/></View><Pressable onPress={()=>onUserChange({...user,subscriptionRequest:null})} style={styles.changePlanButton}><Text style={styles.changePlanText}>Elegir otro plan</Text></Pressable></View>
    :<><Text style={styles.offerEyebrow}>ELIGE CÓMO COMENZAR</Text><Text style={styles.offerTitle}>Tu gimnasio ya tiene una cuenta.</Text><Text style={styles.offerCopy}>Prueba todas las funciones o solicita un plan. Tus datos permanecerán guardados.</Text><View style={styles.offerList}><OfferCard title="Prueba gratuita" price="0 CUP" detail="7 días · verificación por WhatsApp" icon="gift-outline" loading={loading==='TRIAL'} disabled={!!loading} onPress={()=>void choose('TRIAL')}/><OfferCard title="Plan mensual" price="5 000 CUP" detail="1 mes · pago P2P" icon="calendar-outline" featured loading={loading==='MONTHLY'} disabled={!!loading} onPress={()=>void choose('MONTHLY')}/><OfferCard title="Plan anual" price="50 000 CUP" detail="1 año · ahorra 10 000 CUP" icon="trophy-outline" loading={loading==='ANNUAL'} disabled={!!loading} onPress={()=>void choose('ANNUAL')}/></View><View style={styles.trialProtection}><Ionicons name="shield-checkmark-outline" size={15} color={palette.secondary}/><Text style={styles.trialProtectionText}>La prueba se concede una sola vez por teléfono verificado y dispositivo.</Text></View></>}
    <Pressable onPress={onLogout} style={styles.offerLogout}><Text style={styles.offerLogoutText}>Cerrar sesión</Text></Pressable></ScrollView></SafeAreaView>;
}

function OfferCard({title,price,detail,icon,featured,loading,disabled,onPress}:{title:string;price:string;detail:string;icon:ComponentProps<typeof Ionicons>['name'];featured?:boolean;loading:boolean;disabled:boolean;onPress:()=>void}) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={({pressed})=>[styles.offerCard,featured&&styles.offerCardFeatured,pressed&&styles.pressed,disabled&&styles.offerCardDisabled]}><View style={[styles.offerIcon,featured&&styles.offerIconFeatured]}><Ionicons name={icon} size={23} color={featured?palette.white:palette.action}/></View><View style={styles.rowMain}><Text style={styles.offerCardTitle}>{title}</Text><Text style={styles.offerCardDetail}>{detail}</Text></View><View style={styles.offerPriceWrap}><Text style={styles.offerPrice}>{price}</Text>{loading?<ActivityIndicator color={palette.action}/>:<Ionicons name="arrow-forward-circle" size={23} color={palette.action}/>}</View></Pressable>;
}

function StaffSubscriptionBlocked({ user, onLogout }: { user: User; onLogout: () => void }) {
  return <SafeAreaView style={styles.offerPage} edges={['top','right','bottom','left']}><StatusBar style="dark"/><View style={styles.center}><View style={styles.pendingCard}><View style={styles.pendingIcon}><Ionicons name="shield-outline" size={28} color={palette.warning}/></View><Text style={styles.offerEyebrow}>ACCESO PENDIENTE</Text><Text style={styles.pendingTitle}>{user.gym.name} no tiene un plan activo</Text><Text style={styles.pendingCopy}>Pide a un administrador del gimnasio que active o renueve la suscripción de GymFlow Mini.</Text><Pressable onPress={onLogout} style={styles.offerLogout}><Text style={styles.offerLogoutText}>Cerrar sesión</Text></Pressable></View></View></SafeAreaView>;
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled:!!disabled}} onPress={onPress} disabled={disabled} style={({pressed})=>[styles.primary,disabled&&styles.disabled,pressed&&styles.pressed]}><Text maxFontSizeMultiplier={1.3} style={styles.primaryText}>{label}</Text></Pressable>;
}

function withReadableType<T extends StyleSheet.NamedStyles<T>>(source: T): T {
  Object.values(source).forEach((style)=>{const textStyle=style as {fontSize?:number};if(typeof textStyle.fontSize==='number'&&textStyle.fontSize<=10)textStyle.fontSize=12;});
  return source;
}

const styles=StyleSheet.create(withReadableType({
  center:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:palette.brand},rowMain:{flex:1},pressed:{opacity:.65},disabled:{opacity:.45},
  offerPage:{flex:1,backgroundColor:palette.background},offerScroll:{flexGrow:1,paddingHorizontal:22,paddingTop:28,paddingBottom:24},offerBrand:{color:palette.brand,fontSize:22,fontWeight:'900'},offerMini:{color:palette.action,fontSize:11,letterSpacing:2},offerEyebrow:{marginTop:38,color:palette.action,fontSize:10,fontWeight:'900',letterSpacing:1.25},offerTitle:{marginTop:8,color:palette.ink,fontSize:30,lineHeight:35,fontWeight:'900',letterSpacing:-1},offerCopy:{marginTop:10,color:palette.secondary,fontSize:14,lineHeight:21},offerList:{marginTop:26,gap:12},offerCard:{minHeight:94,padding:14,flexDirection:'row',alignItems:'center',gap:12,borderWidth:1,borderColor:palette.line,borderRadius:18,backgroundColor:palette.white},offerCardFeatured:{borderColor:'#83b79d',backgroundColor:'#f2faf5'},offerCardDisabled:{opacity:.65},offerIcon:{width:45,height:45,borderRadius:14,alignItems:'center',justifyContent:'center',backgroundColor:'#e5f2e9'},offerIconFeatured:{backgroundColor:palette.action},offerCardTitle:{color:palette.ink,fontSize:15,fontWeight:'900'},offerCardDetail:{marginTop:5,color:palette.secondary,fontSize:10,fontWeight:'700'},offerPriceWrap:{alignItems:'flex-end',gap:8},offerPrice:{color:palette.action,fontSize:12,fontWeight:'900'},trialProtection:{marginTop:18,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6},trialProtectionText:{flex:1,color:palette.secondary,fontSize:10,lineHeight:15,fontWeight:'700'},offerLogout:{minHeight:44,marginTop:'auto',alignItems:'center',justifyContent:'center'},offerLogoutText:{color:palette.secondary,fontSize:12,fontWeight:'800'},pendingCard:{marginTop:28,padding:22,borderWidth:1,borderColor:'#ead7bd',borderRadius:22,backgroundColor:palette.white},pendingIcon:{width:54,height:54,borderRadius:18,alignItems:'center',justifyContent:'center',backgroundColor:'#fff1df'},pendingTitle:{marginTop:8,color:palette.ink,fontSize:25,fontWeight:'900'},pendingCopy:{marginTop:10,color:palette.secondary,fontSize:13,lineHeight:20},requestCode:{marginTop:22,padding:15,alignItems:'center',gap:6,borderRadius:14,backgroundColor:'#f2f5f3'},requestCodeLabel:{color:palette.secondary,fontSize:9,fontWeight:'900',letterSpacing:1},requestCodeValue:{color:palette.action,fontSize:24,fontWeight:'900',letterSpacing:1.5},pendingPlan:{marginTop:12,paddingVertical:12,flexDirection:'row',justifyContent:'space-between',gap:12,borderBottomWidth:1,borderBottomColor:palette.line},pendingPlanLabel:{color:palette.secondary,fontSize:11,fontWeight:'700'},pendingPlanValue:{color:palette.ink,fontSize:11,fontWeight:'900'},pendingActions:{marginTop:20,gap:12},offerWhatsapp:{height:49,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderRadius:13,backgroundColor:'#1fa855'},offerWhatsappText:{color:palette.white,fontSize:12,fontWeight:'900'},changePlanButton:{minHeight:44,marginTop:4,alignItems:'center',justifyContent:'center'},changePlanText:{color:palette.action,fontSize:11,fontWeight:'900'},
  primary:{minHeight:49,flexDirection:'row',gap:8,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:palette.action},primaryText:{color:palette.white,fontSize:14,fontWeight:'800'},
}));
