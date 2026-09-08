import { useMemo, useState } from 'react';
import { FlatList, Modal, Platform, Pressable, RefreshControl, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Member } from '../../types';
import { effectiveMembershipStatus } from '../../membershipDates';
import { contractedPlan, formatDate, membershipStatusLabel, sexLabel } from '../../utils/domainFormatters';
import { editableMembership, hasExpiredMembership, upcomingMembership } from '../../utils/membershipSelectors';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { darkPalette, palette } from '../../theme/colors';
import { MemberPhotoAvatar } from './MemberPhotoAvatar';

export type MemberFilter = 'ALL' | 'ACTIVE' | 'INACTIVE' | 'UPCOMING' | 'EXPIRED';

type MembersListProps = {
  members: Member[];
  loading: boolean;
  initialFilter: MemberFilter;
  dark: boolean;
  onRefresh: () => void;
  onAdd: () => void;
  onSelect: (member: Member) => void;
};

export function MembersList({ members, loading, initialFilter, dark, onRefresh, onAdd, onSelect }: MembersListProps) {
  const [search, setSearch] = useState('');
  const [memberFilter, setMemberFilter] = useState<MemberFilter>(initialFilter);
  const [filterOpen, setFilterOpen] = useState(false);
  const styles = useMemo(() => createStyles(dark), [dark]);

  const filterOptions = useMemo(() => {
    const upcomingCount = members.filter(member => !!upcomingMembership(member)).length;
    const expiredCount = members.filter(hasExpiredMembership).length;
    return [
      { id:'ALL' as const, label:'Todos', count:members.length },
      { id:'ACTIVE' as const, label:'Activos', count:members.filter(member => member.status === 'ACTIVE').length },
      { id:'INACTIVE' as const, label:'Inactivos', count:members.filter(member => member.status === 'INACTIVE').length },
      { id:'UPCOMING' as const, label:'Por vencer', count:upcomingCount },
      { id:'EXPIRED' as const, label:'Vencidas', count:expiredCount },
    ];
  }, [members]);

  const query = search.trim().toLocaleLowerCase('es');
  const visibleMembers = useMemo(() => {
    const filtered = members.filter(member => memberFilter === 'ALL' ? true : memberFilter === 'ACTIVE' ? member.status === 'ACTIVE' : memberFilter === 'INACTIVE' ? member.status === 'INACTIVE' : memberFilter === 'UPCOMING' ? !!upcomingMembership(member) : hasExpiredMembership(member));
    if (!query) return filtered;
    return filtered.filter(member => `${member.firstName} ${member.lastName} ${member.code ?? ''} ${member.ci} ${member.age ?? ''} ${sexLabel(member.sex)} ${member.phone ?? ''} ${member.address ?? ''}`.toLocaleLowerCase('es').includes(query));
  }, [memberFilter, members, query]);
  const selectedFilter = filterOptions.find(option => option.id === memberFilter) ?? filterOptions[0];

  return <>
    <FlatList
      data={visibleMembers}
      keyExtractor={member => member.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} colors={[dark ? '#c9f47b' : '#1d6b4d']} tintColor={dark ? '#c9f47b' : '#1d6b4d'} progressBackgroundColor={dark ? '#212923' : '#fff'} />}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={16}
      windowSize={7}
      removeClippedSubviews={Platform.OS === 'android'}
      ListHeaderComponent={<>
        <Pressable accessibilityRole="button" onPress={onAdd} style={({pressed}) => [styles.primary, pressed && styles.pressed]}><Ionicons name="person-add-outline" size={20} color={palette.white}/><Text maxFontSizeMultiplier={1.3} style={styles.primaryText}>Registrar miembro</Text></Pressable>
        <View style={styles.search}><Ionicons name="search-outline" size={21} color={dark ? darkPalette.action : palette.action}/><TextInput accessibilityLabel="Buscar miembros" value={search} onChangeText={setSearch} placeholder="Nombre, código, CI o teléfono" placeholderTextColor={dark ? '#aab7b0' : '#657169'} autoCorrect={false} style={styles.searchInput} maxFontSizeMultiplier={1.35}/>{search ? <Pressable accessibilityRole="button" accessibilityLabel="Limpiar búsqueda" onPress={() => setSearch('')} style={styles.searchClear}><Ionicons name="close" size={20} color={dark ? darkPalette.secondary : palette.secondary}/></Pressable> : null}</View>
        <View style={styles.heading}><View style={styles.main}><Text style={styles.headingTitle}>{query ? `${visibleMembers.length} resultado${visibleMembers.length === 1 ? '' : 's'}` : `${visibleMembers.length} miembro${visibleMembers.length === 1 ? '' : 's'}`}</Text><Text style={styles.headingCopy}>{memberFilter === 'EXPIRED' ? 'Miembros cuya última membresía ya venció' : memberFilter === 'UPCOMING' ? 'Membresías que vencen en los próximos 10 días' : query ? 'Búsqueda dentro del filtro seleccionado' : 'Toca un miembro para ver sus opciones'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`Filtrar miembros. Filtro actual: ${selectedFilter.label}`} accessibilityState={{expanded:filterOpen}} onPress={() => setFilterOpen(true)} style={({pressed})=>[styles.filterTrigger,memberFilter!=='ALL'&&styles.filterTriggerActive,pressed&&styles.pressed]}><Ionicons name="options-outline" size={18} color={memberFilter!=='ALL'||dark?dark?darkPalette.action:palette.action:palette.secondary}/><Text style={[styles.filterTriggerText,memberFilter!=='ALL'&&styles.filterTriggerTextActive]}>{selectedFilter.label}</Text><View style={[styles.filterCount,memberFilter!=='ALL'&&styles.filterCountActive]}><Text style={[styles.filterCountText,memberFilter!=='ALL'&&styles.filterCountTextActive]}>{selectedFilter.count}</Text></View><Ionicons name="chevron-down" size={15} color={dark?darkPalette.secondary:palette.secondary}/></Pressable></View>
      </>}
      renderItem={({ item:member }) => {
        const current = editableMembership(member) ?? member.memberships[0];
        const currentStatus = current ? effectiveMembershipStatus(current) : undefined;
        const expiring = upcomingMembership(member);
        return <Pressable accessibilityRole="button" accessibilityLabel={`Opciones de ${member.firstName} ${member.lastName}`} onPress={() => onSelect(member)} style={({pressed}) => [styles.memberRow, pressed && styles.memberRowPressed]}><MemberPhotoAvatar member={member} dark={dark}/><View style={styles.main}><Text numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.35} style={styles.rowTitle}>{member.firstName} {member.lastName}</Text><Text numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.3} style={styles.rowSubtitle}>{member.code ? `Código ${member.code} · ` : ''}CI {member.ci}</Text><View style={styles.planLine}><View style={[styles.planDot,currentStatus==='ACTIVE'&&styles.planDotActive,expiring&&styles.planDotWarning,currentStatus==='EXPIRED'&&styles.planDotWarning]}/><Text numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.3} style={[styles.planText,(expiring||currentStatus==='EXPIRED')&&styles.planTextWarning]}>{current ? expiring ? `${contractedPlan(current).name} · vence ${formatDate(current.endDate)}` : `${contractedPlan(current).name} · ${membershipStatusLabel(currentStatus!)}` : 'Sin plan asignado'}</Text></View></View><Ionicons name="chevron-forward" size={22} color={dark ? darkPalette.secondary : palette.secondary}/></Pressable>;
      }}
      ListEmptyComponent={loading ? <LoadingSkeleton dark={dark}/> : <View style={styles.emptyCard}><Text style={styles.empty}>{query ? 'No se encontraron miembros' : memberFilter === 'UPCOMING' ? 'No hay membresías próximas a vencer' : memberFilter === 'EXPIRED' ? 'No hay membresías vencidas' : memberFilter === 'INACTIVE' ? 'No hay miembros inactivos' : memberFilter === 'ACTIVE' ? 'No hay miembros activos' : 'Registra tu primer miembro'}</Text></View>}
    />
    <Modal visible={filterOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setFilterOpen(false)}><View style={styles.modalRoot}><Pressable accessibilityRole="button" accessibilityLabel="Cerrar filtros" style={styles.backdrop} onPress={() => setFilterOpen(false)}/><View accessibilityViewIsModal style={styles.menu}><View style={styles.menuHead}><Text style={styles.menuTitle}>Filtrar miembros</Text><Pressable accessibilityRole="button" accessibilityLabel="Cerrar filtros" onPress={() => setFilterOpen(false)} style={styles.menuClose}><Ionicons name="close" size={19} color={dark?darkPalette.secondary:palette.secondary}/></Pressable></View>{filterOptions.map(option => { const active=memberFilter===option.id; return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{checked:active}} onPress={() => { setMemberFilter(option.id); setFilterOpen(false); }} style={({pressed})=>[styles.menuOption,active&&styles.menuOptionActive,pressed&&styles.pressed]}><View style={styles.menuOptionIcon}>{active?<Ionicons name="checkmark" size={17} color={dark?darkPalette.action:palette.action}/>:null}</View><Text style={[styles.menuOptionText,active&&styles.menuOptionTextActive]}>{option.label}</Text><View style={[styles.filterCount,active&&styles.filterCountActive]}><Text style={[styles.filterCountText,active&&styles.filterCountTextActive]}>{option.count}</Text></View></Pressable>;})}</View></View></Modal>
  </>;
}

