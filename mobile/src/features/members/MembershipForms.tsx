import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet, FormField } from '../../components/BottomSheet';
import { offline } from '../../offline';
import type { Currency, Member, Plan } from '../../types';
import { effectiveMembershipStatus } from '../../membershipDates';
import { addDays, contractedPlan, formatDate, formatMoney, membershipStatusLabel, remainingDaysLabel } from '../../utils/domainFormatters';
import { activeMembership, editableMembership, scheduledMembership } from '../../utils/membershipSelectors';
import { darkPalette, palette } from '../../theme/colors';
import { MembershipPurchasePreview, PeriodSelector } from './MembershipPurchaseControls';

type MutationStatus = string;
type FormServices = {
  currency: Currency;
  dark: boolean;
  ensureSubscription: () => void;
  reportMutation: (scope: string, operationId: string, acceptedMessage: string, pendingMessage?: string) => Promise<MutationStatus>;
  onError: (error: unknown) => void;
  overlay?: ReactNode;
};
type MembershipFormProps = FormServices & { scope: string; member: Member | null; plans: Plan[]; onClose: () => void; onSaved: () => void };

export function AssignPlanForm({ scope, member, plans, onClose, onSaved, currency, dark, ensureSubscription, reportMutation, onError, overlay }: MembershipFormProps) {
  const membership = member ? editableMembership(member) : undefined;
  const previousMembership = !membership ? member?.memberships[0] : undefined;
  const isRenewal = !!previousMembership;
  const availablePlans = plans.filter(plan => membership ? plan.id === membership.plan.id : plan.isActive);
  const [planId,setPlanId]=useState(''); const [periodCount,setPeriodCount]=useState(1); const [amount,setAmount]=useState(''); const [saving,setSaving]=useState(false);
  const styles=useMemo(()=>createStyles(dark),[dark]);
  useEffect(()=>{setPlanId(membership?.plan.id??(isRenewal&&availablePlans.some(plan=>plan.id===previousMembership?.plan.id)?previousMembership?.plan.id:availablePlans[0]?.id)??'');setPeriodCount(1);setAmount('');},[member,membership?.id,membership?.plan.id,previousMembership?.id,previousMembership?.plan.id,isRenewal,plans]);
  const selectedPlan=availablePlans.find(plan=>plan.id===planId);
  const previewEndDate=membership?membership.endDate:selectedPlan?addDays(new Date().toISOString(),selectedPlan.durationDays*periodCount):undefined;
  const save=async()=>{if(!member||!planId)return;setSaving(true);try{ensureSubscription();const operationId=membership?await offline.updateMembership(scope,member.id,membership.id,{planId,status:'CANCELLED'}):(await offline.assignPlan(scope,{memberId:member.id,planId,periodCount,...(Number(amount)>0?{initialPayment:Number(amount),paymentMethod:'CASH' as const}:{})})).operationId;const status=await reportMutation(scope,operationId,membership?'Membresía cancelada. El cobro y sus importes se conservaron.':isRenewal?'Membresía renovada correctamente.':'Membresía asignada correctamente.');if(status!=='REJECTED')onSaved();}catch(error){onError(error);}finally{setSaving(false);}};
  const submit=()=>{if(!membership){void save();return;}Alert.alert('Cancelar membresía',`¿Deseas cancelar la membresía ${contractedPlan(membership).name}? El cobro y los abonos registrados se conservarán.`,[{text:'Volver',style:'cancel'},{text:'Cancelar membresía',style:'destructive',onPress:()=>void save()}]);};
  const title=membership?'Cancelar membresía':isRenewal?'Renovar membresía':'Asignar membresía';
  return <BottomSheet open={!!member} title={`${title} de ${member?.firstName??''}`} onClose={onClose} dark={dark} overlay={overlay} footer={<SubmitButton label={saving?(membership?'Cancelando…':'Guardando…'):title} disabled={saving||!planId} onPress={submit}/>}>
    {membership?<><CurrentPlan membership={membership} currency={currency} styles={styles}/><View style={styles.expiryPreview}><View><Text style={styles.expiryLabel}>{selectedPlan?.id!==membership.plan.id?'NUEVO VENCIMIENTO':'FECHA DE VENCIMIENTO'}</Text><Text style={styles.expiryDate}>{previewEndDate?formatDate(previewEndDate):'—'}</Text></View><Text style={styles.expiryDays}>{previewEndDate?remainingDaysLabel(previewEndDate):'—'}</Text></View></>:null}
    {membership?<Text style={styles.copy}>Esta es la única acción disponible mientras la membresía está activa. Podrás renovarla después de cancelarla.</Text>:<><Text style={styles.label}>{isRenewal?'Selecciona el plan para renovar':'Selecciona el plan'}</Text><PlanChoices plans={availablePlans} selectedId={planId} currency={currency} dark={dark} suffix={plan=>isRenewal&&plan.id===previousMembership?.plan.id?' · Anterior':''} onSelect={setPlanId}/><PeriodSelector value={periodCount} onChange={setPeriodCount} dark={dark}/>{selectedPlan?<MembershipPurchasePreview plan={selectedPlan} periodCount={periodCount} endDate={previewEndDate} currency={currency} dark={dark}/>:null}<FormField dark={dark} label="Abono inicial (opcional)" value={amount} onChangeText={setAmount} keyboardType="numeric"/></>}
  </BottomSheet>;
}

