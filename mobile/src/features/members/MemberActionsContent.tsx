import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Member } from '../../types';
import { effectiveMembershipStatus } from '../../membershipDates';
import { contractedPlan, formatDate, membershipStatusLabel, remainingDaysLabel } from '../../utils/domainFormatters';
import { activeMembership, editableMembership, scheduledMembership } from '../../utils/membershipSelectors';
import { darkPalette, palette } from '../../theme/colors';
import { MemberPhotoAvatar } from './MemberPhotoAvatar';

type MemberActionsContentProps = {
  member: Member | null;
  canDelete: boolean;
  dark: boolean;
  scheduledMembershipEnabled: boolean;
  onEdit: () => void;
  onPlan: () => void;
  onRenew: () => void;
  onEditScheduled: () => void;
  onDeleteScheduled: () => void;
  onDelete: () => void;
};

export function memberActionsTitle(member: Member | null) {
  return member ? `${member.firstName} ${member.lastName}` : 'Opciones del miembro';
}

export function MemberActionsContent({ member, canDelete, dark, scheduledMembershipEnabled, onEdit, onPlan, onRenew, onEditScheduled, onDeleteScheduled, onDelete }: MemberActionsContentProps) {
  const styles = useMemo(() => createStyles(dark), [dark]);
  const active = member ? activeMembership(member) : undefined;
  const editable = member ? editableMembership(member) : undefined;
  const scheduled = member ? scheduledMembership(member) : undefined;
  const membership = active ?? editable ?? member?.memberships[0];
  const hasMembershipHistory = !!membership;
  const fullName = memberActionsTitle(member);

  return <>
    <View style={styles.profile}>
      {member ? <MemberPhotoAvatar member={member} dark={dark} profile/> : <View style={styles.profileAvatar}/>}
      <View style={styles.main}><Text numberOfLines={2} ellipsizeMode="tail" maxFontSizeMultiplier={1.35} style={styles.profileName}>{fullName}</Text><Text numberOfLines={1} ellipsizeMode="tail" style={styles.profileMeta}>CI {member?.ci}{member?.phone ? ` · ${member.phone}` : ''}</Text><Text numberOfLines={2} ellipsizeMode="tail" maxFontSizeMultiplier={1.3} style={[styles.profilePlan,membership&&effectiveMembershipStatus(membership)==='EXPIRED'&&styles.expired]}>{membership ? `${contractedPlan(membership).name} · ${membershipStatusLabel(effectiveMembershipStatus(membership))}` : 'Sin membresía vigente'}</Text>{active?<Text style={styles.profileExpiry}>Vence el {formatDate(active.endDate)} · {remainingDaysLabel(active.endDate)}</Text>:null}</View>
    </View>
    {scheduledMembershipEnabled&&scheduled?<View style={styles.scheduledCard}>
      <Text style={styles.scheduledLabel}>PRÓXIMA MEMBRESÍA · PROGRAMADA</Text><Text style={styles.scheduledPlan}>{contractedPlan(scheduled).name}</Text><Text style={styles.scheduledDates}>Inicia {formatDate(scheduled.startDate)} · vence {formatDate(scheduled.endDate)}</Text>
      <View style={styles.scheduledActions}><Pressable accessibilityRole="button" onPress={onEditScheduled} style={({pressed})=>[styles.scheduledButton,pressed&&styles.pressed]}><Ionicons name="create-outline" size={15} color={dark?darkPalette.action:palette.action}/><Text style={styles.scheduledButtonText}>Editar</Text></Pressable><Pressable accessibilityRole="button" onPress={onDeleteScheduled} style={({pressed})=>[styles.scheduledButton,styles.scheduledDeleteButton,pressed&&styles.pressed]}><Ionicons name="trash-outline" size={15} color={palette.danger}/><Text style={[styles.scheduledButtonText,styles.dangerText]}>Eliminar</Text></Pressable></View>
    </View>:null}
    <View style={styles.actionGrid}>
      <ActionCard styles={styles} icon="create-outline" title="Editar datos" copy="Nombre, CI, teléfono y dirección" onPress={onEdit}/>
      <ActionCard styles={styles} icon={active?'close-circle-outline':hasMembershipHistory?'refresh-outline':'card-outline'} title={active?'Cancelar membresía':hasMembershipHistory?'Renovar membresía':'Asignar membresía'} copy={active?'La membresía activa solo puede cancelarse':hasMembershipHistory?'Crear un nuevo período para este miembro':'Crear la primera membresía de este miembro'} danger={!!active} plan onPress={onPlan}/>
      {scheduledMembershipEnabled&&active&&!scheduled?<ActionCard styles={styles} icon="calendar-outline" title="Programar renovación" copy="Elige el plan que comenzará cuando venza el actual" renew onPress={onRenew}/>:null}
      {canDelete&&member?.status==='ACTIVE'?<ActionCard styles={styles} icon="archive-outline" title="Archivar miembro" copy="Lo marca inactivo y conserva intactos sus cobros y abonos" danger archive onPress={onDelete}/>:null}
    </View>
  </>;
}

