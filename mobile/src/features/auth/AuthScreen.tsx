import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TurboModuleRegistry, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, ApiError } from '../../api';
import { APP_VERSION, GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from '../../core/config';
import { CUBA_LOCATIONS, CUBAN_PROVINCES } from '../../data/cubaLocations';
import { palette } from '../../theme/colors';
import type { User } from '../../types';

type AuthScreenProps = {
  dark: boolean;
  onAuthenticated: (user: User) => void;
  onError: (error: unknown) => void;
  onSuccess: (message: string) => void;
};

const googleSignin = TurboModuleRegistry.get('RNGoogleSignin')
  ? (require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin')).GoogleSignin
  : null;
const googleLoginAvailable = Boolean(googleSignin && GOOGLE_WEB_CLIENT_ID);
const KeyboardScrollContext = createContext<((target: number) => void) | null>(null);

export function AuthScreen({ dark, onAuthenticated, onError, onSuccess }: AuthScreenProps) {
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [recoveringPassword, setRecoveringPassword] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
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

  useEffect(() => {
    if (googleLoginAvailable) googleSignin?.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, ...(GOOGLE_IOS_CLIENT_ID ? { iosClientId: GOOGLE_IOS_CLIENT_ID } : {}), offlineAccess: false });
  }, []);

  const submit = async () => {
    setLoading(true);
    try {
      onAuthenticated(await api.login(email.trim(), password));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EMAIL_NOT_VERIFIED') {
        const pendingEmail = email.trim().toLowerCase();
        setVerificationEmail(pendingEmail);
        try {
          const result = await api.resendEmailVerification(pendingEmail);
          onSuccess(result.message);
        } catch (resendError) {
          onError(resendError);
        }
      } else {
        onError(error);
      }
    } finally {
      setLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    if (!googleSignin || !GOOGLE_WEB_CLIENT_ID) {
      onError(new Error('El acceso con Google requiere la aplicación instalada'));
      return;
    }
    setGoogleLoading(true);
    try {
      if (Platform.OS === 'android') await googleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result = await googleSignin.signIn();
      if (result.type !== 'success') return;
      if (!result.data.idToken) throw new Error('Google no devolvió una credencial válida');
      onAuthenticated(await api.googleLogin(result.data.idToken));
    } catch (error) {
      onError(error);
    } finally {
      setGoogleLoading(false);
    }
  };

  if (verificationEmail) return <EmailVerification dark={dark} email={verificationEmail} onVerified={onAuthenticated} onBack={() => setVerificationEmail('')} onError={onError} onSuccess={onSuccess}/>;
  if (creatingAccount) return <RegisterScreen dark={dark} onRegistered={onAuthenticated} onVerificationRequired={(pendingEmail) => { setCreatingAccount(false); setVerificationEmail(pendingEmail); }} onBack={() => setCreatingAccount(false)} onError={onError} onSuccess={onSuccess}/>;
  if (recoveringPassword) return <PasswordRecovery dark={dark} onBack={() => setRecoveringPassword(false)} onError={onError} onSuccess={onSuccess}/>;

  return <SafeAreaView style={styles.loginPage} edges={['top','right','bottom','left']}>
    <StatusBar style="light" translucent backgroundColor="transparent"/>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.loginKeyboardAvoiding}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} showsVerticalScrollIndicator={false}>
        <KeyboardScrollContext.Provider value={revealLoginInput}>
          <Text style={styles.loginBrand}>GymFlow <Text style={styles.mini}>MINI</Text></Text>
          <Text style={styles.loginTitle}>Tu gimnasio, bajo control.</Text>
          <Text style={styles.loginCopy}>Miembros, planes y caja en una aplicación simple.</Text>
          <View style={[styles.loginCard, dark && darkStyles.loginCard]} onLayout={(event) => { loginCardY.current = event.nativeEvent.layout.y; }}>
            <Field dark={dark} label="Correo" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" returnKeyType="next"/>
            <PasswordField dark={dark} value={password} onChangeText={setPassword} visible={passwordVisible} onToggleVisibility={() => setPasswordVisible((value) => !value)} onSubmit={() => void submit()}/>
            <Pressable accessibilityRole="button" onPress={() => setRecoveringPassword(true)} style={styles.forgotPasswordButton}><Text style={styles.forgotPasswordText}>¿Olvidaste tu contraseña?</Text></Pressable>
            <PrimaryButton label={loading ? 'Entrando…' : 'Entrar'} onPress={submit} disabled={loading || !email.trim() || !password}/>
            {googleLoginAvailable ? <>
              <View style={styles.loginDivider}><View style={[styles.loginDividerLine,dark&&darkStyles.loginDividerLine]}/><Text style={styles.loginDividerText}>o</Text><View style={[styles.loginDividerLine,dark&&darkStyles.loginDividerLine]}/></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Continuar con Google" accessibilityState={{disabled:loading||googleLoading}} disabled={loading||googleLoading} onPress={()=>void loginWithGoogle()} style={({pressed})=>[styles.googleLoginButton,dark&&darkStyles.googleLoginButton,(loading||googleLoading)&&styles.disabled,pressed&&styles.pressed]}>{googleLoading?<ActivityIndicator color="#173f31"/>:<Ionicons name="logo-google" size={20} color="#4285F4"/>}<Text style={[styles.googleLoginText,dark&&darkStyles.googleLoginText]}>{googleLoading?'Conectando…':'Continuar con Google'}</Text></Pressable>
            </> : null}
          </View>
          <View style={styles.loginJoin}><Text style={styles.loginJoinText}>¿Eres dueño de un Gimnasio y no tienes una cuenta?</Text><Pressable accessibilityRole="button" onPress={() => setCreatingAccount(true)}><Text style={styles.loginJoinLink}>Crear cuenta</Text></Pressable></View>
          <Text style={styles.version}>V{APP_VERSION}</Text>
        </KeyboardScrollContext.Provider>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