export function RenewMembershipForm({ scope, member, plans, onClose, onSaved, currency, dark, ensureSubscription, reportMutation, onError, overlay }: MembershipFormProps) {
  const current=member?activeMembership(member):undefined; const availablePlans=plans.filter(plan=>plan.isActive);
  const [planId,setPlanId]=useState(''); const [periodCount,setPeriodCount]=useState(1); const [amount,setAmount]=useState(''); const [saving,setSaving]=useState(false);
  const styles=useMemo(()=>createStyles(dark),[dark]);
  useEffect(()=>{setPlanId(current&&availablePlans.some(plan=>plan.id===current.plan.id)?current.plan.id:availablePlans[0]?.id??'');setPeriodCount(1);setAmount('');},[member,current?.id,current?.plan.id,plans]);
  const selectedPlan=availablePlans.find(plan=>plan.id===planId); const startDate=current?.endDate; const endDate=startDate&&selectedPlan?addDays(startDate,selectedPlan.durationDays*periodCount):undefined;
  const save=async()=>{if(!member||!current||!planId)return;setSaving(true);try{ensureSubscription();const {operationId}=await offline.renewMembership(scope,member.id,current.id,{planId,periodCount,...(Number(amount)>0?{initialPayment:Number(amount),paymentMethod:'CASH' as const}:{})});const status=await reportMutation(scope,operationId,'Renovación programada correctamente.');if(status!=='REJECTED')onSaved();}catch(error){onError(error);}finally{setSaving(false);}};
  return <BottomSheet open={!!member} title={`Programar renovación de ${member?.firstName??''}`} onClose={onClose} dark={dark} overlay={overlay} footer={<SubmitButton label={saving?'Programando…':'Programar renovación'} disabled={saving||!planId||!current} onPress={()=>void save()}/>}>
    {current?<CurrentPlan membership={current} currency={currency} styles={styles}/>:null}<Text style={styles.copy}>La membresía actual continuará activa hasta su vencimiento.</Text>
    <View style={styles.expiryPreview}><View><Text style={styles.expiryLabel}>PRÓXIMO PERÍODO</Text><Text style={styles.expiryDate}>{startDate?`Inicia ${formatDate(startDate)}`:'—'}</Text><Text style={styles.expiryMeta}>{endDate?`Vence ${formatDate(endDate)}`:'Selecciona un plan'}</Text></View><Text style={styles.expiryDays}>{selectedPlan?`${selectedPlan.durationDays*periodCount} días`:'—'}</Text></View>
    <Text style={styles.label}>Plan de la renovación</Text><PlanChoices plans={availablePlans} selectedId={planId} currency={currency} dark={dark} suffix={plan=>plan.id===current?.plan.id?' · Mismo plan':''} showDays onSelect={setPlanId}/><PeriodSelector value={periodCount} onChange={setPeriodCount} dark={dark}/>{selectedPlan?<MembershipPurchasePreview plan={selectedPlan} periodCount={periodCount} endDate={endDate} currency={currency} dark={dark}/>:null}<FormField dark={dark} label="Abono inicial (opcional)" value={amount} onChangeText={setAmount} keyboardType="numeric"/>
  </BottomSheet>;
}

export function ScheduledMembershipForm({ scope, member, plans, onClose, onSaved, currency, dark, ensureSubscription, reportMutation, onError, overlay }: MembershipFormProps) {
  const scheduled=member?scheduledMembership(member):undefined; const availablePlans=plans.filter(plan=>plan.isActive||plan.id===scheduled?.plan.id);
  const [planId,setPlanId]=useState(''); const [saving,setSaving]=useState(false); const styles=useMemo(()=>createStyles(dark),[dark]);
  useEffect(()=>setPlanId(scheduled?.plan.id??''),[member,scheduled?.id,scheduled?.plan.id]);
  const selectedPlan=availablePlans.find(plan=>plan.id===planId); const previewEndDate=scheduled&&selectedPlan?addDays(scheduled.startDate,selectedPlan.durationDays*(scheduled.periodCount??1)):undefined;
  const save=async()=>{if(!member||!scheduled||!planId)return;setSaving(true);try{ensureSubscription();const operationId=await offline.updateMembership(scope,member.id,scheduled.id,{planId,status:'SCHEDULED'});const status=await reportMutation(scope,operationId,'Renovación actualizada correctamente.');if(status!=='REJECTED')onSaved();}catch(error){onError(error);}finally{setSaving(false);}};
  return <BottomSheet open={!!member} title="Editar renovación programada" onClose={onClose} dark={dark} overlay={overlay} footer={<SubmitButton label={saving?'Guardando…':'Guardar cambios'} disabled={saving||!planId||!scheduled} onPress={()=>void save()}/>}>
    <View style={styles.expiryPreview}><View><Text style={styles.expiryLabel}>PERÍODO PROGRAMADO</Text><Text style={styles.expiryDate}>{scheduled?`Inicia ${formatDate(scheduled.startDate)}`:'—'}</Text><Text style={styles.expiryMeta}>{previewEndDate?`Vence ${formatDate(previewEndDate)}`:'—'}</Text></View><Text style={styles.expiryDays}>{selectedPlan?`${selectedPlan.durationDays*(scheduled?.periodCount??1)} días`:'—'}</Text></View>
    <Text style={styles.label}>Plan programado</Text><PlanChoices plans={availablePlans} selectedId={planId} currency={currency} dark={dark} suffix={plan=>plan.id===scheduled?.plan.id?' · Actual':''} showDays onSelect={setPlanId}/>
  </BottomSheet>;
}

