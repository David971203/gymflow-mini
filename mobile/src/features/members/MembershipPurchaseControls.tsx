import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Currency, Plan } from '../../types';
import { formatDate, formatMoney } from '../../utils/domainFormatters';
import { darkPalette, palette } from '../../theme/colors';

export function PeriodSelector({ value, onChange, dark }: { value: number; onChange: (value: number) => void; dark: boolean }) {
  const styles = useMemo(() => createStyles(dark), [dark]);
  return <><Text style={styles.label}>Cantidad de períodos</Text><View style={styles.stepper}><Pressable accessibilityRole="button" accessibilityLabel="Reducir períodos" disabled={value<=1} onPress={() => onChange(Math.max(1,value-1))} style={({pressed})=>[styles.stepButton,value<=1&&styles.disabled,pressed&&styles.pressed]}><Ionicons name="remove" size={21} color={dark?darkPalette.text:palette.ink}/></Pressable><View style={styles.stepValue}><Text style={styles.stepNumber}>{value}</Text><Text style={styles.stepCaption}>{value===1?'PERÍODO':'PERÍODOS'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Aumentar períodos" disabled={value>=24} onPress={() => onChange(Math.min(24,value+1))} style={({pressed})=>[styles.stepButton,value>=24&&styles.disabled,pressed&&styles.pressed]}><Ionicons name="add" size={21} color={dark?darkPalette.text:palette.ink}/></Pressable></View></>;
}

export function MembershipPurchasePreview({ plan, periodCount, endDate, currency, dark }: { plan: Plan; periodCount: number; endDate?: string; currency: Currency; dark: boolean }) {
  const styles = useMemo(() => createStyles(dark), [dark]);
  return <View style={styles.preview}><View><Text style={styles.previewLabel}>TOTAL</Text><Text style={styles.previewValue}>{formatMoney(Number(plan.price)*periodCount,currency)}</Text><Text style={styles.previewMeta}>{plan.durationDays*periodCount} días · {periodCount} período{periodCount===1?'':'s'}</Text></View><View><Text style={[styles.previewLabel,styles.right]}>VENCIMIENTO</Text><Text style={styles.previewDate}>{endDate?formatDate(endDate):'—'}</Text></View></View>;
}

function createStyles(dark: boolean) {
  return StyleSheet.create({
    label:{marginBottom:7,color:dark?darkPalette.secondary:palette.secondary,fontSize:12,fontWeight:'700'},
    stepper:{height:58,marginBottom:16,padding:5,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:dark?darkPalette.border:palette.line,borderRadius:13,backgroundColor:dark?'#151b17':'#fbfcfb'},
    stepButton:{width:48,height:48,alignItems:'center',justifyContent:'center',borderRadius:10,backgroundColor:dark?darkPalette.actionSoft:'#e8f5ce'},
    stepValue:{flex:1,alignItems:'center',justifyContent:'center'},
    stepNumber:{color:dark?darkPalette.text:palette.ink,fontSize:18,fontWeight:'900'},
    stepCaption:{marginTop:1,color:dark?darkPalette.secondary:palette.secondary,fontSize:10,fontWeight:'900',letterSpacing:.8},
    preview:{marginBottom:16,padding:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:14,borderWidth:1,borderColor:dark?'#3d594a':'#cfe3d6',borderRadius:13,backgroundColor:dark?'#19231d':'#f4faf6'},
    previewLabel:{color:dark?darkPalette.secondary:palette.secondary,fontSize:10,fontWeight:'900',letterSpacing:.8},
    previewValue:{marginTop:5,color:dark?darkPalette.action:palette.action,fontSize:16,fontWeight:'900'},
    previewMeta:{marginTop:3,color:dark?darkPalette.secondary:palette.secondary,fontSize:11,fontWeight:'700'},
    previewDate:{marginTop:5,color:dark?darkPalette.text:palette.ink,fontSize:12,fontWeight:'900',textAlign:'right'},
    right:{textAlign:'right'},
    disabled:{opacity:.45},
    pressed:{opacity:.72},
  });
}