type FeedbackProps = Pick<AuthScreenProps, 'onError' | 'onSuccess'>;

function EmailVerification({ dark, email, onVerified, onBack, onError, onSuccess }: FeedbackProps & { dark: boolean; email: string; onVerified: (user: User) => void; onBack: () => void }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { Keyboard.dismiss(); onBack(); return true; });
    return () => subscription.remove();
  }, [onBack]);
  const verify = async () => { setLoading(true); try { onVerified(await api.verifyEmail(email,code)); onSuccess('Correo verificado. Tu cuenta está lista.'); } catch (error) { onError(error); } finally { setLoading(false); } };
  const resend = async () => { setResending(true); try { const result=await api.resendEmailVerification(email); onSuccess(result.message); } catch (error) { onError(error); } finally { setResending(false); } };
  return <SafeAreaView style={styles.loginPage} edges={['top','right','bottom','left']}><StatusBar style="light" translucent backgroundColor="transparent"/><KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={styles.loginKeyboardAvoiding}><ScrollView contentContainerStyle={styles.registerScroll} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} showsVerticalScrollIndicator={false}>
    <Pressable accessibilityRole="button" accessibilityLabel="Volver al inicio de sesión" onPress={onBack} style={styles.authBack}><Ionicons name="arrow-back" size={20} color={palette.white}/><Text style={styles.authBackText}>Volver</Text></Pressable><Text style={styles.loginBrand}>GymFlow <Text style={styles.mini}>MINI</Text></Text><Text style={styles.registerTitle}>Verifica tu correo</Text><Text style={styles.loginCopy}>Escribe el código de 6 dígitos enviado a {email}.</Text>
    <View style={[styles.loginCard,dark&&darkStyles.loginCard]}><View style={[styles.verificationIcon,dark&&darkStyles.verificationIcon]}><Ionicons name="mail-outline" size={26} color={palette.action}/></View><Field dark={dark} label="Código de verificación" value={code} onChangeText={value=>setCode(value.replace(/\D/g,'').slice(0,6))} keyboardType="number-pad" maxLength={6} returnKeyType="done" onSubmitEditing={()=>void verify()}/><Text style={styles.registrationNote}>El código vence en 15 minutos y admite hasta cinco intentos.</Text><PrimaryButton label={loading?'Verificando…':'Verificar correo'} onPress={verify} disabled={loading||resending||code.length!==6}/><Pressable accessibilityRole="button" disabled={loading||resending} onPress={()=>void resend()} style={styles.resendCodeButton}><Text style={styles.forgotPasswordText}>{resending?'Enviando…':'Reenviar código'}</Text></Pressable></View>
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

