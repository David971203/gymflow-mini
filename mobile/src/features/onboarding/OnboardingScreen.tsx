import { useEffect, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { palette } from '../../theme/colors';

type OnboardingSlide = {
  eyebrow: string;
  title: string;
  copy: string;
  visual: 'dashboard' | 'features' | 'offline';
};

const slides: OnboardingSlide[] = [
  { eyebrow: 'TODO BAJO CONTROL', title: 'Tu gimnasio, claro desde el primer vistazo.', copy: 'Consulta ingresos, miembros activos y vencimientos desde un panel pensado para decidir rápido.', visual: 'dashboard' },
  { eyebrow: 'GESTIÓN SIMPLE', title: 'Miembros, planes y cobros en un solo lugar.', copy: 'Registra personas, organiza sus membresías y conoce cuánto has cobrado y qué queda pendiente.', visual: 'features' },
  { eyebrow: 'SIEMPRE CONTIGO', title: 'Sigue trabajando aunque falle la conexión.', copy: 'Tus cambios quedan guardados en el dispositivo y se sincronizan automáticamente cuando recuperas Internet.', visual: 'offline' },
];

function DashboardPreview() {
  return <View style={styles.dashboard}>
    <View style={styles.dashboardHead}><View><Text style={styles.dashboardGym}>HABANA FITNESS</Text><Text style={styles.dashboardTitle}>Inicio</Text></View><View style={styles.dashboardAvatar}><Text style={styles.dashboardAvatarText}>GF</Text></View></View>
    <View style={styles.sync}><View style={styles.syncDot}/><Text style={styles.syncText}>Datos al día</Text><Ionicons name="sync-outline" size={15} color={palette.action}/></View>
    <View style={styles.income}><Text style={styles.incomeLabel}>INGRESOS DEL MES</Text><Text style={styles.incomeValue}>248 500 CUP</Text><Text style={styles.incomeCopy}>Dinero realmente cobrado</Text></View>
    <View style={styles.metricRow}><View style={styles.metric}><Text style={styles.metricLabel}>MIEMBROS</Text><Text style={styles.metricValue}>128</Text></View><View style={styles.metric}><Text style={styles.metricLabel}>ACTIVAS</Text><Text style={styles.metricValue}>94</Text></View></View>
    <View style={styles.alert}><View style={styles.alertIcon}><Ionicons name="notifications-outline" size={18} color={palette.warning}/></View><View style={styles.alertBody}><Text style={styles.alertTitle}>Próximas a vencer</Text><Text style={styles.alertCopy}>6 membresías requieren atención</Text></View><Ionicons name="chevron-forward" size={17} color={palette.secondary}/></View>
  </View>;
}

function OnboardingVisual({ type }: { type: OnboardingSlide['visual'] }) {
  if (type === 'dashboard') return <DashboardPreview/>;
  if (type === 'features') return <View style={styles.featureGrid}>
    {[{icon:'people-outline' as const,label:'Miembros',copy:'Todo su historial'},{icon:'pricetags-outline' as const,label:'Planes',copy:'Vigencias claras'},{icon:'cash-outline' as const,label:'Caja',copy:'Cobros y deuda'},{icon:'notifications-outline' as const,label:'Avisos',copy:'Vence a tiempo'}].map(item=><View key={item.label} style={styles.featureCard}><View style={styles.featureIcon}><Ionicons name={item.icon} size={25} color={palette.action}/></View><Text style={styles.featureTitle}>{item.label}</Text><Text style={styles.featureCopy}>{item.copy}</Text></View>)}
  </View>;
  return <View style={styles.offlineVisual}>
    <View style={styles.phone}><View style={styles.phoneSpeaker}/><Ionicons name="phone-portrait-outline" size={54} color={palette.action}/><Text style={styles.phoneTitle}>Cambios guardados</Text><Text style={styles.phoneCopy}>Listos para sincronizar</Text></View>
    <View style={styles.connectionLine}><View style={styles.connectionDot}/><View style={styles.connectionDash}/><View style={styles.connectionDot}/></View>
    <View style={styles.cloud}><Ionicons name="cloud-done-outline" size={48} color={palette.brand}/><Text style={styles.cloudTitle}>Todo al día</Text><Text style={styles.cloudCopy}>Al volver Internet</Text></View>
  </View>;
}

export function OnboardingScreen({ onComplete }: { onComplete: () => void }) {
  const [page, setPage] = useState(0);
  const slide = slides[page];
  const last = page === slides.length - 1;

  useEffect(() => {
    if (Platform.OS !== 'android' || page === 0) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setPage((current) => Math.max(0, current - 1));
      return true;
    });
    return () => subscription.remove();
  }, [page]);

  return <SafeAreaView style={styles.page} edges={['top','right','bottom','left']}>
    <StatusBar style="dark" backgroundColor={palette.background}/>
    <View style={styles.top}><Text style={styles.brand}>GymFlow <Text style={styles.mini}>MINI</Text></Text><Pressable accessibilityRole="button" accessibilityLabel="Saltar introducción" onPress={onComplete} style={styles.skip}><Text style={styles.skipText}>Saltar</Text></Pressable></View>
    <View style={styles.body}><View style={styles.visualShell}><OnboardingVisual type={slide.visual}/></View><Text style={styles.eyebrow}>{slide.eyebrow}</Text><Text style={styles.title}>{slide.title}</Text><Text style={styles.copy}>{slide.copy}</Text></View>
    <View style={styles.footer}><View accessibilityLabel={`Pantalla ${page + 1} de ${slides.length}`} style={styles.dots}>{slides.map((item,index)=><View key={item.eyebrow} style={[styles.dot,index===page&&styles.dotActive]}/>)}</View><Pressable accessibilityRole="button" accessibilityLabel={last?'Ir al inicio de sesión':'Continuar'} onPress={()=>last?onComplete():setPage(current=>current+1)} style={({pressed})=>[styles.button,pressed&&styles.pressed]}><Text style={styles.buttonText}>{last?'Comenzar':'Continuar'}</Text><Ionicons name={last?'arrow-forward':'chevron-forward'} size={19} color={palette.white}/></Pressable></View>
  </SafeAreaView>;
}