function SubmitButton({label,disabled,onPress}:{label:string;disabled:boolean;onPress:()=>void}){return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={({pressed})=>[shared.submit,disabled&&shared.disabled,pressed&&shared.pressed]}><Text style={shared.submitText}>{label}</Text></Pressable>;}
function PlanChoices({plans,selectedId,currency,dark,suffix,showDays=false,onSelect}:{plans:Plan[];selectedId:string;currency:Currency;dark:boolean;suffix:(plan:Plan)=>string;showDays?:boolean;onSelect:(id:string)=>void}){const styles=useMemo(()=>createStyles(dark),[dark]);return <View style={styles.choices}>{plans.map(plan=><Pressable key={plan.id} onPress={()=>onSelect(plan.id)} style={[styles.choice,selectedId===plan.id&&styles.choiceActive]}><Text style={styles.choiceTitle}>{plan.name}{suffix(plan)}</Text><Text style={styles.choicePrice}>{formatMoney(plan.price,currency)}{showDays?` · ${plan.durationDays} días`:''}</Text></Pressable>)}</View>;}
function CurrentPlan({membership,currency,styles}:{membership:Member['memberships'][number];currency:Currency;styles:ReturnType<typeof createStyles>}){const plan=contractedPlan(membership);return <View style={styles.currentCard}><Text style={styles.currentLabel}>PLAN CONTRATADO</Text><Text style={styles.currentName}>{plan.name}</Text><Text style={styles.currentMeta}>{formatMoney(Number(plan.price)*(membership.periodCount??1),currency)} · {plan.durationDays*(membership.periodCount??1)} días · {membershipStatusLabel(effectiveMembershipStatus(membership))}</Text><Text style={styles.currentMeta}>Desde {formatDate(membership.startDate)} · vence {formatDate(membership.endDate)}</Text></View>;}

const shared=StyleSheet.create({submit:{minHeight:49,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:palette.action},submitText:{color:palette.white,fontSize:14,fontWeight:'800'},disabled:{opacity:.45},pressed:{opacity:.72}});
function createStyles(dark:boolean){return StyleSheet.create({copy:{marginBottom:18,color:dark?darkPalette.secondary:palette.secondary,fontSize:13},label:{marginBottom:7,color:dark?darkPalette.secondary:palette.secondary,fontSize:12,fontWeight:'700'},choices:{marginBottom:15,gap:8},choice:{minHeight:56,padding:13,justifyContent:'center',borderWidth:1,borderColor:dark?darkPalette.border:palette.line,borderRadius:12},choiceActive:{borderColor:dark?darkPalette.action:palette.action,backgroundColor:dark?darkPalette.actionSoft:'#eef7e1'},choiceTitle:{fontSize:13,fontWeight:'800',color:dark?darkPalette.text:palette.ink},choicePrice:{marginTop:3,color:dark?darkPalette.secondary:palette.secondary,fontSize:12},currentCard:{marginBottom:14,padding:15,borderWidth:1,borderColor:dark?'#3d594a':'#cfe3d6',borderRadius:14,backgroundColor:dark?'#19231d':'#f4faf6'},currentLabel:{color:dark?darkPalette.secondary:palette.secondary,fontSize:9,fontWeight:'900',letterSpacing:.8},currentName:{marginTop:5,color:dark?darkPalette.text:palette.ink,fontSize:16,fontWeight:'900'},currentMeta:{marginTop:4,color:dark?darkPalette.secondary:palette.secondary,fontSize:11,fontWeight:'700'},expiryPreview:{marginBottom:16,padding:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,borderWidth:1,borderColor:dark?darkPalette.border:palette.line,borderRadius:13,backgroundColor:dark?'#151b17':'#fafbf9'},expiryLabel:{color:dark?darkPalette.secondary:palette.secondary,fontSize:9,fontWeight:'900',letterSpacing:.7},expiryDate:{marginTop:5,color:dark?darkPalette.text:palette.ink,fontSize:13,fontWeight:'900'},expiryMeta:{marginTop:4,color:dark?darkPalette.secondary:palette.secondary,fontSize:11,fontWeight:'700'},expiryDays:{color:dark?darkPalette.action:palette.action,fontSize:12,fontWeight:'900'}});}