function PasswordRecovery({ dark, onBack, onError, onSuccess }: FeedbackProps & { dark: boolean; onBack: () => void }) {
  const [email,setEmail]=useState(''); const [code,setCode]=useState(''); const [password,setPassword]=useState(''); const [confirmation,setConfirmation]=useState(''); const [codeSent,setCodeSent]=useState(false); const [loading,setLoading]=useState(false);
  const scrollRef=useRef<ScrollView>(null); const recoveryCardY=useRef(0); const activeRecoveryTarget=useRef<number|null>(null); const revealFocusedInput=useRevealFocusedInput(scrollRef,28);
  const scrollRecoveryFormAboveKeyboard=useCallback(()=>{ scrollRef.current?.scrollTo({y:Math.max(0,recoveryCardY.current-12),animated:true}); },[]);
  const revealRecoveryInput=useCallback((target:number)=>{ activeRecoveryTarget.current=target; revealFocusedInput(target); if(Keyboard.isVisible())setTimeout(()=>{scrollRecoveryFormAboveKeyboard();setTimeout(()=>revealFocusedInput(target),80);},100); },[revealFocusedInput,scrollRecoveryFormAboveKeyboard]);
  useEffect(()=>{ const showEvent=Platform.OS==='ios'?'keyboardWillShow':'keyboardDidShow'; const showSubscription=Keyboard.addListener(showEvent,()=>setTimeout(()=>{scrollRecoveryFormAboveKeyboard();const target=activeRecoveryTarget.current;if(target!==null)setTimeout(()=>revealFocusedInput(target),80);},80)); const hideSubscription=Keyboard.addListener('keyboardDidHide',()=>scrollRef.current?.scrollTo({y:0,animated:true})); return()=>{showSubscription.remove();hideSubscription.remove();}; },[revealFocusedInput,scrollRecoveryFormAboveKeyboard]);
  useEffect(()=>{if(Platform.OS!=='android')return;const subscription=BackHandler.addEventListener('hardwareBackPress',()=>{Keyboard.dismiss();onBack();return true;});return()=>subscription.remove();},[onBack]);
  const sendCode=async()=>{setLoading(true);try{const result=await api.forgotPassword(email.trim());setCodeSent(true);onSuccess(result.message);}catch(error){onError(error);}finally{setLoading(false);}};
  const reset=async()=>{if(password!==confirmation){onError(new Error('Las contraseñas no coinciden'));return;}setLoading(true);try{const result=await api.resetPassword({email:email.trim(),code,newPassword:password});onSuccess(result.message);onBack();}catch(error){onError(error);}finally{setLoading(false);}};
  return <SafeAreaView style={styles.loginPage} edges={['top','right','bottom','left']}><StatusBar style="light" translucent backgroundColor="transparent"/><KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={styles.loginKeyboardAvoiding}><ScrollView ref={scrollRef} contentContainerStyle={styles.registerScroll} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} showsVerticalScrollIndicator={false}><KeyboardScrollContext.Provider value={revealRecoveryInput}>
    <Pressable accessibilityRole="button" accessibilityLabel="Volver al inicio de sesión" onPress={onBack} style={styles.authBack}><Ionicons name="arrow-back" size={20} color={palette.white}/><Text style={styles.authBackText}>Volver</Text></Pressable><Text style={styles.loginBrand}>GymFlow <Text style={styles.mini}>MINI</Text></Text><Text style={styles.registerTitle}>Recupera tu acceso</Text><Text style={styles.loginCopy}>{codeSent?'Introduce el código enviado por correo y elige una contraseña nueva.':'Te enviaremos un código al correo asociado con tu cuenta.'}</Text>
    <View style={[styles.loginCard,dark&&darkStyles.loginCard]} onLayout={event=>{recoveryCardY.current=event.nativeEvent.layout.y;}}><Field dark={dark} label="Correo de la cuenta" value={email} onChangeText={setEmail} editable={!codeSent} keyboardType="email-address" autoCapitalize="none"/>{codeSent?<><Field dark={dark} label="Código de 6 dígitos" value={code} onChangeText={value=>setCode(value.replace(/\D/g,'').slice(0,6))} keyboardType="number-pad" maxLength={6}/><Field dark={dark} label="Nueva contraseña" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none"/><Field dark={dark} label="Confirma la contraseña" value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" returnKeyType="done" onSubmitEditing={()=>void reset()}/><Text style={styles.registrationNote}>El código vence en 15 minutos y admite hasta cinco intentos.</Text><PrimaryButton label={loading?'Actualizando…':'Cambiar contraseña'} onPress={reset} disabled={loading||code.length!==6||password.length<8||!confirmation}/><Pressable disabled={loading} onPress={()=>void sendCode()} style={styles.resendCodeButton}><Text style={styles.forgotPasswordText}>Reenviar código</Text></Pressable></>:<PrimaryButton label={loading?'Enviando…':'Enviar código'} onPress={sendCode} disabled={loading||!email.trim()}/>}</View>
  </KeyboardScrollContext.Provider></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