function ActionCard({ styles, icon, title, copy, onPress, danger = false, plan = false, renew = false, archive = false }: { styles: ReturnType<typeof createStyles>; icon: React.ComponentProps<typeof Ionicons>['name']; title: string; copy: string; onPress: () => void; danger?: boolean; plan?: boolean; renew?: boolean; archive?: boolean }) {
  const iconColor = danger ? palette.danger : renew ? palette.warning : palette.action;
  return <Pressable accessibilityRole="button" accessibilityLabel={archive?'Archivar miembro':undefined} onPress={onPress} style={({pressed})=>[styles.actionCard,plan&&styles.actionCardPlan,renew&&styles.actionCardRenew,archive&&styles.actionCardDelete,pressed&&styles.pressed]}><View style={[styles.actionIcon,plan&&styles.actionIconPlan,renew&&styles.actionIconRenew,archive&&styles.actionIconDelete]}><Ionicons name={icon} size={20} color={iconColor}/></View><View style={styles.main}><Text style={[styles.actionTitle,danger&&styles.dangerText]}>{title}</Text><Text style={styles.actionCopy}>{copy}</Text></View>{archive?null:<Ionicons name="chevron-forward" size={21} color={palette.secondary}/>}</Pressable>;
}

function createStyles(dark: boolean) {
  return StyleSheet.create({
    main:{flex:1},
    pressed:{opacity:.72,transform:[{scale:.99}]},
    profile:{marginBottom:12,padding:16,flexDirection:'row',alignItems:'center',borderRadius:16,backgroundColor:dark?darkPalette.raised:'#f3f7f3'},
    profileAvatar:{width:52,height:52,marginRight:13,borderRadius:17,backgroundColor:palette.accent},
    profileName:{color:dark?darkPalette.text:palette.ink,fontSize:16,fontWeight:'900'},
    profileMeta:{marginTop:4,color:dark?darkPalette.secondary:palette.secondary,fontSize:12},
    profilePlan:{marginTop:6,color:dark?darkPalette.action:palette.action,fontSize:12,fontWeight:'700'},
    profileExpiry:{marginTop:4,color:dark?'#cbd2ce':palette.secondary,fontSize:11,fontWeight:'700'},
    expired:{color:dark?'#f0b35f':palette.warning},
    scheduledCard:{marginBottom:12,padding:13,borderWidth:1,borderColor:dark?'#5a482c':'#f1d2b2',borderRadius:14,backgroundColor:dark?'#261f17':'#fff8ef'},
    scheduledLabel:{color:dark?'#f0b35f':palette.warning,fontSize:10,fontWeight:'900',letterSpacing:.8},
    scheduledPlan:{marginTop:5,color:dark?darkPalette.text:palette.ink,fontSize:13,fontWeight:'900'},
    scheduledDates:{marginTop:4,color:dark?darkPalette.secondary:palette.secondary,fontSize:11,fontWeight:'700'},
    scheduledActions:{marginTop:12,paddingTop:10,flexDirection:'row',gap:8,borderTopWidth:1,borderTopColor:dark?'#5a482c':'#f1d2b2'},
    scheduledButton:{flex:1,minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,borderWidth:1,borderColor:dark?'#3d594a':'#cfe3d6',borderRadius:10,backgroundColor:dark?darkPalette.surface:palette.white},
    scheduledDeleteButton:{borderColor:dark?'#5a302d':'#f0d8d4'},
    scheduledButtonText:{color:dark?darkPalette.action:palette.action,fontSize:12,fontWeight:'900'},
    actionGrid:{gap:10},
    actionCard:{minHeight:76,padding:13,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:dark?darkPalette.border:palette.line,borderRadius:15,backgroundColor:dark?darkPalette.surface:'#fbfcfb'},
    actionCardPlan:{borderColor:dark?'#3d594a':'#dce8ca',backgroundColor:dark?'#19231d':'#fbfdf7'},
    actionCardRenew:{borderColor:dark?'#5a482c':'#f1d2b2',backgroundColor:dark?'#261f17':'#fffaf3'},
    actionCardDelete:{minHeight:64,borderColor:dark?'#5a302d':'#f0d8d4',backgroundColor:dark?'#251817':'#fffafa'},
    actionIcon:{width:44,height:44,marginRight:12,alignItems:'center',justifyContent:'center',borderRadius:13,backgroundColor:dark?darkPalette.actionSoft:'#e6f1ea'},
    actionIconPlan:{backgroundColor:dark?'#2a4127':'#e8f5ce'},
    actionIconRenew:{backgroundColor:dark?'#3a2c19':'#fff0dc'},
    actionIconDelete:{backgroundColor:dark?'#3a211f':'#fee9e5'},
    actionTitle:{color:dark?darkPalette.text:palette.ink,fontSize:13,fontWeight:'900'},
    actionCopy:{marginTop:4,color:dark?darkPalette.secondary:palette.secondary,fontSize:11,lineHeight:16},
    dangerText:{color:palette.danger},
  });
}