function createStyles(dark: boolean) {
  const surface = dark ? darkPalette.surface : palette.white;
  const border = dark ? darkPalette.border : palette.line;
  const text = dark ? darkPalette.text : palette.ink;
  const secondary = dark ? darkPalette.secondary : palette.secondary;
  return StyleSheet.create({
    scroll:{padding:16,paddingBottom:35},
    primary:{minHeight:49,flexDirection:'row',gap:8,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:dark?darkPalette.action:palette.action},
    primaryText:{color:palette.white,fontSize:14,fontWeight:'800'},
    pressed:{opacity:.72},
    search:{height:52,marginTop:14,paddingLeft:14,paddingRight:4,gap:10,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:border,borderRadius:14,backgroundColor:surface},
    searchInput:{height:'100%',flex:1,color:text,fontSize:13},
    searchClear:{width:44,height:44,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:dark?darkPalette.raised:'#eef2ef'},
    heading:{marginTop:18,marginBottom:10,flexDirection:'row',alignItems:'flex-start',gap:12},
    main:{flex:1},
    headingTitle:{fontSize:18,fontWeight:'800',color:text},
    headingCopy:{marginTop:3,color:secondary,fontSize:11},
    filterTrigger:{minHeight:38,paddingLeft:11,paddingRight:9,flexDirection:'row',alignItems:'center',gap:7,borderWidth:1,borderColor:border,borderRadius:12,backgroundColor:surface},
    filterTriggerActive:{borderColor:dark?darkPalette.action:'#b9d8c5',backgroundColor:dark?darkPalette.actionSoft:'#f4faf6'},
    filterTriggerText:{color:secondary,fontSize:11,fontWeight:'800'},
    filterTriggerTextActive:{color:dark?darkPalette.action:palette.action},
    filterCount:{minWidth:24,height:24,paddingHorizontal:6,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:dark?darkPalette.raised:'#eef2ef'},
    filterCountActive:{backgroundColor:dark?darkPalette.action:palette.action},
    filterCountText:{color:secondary,fontSize:10,fontWeight:'900'},
    filterCountTextActive:{color:dark?darkPalette.background:palette.white},
    memberRow:{minHeight:80,marginBottom:10,padding:12,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:border,borderRadius:16,backgroundColor:surface},
    memberRowPressed:{backgroundColor:dark?darkPalette.raised:'#f3f8f4'},
    rowTitle:{fontSize:13,fontWeight:'700',color:text},
    rowSubtitle:{marginTop:4,color:secondary,fontSize:10},
    planLine:{marginTop:6,flexDirection:'row',alignItems:'center',gap:5},
    planDot:{width:7,height:7,borderRadius:4,backgroundColor:'#c0c7c3'},
    planDotActive:{backgroundColor:dark?darkPalette.action:palette.action},
    planDotWarning:{backgroundColor:palette.warning},
    planText:{flex:1,color:secondary,fontSize:11},
    planTextWarning:{color:palette.warning,fontWeight:'800'},
    emptyCard:{overflow:'hidden',borderWidth:1,borderColor:border,borderRadius:16,backgroundColor:surface},
    empty:{padding:26,textAlign:'center',color:secondary},
    modalRoot:{flex:1,paddingTop:(StatusBar.currentHeight??24)+132,paddingHorizontal:16,alignItems:'flex-end'},
    backdrop:{...StyleSheet.absoluteFillObject,backgroundColor:dark?'#00000070':'#13251d26'},
    menu:{width:260,padding:8,borderWidth:1,borderColor:border,borderRadius:17,backgroundColor:surface,shadowColor:'#000',shadowOffset:{width:0,height:8},shadowOpacity:.2,shadowRadius:18,elevation:20},
    menuHead:{minHeight:42,paddingLeft:10,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
    menuTitle:{color:text,fontSize:13,fontWeight:'900'},
    menuClose:{width:38,height:38,alignItems:'center',justifyContent:'center',borderRadius:10},
    menuOption:{minHeight:48,paddingHorizontal:8,flexDirection:'row',alignItems:'center',gap:8,borderRadius:11},
    menuOptionActive:{backgroundColor:dark?darkPalette.actionSoft:'#eef7e1'},
    menuOptionIcon:{width:22,alignItems:'center'},
    menuOptionText:{flex:1,color:text,fontSize:12,fontWeight:'700'},
    menuOptionTextActive:{color:dark?darkPalette.action:palette.action,fontWeight:'900'},
  });
}