function RegisterScreen({ dark, onRegistered, onVerificationRequired, onBack, onError, onSuccess }: FeedbackProps & { dark: boolean; onRegistered: (user: User) => void; onVerificationRequired: (email: string) => void; onBack: () => void }) {
  const [ownerName,setOwnerName]=useState(''); const [gymName,setGymName]=useState(''); const [province,setProvince]=useState(''); const [municipality,setMunicipality]=useState('');
  const [phone,setPhone]=useState(''); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [confirmation,setConfirmation]=useState(''); const [loading,setLoading]=useState(false);
  const [page,setPage]=useState(0); const keyboardOpen=useKeyboardOpen(); const scrollRef=useRef<ScrollView>(null); const reveal=useRevealFocusedInput(scrollRef,120);
  const pageValid=[!!ownerName.trim()&&/^\d{8}$/.test(phone),!!gymName.trim()&&!!province&&!!municipality,!!email.trim()&&password.length>=8&&!!confirmation][page];
  const pageTitles=['Datos del responsable','Información del gimnasio','Datos de acceso'];
  const submit=async()=>{ if(password!==confirmation){onError(new Error('Las contraseñas no coinciden'));return;} setLoading(true); try{const result=await api.register({ownerName:ownerName.trim(),gymName:gymName.trim(),province,municipality,phone:phone.trim(),email:email.trim(),password});if(result.verificationRequired){onSuccess(result.message);onVerificationRequired(result.email);}else{onRegistered(result.user);onSuccess('Cuenta creada. Ahora elige cómo comenzar.');}} catch(error){onError(error);}finally{setLoading(false);} };
  const goBack=()=>{Keyboard.dismiss();if(page>0)setPage(value=>value-1);else onBack();};
  const goForward=()=>{Keyboard.dismiss();if(page<2)setPage(value=>value+1);else void submit();};
  useEffect(()=>{if(Platform.OS!=='android')return;const subscription=BackHandler.addEventListener('hardwareBackPress',()=>{goBack();return true;});return()=>subscription.remove();},[page,onBack]);
  return <SafeAreaView style={[styles.memberFormPage,dark&&darkStyles.memberFormPage]} edges={['top','right','bottom','left']}><StatusBar style={dark?'light':'dark'}/><KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={styles.loginKeyboardAvoiding}>
    <View style={[styles.memberFormHeader,dark&&darkStyles.memberFormHeader]}><View style={styles.memberFormHeaderRow}><Pressable accessibilityRole="button" accessibilityLabel={page>0?'Paso anterior':'Volver al inicio de sesión'} onPress={goBack} style={({pressed})=>[styles.memberFormBack,pressed&&styles.pressed]}><Ionicons name="arrow-back" size={19} color={dark?darkColors.text:palette.ink}/><Text style={[styles.memberFormBackText,dark&&darkStyles.memberFormBackText]}>{page>0?'Atrás':'Volver'}</Text></Pressable><Text style={[styles.memberFormStep,dark&&darkStyles.memberFormStep]}>PASO {page+1} DE 3</Text><Pressable accessibilityRole="button" disabled={!pageValid||loading} onPress={goForward} style={[styles.memberFormNext,dark&&darkStyles.memberFormNext,(!pageValid||loading)&&styles.disabled]}><Text style={styles.memberFormNextText}>{page===2?(loading?'Creando…':'Crear cuenta'):'Siguiente'}</Text><Ionicons name={page===2?'checkmark':'arrow-forward'} size={16} color={palette.white}/></Pressable></View><View style={styles.memberFormProgress}>{[0,1,2].map(step=><View key={step} style={[styles.memberFormProgressPart,dark&&darkStyles.memberFormProgressPart,step<=page&&styles.memberFormProgressPartActive,step<=page&&dark&&darkStyles.memberFormProgressPartActive]}/>)}</View><Text style={[styles.memberFormTitle,dark&&darkStyles.memberFormTitle]}>{pageTitles[page]}</Text><Text style={[styles.memberFormCopy,dark&&darkStyles.memberFormCopy]}>{page===0?'Cuéntanos quién administrará la cuenta.':page===1?'Identifica el gimnasio que vas a gestionar.':'Crea tus credenciales para entrar a GymFlow Mini.'}</Text></View>
    <ScrollView ref={scrollRef} key={page} style={styles.memberFormScroll} contentContainerStyle={[styles.memberFormContent,keyboardOpen&&styles.memberFormContentKeyboard]} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} showsVerticalScrollIndicator={keyboardOpen}><KeyboardScrollContext.Provider value={reveal}>
      {page===0?<><Field dark={dark} label="Tu nombre y apellidos" value={ownerName} onChangeText={setOwnerName} autoCapitalize="words"/><Field dark={dark} label="Teléfono móvil" value={phone} onChangeText={value=>setPhone(value.replace(/\D/g,'').slice(0,8))} keyboardType="number-pad" maxLength={8} placeholder="5XXXXXXX"/><Text style={styles.registrationNote}>Escribe exactamente los 8 dígitos de tu teléfono móvil.</Text></>:null}
      {page===1?<><Field dark={dark} label="Nombre del gimnasio" value={gymName} onChangeText={setGymName} autoCapitalize="words"/><LocationField dark={dark} type="province" value={province} onChange={value=>{setProvince(value);setMunicipality('');}}/><LocationField dark={dark} type="municipality" province={province} value={municipality} onChange={setMunicipality}/></>:null}
      {page===2?<><Field dark={dark} label="Correo" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"/><Field dark={dark} label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none"/><Field dark={dark} label="Repite la contraseña" value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" returnKeyType="done" onSubmitEditing={()=>void submit()}/><Text style={styles.registrationNote}>La contraseña debe tener al menos 8 caracteres. La prueba es única por teléfono verificado por WhatsApp y dispositivo.</Text></>:null}
    </KeyboardScrollContext.Provider></ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}