function withReadableType<T extends StyleSheet.NamedStyles<T>>(source: T): T {
  Object.values(source).forEach((style) => {
    const textStyle = style as { fontSize?: number };
    if (typeof textStyle.fontSize === 'number' && textStyle.fontSize <= 10) textStyle.fontSize = 12;
  });
  return source;
}

const styles = StyleSheet.create(withReadableType({
  page:{flex:1,paddingHorizontal:22,paddingTop:12,paddingBottom:16,backgroundColor:palette.background},top:{height:52,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},brand:{color:palette.brand,fontSize:21,fontWeight:'900'},mini:{color:palette.action,fontSize:10,letterSpacing:2},skip:{minWidth:64,minHeight:44,alignItems:'flex-end',justifyContent:'center'},skipText:{color:palette.action,fontSize:13,fontWeight:'900'},body:{flex:1,justifyContent:'center'},visualShell:{height:'50%',minHeight:230,maxHeight:310,marginBottom:22,alignItems:'center',justifyContent:'center',overflow:'hidden',borderWidth:1,borderColor:'#dce7df',borderRadius:30,backgroundColor:'#edf5e8'},eyebrow:{color:palette.action,fontSize:10,fontWeight:'900',letterSpacing:1.6},title:{maxWidth:360,marginTop:8,color:palette.ink,fontSize:26,lineHeight:31,fontWeight:'900',letterSpacing:-.8},copy:{maxWidth:370,marginTop:9,color:palette.secondary,fontSize:14,lineHeight:20,fontWeight:'600'},footer:{paddingTop:10},dots:{height:24,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7},dot:{width:7,height:7,borderRadius:4,backgroundColor:'#c9d2cc'},dotActive:{width:24,backgroundColor:palette.action},button:{minHeight:54,marginTop:8,paddingHorizontal:20,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderRadius:16,backgroundColor:palette.action},buttonText:{color:palette.white,fontSize:15,fontWeight:'900'},pressed:{opacity:.65},
  dashboard:{width:'86%',maxWidth:330,padding:16,borderWidth:1,borderColor:'#dce4df',borderRadius:22,backgroundColor:palette.white,shadowColor:palette.brand,shadowOffset:{width:0,height:12},shadowOpacity:.14,shadowRadius:18,elevation:7,transform:[{rotate:'-1.5deg'},{scale:.82}]},dashboardHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},dashboardGym:{color:palette.secondary,fontSize:8,fontWeight:'900',letterSpacing:1},dashboardTitle:{marginTop:3,color:palette.ink,fontSize:19,fontWeight:'900'},dashboardAvatar:{width:38,height:38,alignItems:'center',justifyContent:'center',borderRadius:13,backgroundColor:palette.brand},dashboardAvatarText:{color:palette.accent,fontSize:11,fontWeight:'900'},sync:{height:32,marginTop:13,paddingHorizontal:10,flexDirection:'row',alignItems:'center',borderRadius:10,backgroundColor:'#f3f7f3'},syncDot:{width:7,height:7,borderRadius:4,backgroundColor:palette.action},syncText:{flex:1,marginLeft:6,color:palette.secondary,fontSize:9,fontWeight:'800'},income:{marginTop:10,padding:14,borderRadius:15,backgroundColor:palette.brand},incomeLabel:{color:'#bcd2c7',fontSize:8,fontWeight:'900',letterSpacing:1},incomeValue:{marginTop:5,color:palette.white,fontSize:21,fontWeight:'900'},incomeCopy:{marginTop:3,color:palette.accent,fontSize:8,fontWeight:'700'},metricRow:{marginTop:9,flexDirection:'row',gap:8},metric:{flex:1,padding:11,borderWidth:1,borderColor:palette.line,borderRadius:13,backgroundColor:'#fbfcfb'},metricLabel:{color:palette.secondary,fontSize:8,fontWeight:'900'},metricValue:{marginTop:4,color:palette.ink,fontSize:17,fontWeight:'900'},alert:{marginTop:9,padding:10,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:'#f1d2b2',borderRadius:13,backgroundColor:'#fff8ef'},alertIcon:{width:32,height:32,alignItems:'center',justifyContent:'center',borderRadius:10,backgroundColor:'#fff0dc'},alertBody:{flex:1,marginLeft:9},alertTitle:{color:palette.ink,fontSize:9,fontWeight:'900'},alertCopy:{marginTop:2,color:palette.secondary,fontSize:8,fontWeight:'600'},
  featureGrid:{width:'84%',maxWidth:320,flexDirection:'row',flexWrap:'wrap',gap:10},featureCard:{width:'48%',minHeight:116,padding:14,borderWidth:1,borderColor:'#dce4df',borderRadius:19,backgroundColor:palette.white,shadowColor:palette.brand,shadowOffset:{width:0,height:5},shadowOpacity:.07,shadowRadius:10,elevation:3},featureIcon:{width:43,height:43,alignItems:'center',justifyContent:'center',borderRadius:14,backgroundColor:'#e8f5ce'},featureTitle:{marginTop:10,color:palette.ink,fontSize:13,fontWeight:'900'},featureCopy:{marginTop:3,color:palette.secondary,fontSize:9,fontWeight:'600'},
  offlineVisual:{width:'90%',maxWidth:340,flexDirection:'row',alignItems:'center',justifyContent:'center'},phone:{width:132,height:205,paddingHorizontal:12,alignItems:'center',justifyContent:'center',borderWidth:5,borderColor:palette.brand,borderRadius:26,backgroundColor:palette.white,shadowColor:palette.brand,shadowOffset:{width:0,height:8},shadowOpacity:.13,shadowRadius:14,elevation:5},phoneSpeaker:{position:'absolute',top:8,width:35,height:4,borderRadius:2,backgroundColor:'#c9d2cc'},phoneTitle:{marginTop:10,color:palette.ink,fontSize:11,fontWeight:'900',textAlign:'center'},phoneCopy:{marginTop:3,color:palette.secondary,fontSize:8,fontWeight:'700',textAlign:'center'},connectionLine:{width:43,flexDirection:'row',alignItems:'center'},connectionDot:{width:6,height:6,borderRadius:3,backgroundColor:palette.action},connectionDash:{flex:1,height:2,backgroundColor:'#9fbea9'},cloud:{width:126,minHeight:132,padding:14,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'#d4e2d8',borderRadius:24,backgroundColor:palette.accent},cloudTitle:{marginTop:8,color:palette.brand,fontSize:12,fontWeight:'900',textAlign:'center'},cloudCopy:{marginTop:3,color:'#3e604f',fontSize:8,fontWeight:'700',textAlign:'center'},
}));