function useRevealFocusedInput(scrollRef: React.RefObject<ScrollView | null>, additionalOffset: number) {
  const activeTarget = useRef<number | null>(null);
  const revealActiveTarget = useCallback(() => { if (activeTarget.current !== null) scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(activeTarget.current, additionalOffset, true); }, [additionalOffset, scrollRef]);
  const revealTarget = useCallback((target: number) => { activeTarget.current = target; if (Keyboard.isVisible()) setTimeout(revealActiveTarget, 60); }, [revealActiveTarget]);
  useEffect(() => { const subscription = Keyboard.addListener('keyboardDidShow', () => setTimeout(revealActiveTarget, 60)); return () => subscription.remove(); }, [revealActiveTarget]);
  return revealTarget;
}

function useKeyboardOpen() {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => { const show=Keyboard.addListener('keyboardDidShow',()=>setKeyboardOpen(true)); const hide=Keyboard.addListener('keyboardDidHide',()=>setKeyboardOpen(false)); return()=>{show.remove();hide.remove();}; }, []);
  return keyboardOpen;
}

function Field({ dark = false, label, onFocus, ...input }: React.ComponentProps<typeof TextInput> & { dark?: boolean; label: string }) {
  const revealFocusedInput = useContext(KeyboardScrollContext);
  return <View style={styles.field}><Text maxFontSizeMultiplier={1.35} style={[styles.fieldLabel,dark&&darkStyles.fieldLabel]}>{label}</Text><TextInput placeholderTextColor={dark?'#aab7b0':'#657169'} maxFontSizeMultiplier={1.35} style={[styles.input,dark&&darkStyles.input]} {...input} onFocus={(event)=>{onFocus?.(event);revealFocusedInput?.(event.nativeEvent.target);}}/></View>;
}

function PasswordField({ dark, value, visible, onChangeText, onToggleVisibility, onSubmit }: { dark: boolean; value: string; visible: boolean; onChangeText: (value: string) => void; onToggleVisibility: () => void; onSubmit: () => void }) {
  const revealFocusedInput = useContext(KeyboardScrollContext);
  return <View style={styles.field}><Text maxFontSizeMultiplier={1.35} style={[styles.fieldLabel,dark&&darkStyles.fieldLabel]}>Contraseña</Text><View style={[styles.passwordInputShell,dark&&darkStyles.passwordInputShell]}><TextInput accessibilityLabel="Contraseña" value={value} onChangeText={onChangeText} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={onSubmit} placeholderTextColor={dark?'#aab7b0':'#657169'} maxFontSizeMultiplier={1.35} style={[styles.passwordInput,dark&&darkStyles.passwordInput]} onFocus={(event)=>revealFocusedInput?.(event.nativeEvent.target)}/><Pressable accessibilityRole="button" accessibilityLabel={visible?'Ocultar contraseña':'Mostrar contraseña'} accessibilityState={{expanded:visible}} onPress={onToggleVisibility} style={({pressed})=>[styles.passwordVisibilityButton,pressed&&styles.pressed]}><Ionicons name={visible?'eye-off-outline':'eye-outline'} size={21} color={dark?darkColors.secondary:palette.secondary}/></Pressable></View></View>;
}

function LocationField({ dark, type, province = '', value, onChange }: { dark: boolean; type: 'province' | 'municipality'; province?: string; value: string; onChange: (value: string) => void }) {
  const [open,setOpen]=useState(false);
  const isProvince=type==='province';
  const options=isProvince?CUBAN_PROVINCES:CUBA_LOCATIONS[province]??[];
  const disabled=!isProvince&&!province;
  const title=isProvince?'provincia':'municipio';
  const select=(next:string)=>{onChange(next);setOpen(false);};
  return <View style={styles.field}><Text maxFontSizeMultiplier={1.35} style={[styles.fieldLabel,dark&&darkStyles.fieldLabel]}>{isProvince?'Provincia':'Municipio'}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Seleccionar ${title}`} accessibilityState={{expanded:open,disabled}} disabled={disabled} onPress={()=>{Keyboard.dismiss();setOpen(true);}} style={({pressed})=>[styles.input,dark&&darkStyles.input,styles.provinceTrigger,disabled&&styles.disabled,pressed&&styles.pressed]}><Text style={[styles.provinceValue,dark&&darkStyles.provinceValue,!value&&styles.provincePlaceholder,dark&&!value&&darkStyles.provincePlaceholder]}>{value||(isProvince?'Seleccionar provincia':province?'Seleccionar municipio':'Selecciona primero la provincia')}</Text><Ionicons name="chevron-down" size={18} color={dark?darkColors.secondary:palette.secondary}/></Pressable><Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={()=>setOpen(false)}><View style={styles.provinceModalRoot}><Pressable accessibilityRole="button" accessibilityLabel="Cerrar selector" style={StyleSheet.absoluteFill} onPress={()=>setOpen(false)}/><SafeAreaView edges={['bottom']} style={[styles.provinceSheet,dark&&darkStyles.provinceSheet]}><View style={styles.provinceHead}><Text style={[styles.provinceTitle,dark&&darkStyles.provinceTitle]}>Selecciona tu {title}</Text><Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={()=>setOpen(false)} style={[styles.closeButton,dark&&darkStyles.closeButton]}><Ionicons name="close" size={22} color={dark?darkColors.text:palette.ink}/></Pressable></View><ScrollView showsVerticalScrollIndicator={false}>{options.map(option=><Pressable key={option} onPress={()=>select(option)} style={[styles.provinceOption,dark&&darkStyles.provinceOption,value===option&&styles.provinceOptionSelected,value===option&&dark&&darkStyles.provinceOptionSelected]}><Text style={[styles.provinceOptionText,dark&&darkStyles.provinceOptionText,value===option&&styles.provinceOptionTextSelected,value===option&&dark&&darkStyles.provinceOptionTextSelected]}>{option}</Text>{value===option&&<Ionicons name="checkmark" size={19} color={palette.action}/>}</Pressable>)}</ScrollView></SafeAreaView></View></Modal></View>;
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled:!!disabled}} onPress={onPress} disabled={disabled} style={({pressed})=>[styles.primary,disabled&&styles.disabled,pressed&&styles.pressed]}><Text maxFontSizeMultiplier={1.3} style={styles.primaryText}>{label}</Text></Pressable>;
}

const darkColors = { background:'#101411', surface:'#1a201c', raised:'#212923', border:'#343e38', text:'#f2f5f3', secondary:'#adb7b1', action:'#68c59a', actionSoft:'#20382c' } as const;

function withReadableType<T extends StyleSheet.NamedStyles<T>>(source: T): T {
  Object.values(source).forEach((style) => { const textStyle=style as {fontSize?:number}; if(typeof textStyle.fontSize==='number'&&textStyle.fontSize<=10)textStyle.fontSize=12; });
  return source;
}

const styles = StyleSheet.create(withReadableType({
  loginPage:{flex:1,backgroundColor:palette.brand,paddingHorizontal:24,paddingTop:36},loginKeyboardAvoiding:{flex:1},loginScroll:{flexGrow:1},loginBrand:{marginTop:8,color:palette.white,fontSize:22,fontWeight:'800'},mini:{color:palette.accent,fontSize:11,letterSpacing:2},loginTitle:{marginTop:44,color:palette.white,fontSize:34,fontWeight:'800',letterSpacing:-1.2},loginCopy:{marginTop:10,color:'#c4d5cd',fontSize:15,lineHeight:22},loginCard:{marginTop:34,padding:20,borderRadius:20,backgroundColor:palette.white},loginDivider:{marginVertical:16,flexDirection:'row',alignItems:'center',gap:10},loginDividerLine:{height:1,flex:1,backgroundColor:'#dce4df'},loginDividerText:{color:palette.secondary,fontSize:12,fontWeight:'700'},googleLoginButton:{minHeight:48,borderWidth:1,borderColor:'#cfd9d3',borderRadius:12,backgroundColor:palette.white,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10},googleLoginText:{color:palette.brand,fontSize:13,fontWeight:'800'},loginJoin:{marginTop:20,alignItems:'center',gap:4},loginJoinText:{color:'#c4d5cd',fontSize:13},loginJoinLink:{color:palette.accent,fontSize:13,fontWeight:'800',textDecorationLine:'underline'},version:{marginTop:'auto',marginBottom:24,textAlign:'center',color:'#a9c3b7',fontSize:10,letterSpacing:2},
  registerScroll:{flexGrow:1,paddingBottom:28},authBack:{minHeight:44,marginLeft:-8,flexDirection:'row',alignItems:'center',gap:7,alignSelf:'flex-start',paddingHorizontal:8},authBackText:{color:palette.white,fontSize:13,fontWeight:'800'},registerTitle:{marginTop:24,color:palette.white,fontSize:31,fontWeight:'800',letterSpacing:-1},verificationIcon:{width:52,height:52,marginBottom:16,alignItems:'center',justifyContent:'center',borderRadius:17,backgroundColor:'#e8f5ce'},registrationNote:{marginTop:2,marginBottom:4,color:palette.secondary,fontSize:11,lineHeight:16,fontWeight:'600'},forgotPasswordButton:{minHeight:36,alignSelf:'flex-end',justifyContent:'center'},forgotPasswordText:{color:palette.action,fontSize:11,fontWeight:'900'},resendCodeButton:{minHeight:42,alignItems:'center',justifyContent:'center'},
  memberFormPage:{flex:1,backgroundColor:palette.background},memberFormHeader:{paddingHorizontal:16,paddingTop:8,paddingBottom:13,borderBottomWidth:1,borderBottomColor:palette.line,backgroundColor:palette.background},memberFormHeaderRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},memberFormBack:{minWidth:72,minHeight:44,flexDirection:'row',alignItems:'center',gap:6},memberFormBackText:{color:palette.ink,fontSize:12,fontWeight:'800'},memberFormStep:{color:palette.secondary,fontSize:10,fontWeight:'900',letterSpacing:.7},memberFormNext:{minWidth:100,minHeight:44,paddingHorizontal:10,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5,borderRadius:11,backgroundColor:palette.action},memberFormNextText:{color:palette.white,fontSize:12,fontWeight:'900'},memberFormProgress:{marginTop:12,marginBottom:13,flexDirection:'row',gap:5},memberFormProgressPart:{height:4,flex:1,borderRadius:2,backgroundColor:'#d9dfdb'},memberFormProgressPartActive:{backgroundColor:palette.action},memberFormTitle:{color:palette.ink,fontSize:22,fontWeight:'900'},memberFormCopy:{marginTop:3,color:palette.secondary,fontSize:12},memberFormScroll:{flex:1},memberFormContent:{padding:16,paddingBottom:32},memberFormContentKeyboard:{paddingBottom:280},
  field:{marginBottom:14},fieldLabel:{marginBottom:7,color:palette.secondary,fontSize:12,fontWeight:'700'},input:{minHeight:48,paddingHorizontal:14,borderWidth:1,borderColor:palette.line,borderRadius:11,color:palette.ink,fontSize:14,backgroundColor:'#fafbf9'},passwordInputShell:{minHeight:48,paddingLeft:14,paddingRight:2,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:palette.line,borderRadius:11,backgroundColor:'#fafbf9'},passwordInput:{minHeight:46,flex:1,color:palette.ink,fontSize:14},passwordVisibilityButton:{width:44,height:44,alignItems:'center',justifyContent:'center',borderRadius:10},provinceTrigger:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},provinceValue:{flex:1,color:palette.ink,fontSize:14},provincePlaceholder:{color:palette.secondary},provinceModalRoot:{flex:1,justifyContent:'flex-end',paddingTop:60,backgroundColor:'#13251d99'},provinceSheet:{maxHeight:'78%',paddingHorizontal:20,paddingTop:12,paddingBottom:10,borderTopLeftRadius:24,borderTopRightRadius:24,backgroundColor:palette.white},provinceHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:8},provinceTitle:{flex:1,color:palette.ink,fontSize:20,fontWeight:'900'},provinceOption:{minHeight:48,paddingHorizontal:13,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:palette.line},provinceOptionSelected:{borderRadius:10,borderBottomColor:'transparent',backgroundColor:'#eef7e1'},provinceOptionText:{color:palette.ink,fontSize:14},provinceOptionTextSelected:{color:palette.action,fontWeight:'900'},closeButton:{width:44,height:44,marginLeft:12,alignItems:'center',justifyContent:'center',borderRadius:13,backgroundColor:'#f1f4f2'},
  primary:{minHeight:49,flexDirection:'row',gap:8,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:palette.action},primaryText:{color:palette.white,fontSize:14,fontWeight:'800'},disabled:{opacity:.45},pressed:{opacity:.65},
}));

const darkStyles = StyleSheet.create({
  loginCard:{backgroundColor:darkColors.surface},verificationIcon:{backgroundColor:darkColors.actionSoft},googleLoginButton:{backgroundColor:darkColors.surface,borderColor:darkColors.border},googleLoginText:{color:darkColors.text},loginDividerLine:{backgroundColor:darkColors.border},closeButton:{backgroundColor:darkColors.raised},
  memberFormPage:{backgroundColor:darkColors.background},memberFormHeader:{borderBottomColor:darkColors.border,backgroundColor:darkColors.background},memberFormBackText:{color:darkColors.text},memberFormStep:{color:darkColors.secondary},memberFormNext:{backgroundColor:darkColors.action},memberFormProgressPart:{backgroundColor:darkColors.border},memberFormProgressPartActive:{backgroundColor:darkColors.action},memberFormTitle:{color:darkColors.text},memberFormCopy:{color:darkColors.secondary},
  fieldLabel:{color:darkColors.secondary},input:{borderColor:darkColors.border,color:darkColors.text,backgroundColor:'#151b17'},passwordInputShell:{borderColor:darkColors.border,backgroundColor:'#151b17'},passwordInput:{color:darkColors.text},provinceValue:{color:darkColors.text},provincePlaceholder:{color:darkColors.secondary},provinceSheet:{backgroundColor:darkColors.surface},provinceTitle:{color:darkColors.text},provinceOption:{borderBottomColor:darkColors.border},provinceOptionSelected:{borderBottomColor:'transparent',backgroundColor:darkColors.actionSoft},provinceOptionText:{color:darkColors.text},provinceOptionTextSelected:{color:darkColors.action},
});
