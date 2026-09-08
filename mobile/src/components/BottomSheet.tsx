import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Animated, Easing, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { darkPalette, palette } from '../theme/colors';

export const FormKeyboardContext = createContext<((target: number) => void) | null>(null);

export function useRevealFocusedInput(scrollRef: RefObject<ScrollView | null>, additionalOffset: number) {
  const activeTarget = useRef<number | null>(null);
  const revealActiveTarget = useCallback(() => {
    if (activeTarget.current === null) return;
    scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(activeTarget.current, additionalOffset, true);
  }, [additionalOffset, scrollRef]);
  const revealTarget = useCallback((target: number) => {
    activeTarget.current = target;
    if (Keyboard.isVisible()) setTimeout(revealActiveTarget, 60);
  }, [revealActiveTarget]);
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => setTimeout(revealActiveTarget, 60));
    return () => subscription.remove();
  }, [revealActiveTarget]);
  return revealTarget;
}

export function FormField({ dark, ...props }: React.ComponentProps<typeof TextInput> & { label: string; dark: boolean }) {
  const revealFocusedInput = useContext(FormKeyboardContext);
  const { label, onFocus, ...input } = props;
  return <View style={fieldStyles.field}><Text maxFontSizeMultiplier={1.35} style={[fieldStyles.label,dark&&fieldStyles.labelDark]}>{label}</Text><TextInput placeholderTextColor={dark?'#aab7b0':'#657169'} maxFontSizeMultiplier={1.35} style={[fieldStyles.input,dark&&fieldStyles.inputDark]} {...input} onFocus={(event) => { onFocus?.(event); revealFocusedInput?.(event.nativeEvent.target); }}/></View>;
}

type BottomSheetProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  liftAboveKeyboard?: boolean;
  dark: boolean;
  overlay?: ReactNode;
};

export function BottomSheet({ open, title, onClose, children, footer, liftAboveKeyboard = false, dark, overlay }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const modalRootRef = useRef<View>(null);
  const keyboardTop = useRef<number | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [mounted, setMounted] = useState(open);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [showScrollHint, setShowScrollHint] = useState(false);
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const revealFocusedInput = useRevealFocusedInput(scrollRef, 88);
  const scrollMetrics = useRef({contentHeight:0,viewportHeight:0,offsetY:0});
  const displayedTitle = useRef(title);
  const displayedChildren = useRef(children);
  const displayedFooter = useRef(footer);
  const styles = dark ? darkStyles : lightStyles;

  const updateKeyboardInset = useCallback(() => {
    if (!liftAboveKeyboard) return;
    const top = keyboardTop.current;
    if (top === null) { setKeyboardInset(0); return; }
    modalRootRef.current?.measureInWindow((_x,y,_width,height) => {
      if (keyboardTop.current === top) setKeyboardInset(Math.max(0,y+height-top));
    });
  }, [liftAboveKeyboard]);
  const updateScrollHint = (next: Partial<typeof scrollMetrics.current>) => {
    Object.assign(scrollMetrics.current,next);
    const {contentHeight,viewportHeight,offsetY}=scrollMetrics.current;
    setShowScrollHint(contentHeight>viewportHeight+12&&offsetY+viewportHeight<contentHeight-12);
  };

  if (open) { displayedTitle.current=title; displayedChildren.current=children; displayedFooter.current=footer; }
  useEffect(() => {
    if (!liftAboveKeyboard||!open) return;
    const show=Keyboard.addListener(Platform.OS==='ios'?'keyboardWillChangeFrame':'keyboardDidShow',event=>{keyboardTop.current=event.endCoordinates.screenY;updateKeyboardInset();});
    const hide=Keyboard.addListener(Platform.OS==='ios'?'keyboardWillHide':'keyboardDidHide',()=>{keyboardTop.current=null;setKeyboardInset(0);});
    keyboardTop.current=Keyboard.metrics()?.screenY??null; updateKeyboardInset();
    return()=>{show.remove();hide.remove();keyboardTop.current=null;};
  },[liftAboveKeyboard,open,updateKeyboardInset]);
  useEffect(()=>{if(open){scrollMetrics.current.offsetY=0;setShowScrollHint(false);setMounted(true);}},[open]);
  useEffect(()=>{const show=Keyboard.addListener('keyboardDidShow',()=>setKeyboardOpen(true));const hide=Keyboard.addListener('keyboardDidHide',()=>setKeyboardOpen(false));return()=>{show.remove();hide.remove();};},[]);
  useEffect(()=>{if(!mounted)return;progress.stopAnimation();Animated.timing(progress,{toValue:open?1:0,duration:open?280:210,easing:open?Easing.out(Easing.cubic):Easing.in(Easing.cubic),useNativeDriver:true}).start(({finished})=>{if(finished&&!open)setMounted(false);});},[mounted,open,progress]);

  return <Modal visible={mounted} transparent animationType="none" hardwareAccelerated statusBarTranslucent onRequestClose={onClose}>
    <View ref={modalRootRef} collapsable={false} style={styles.modalRoot} onLayout={updateKeyboardInset}>
      <Animated.View style={[styles.backdrop,{opacity:progress}]}><Pressable accessibilityRole="button" accessibilityLabel="Cerrar modal" style={StyleSheet.absoluteFill} onPress={onClose}/></Animated.View>
      <KeyboardAvoidingView enabled={!liftAboveKeyboard} behavior={Platform.OS==='ios'?'padding':'height'} keyboardVerticalOffset={Platform.OS==='ios'?8:0} style={[fixedStyles.keyboardAvoiding,liftAboveKeyboard&&{paddingBottom:keyboardInset}]}>
        <Animated.View style={[styles.sheet,{paddingBottom:liftAboveKeyboard&&keyboardOpen?12:Math.max(20,insets.bottom+12)},!!displayedFooter.current&&keyboardOpen&&fixedStyles.formSheet,liftAboveKeyboard&&keyboardOpen&&{height:'96%',maxHeight:'96%'},{opacity:progress,transform:[{translateY:progress.interpolate({inputRange:[0,1],outputRange:[52,0]})},{scale:progress.interpolate({inputRange:[0,1],outputRange:[.985,1]})}]}]}>
          <View style={styles.handle}/><View style={styles.head}><Text numberOfLines={2} ellipsizeMode="tail" maxFontSizeMultiplier={1.3} style={styles.title}>{displayedTitle.current}</Text><Pressable accessibilityRole="button" accessibilityLabel="Cerrar modal" onPress={onClose} style={({pressed})=>[styles.close,pressed&&fixedStyles.closePressed]}><Ionicons name="close" size={25} color={dark?darkPalette.secondary:palette.secondary}/></Pressable></View>
          <ScrollView ref={scrollRef} style={displayedFooter.current&&keyboardOpen?fixedStyles.formScroll:fixedStyles.sheetScroll} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} contentContainerStyle={fixedStyles.sheetContent} showsVerticalScrollIndicator={!!displayedFooter.current} indicatorStyle={dark?'white':'black'} scrollEventThrottle={32} onLayout={event=>updateScrollHint({viewportHeight:event.nativeEvent.layout.height})} onContentSizeChange={(_width,height)=>updateScrollHint({contentHeight:height})} onScroll={event=>updateScrollHint({offsetY:event.nativeEvent.contentOffset.y})}><FormKeyboardContext.Provider value={revealFocusedInput}>{displayedChildren.current}</FormKeyboardContext.Provider></ScrollView>
          {displayedFooter.current?<View style={styles.footer}>{showScrollHint?<View pointerEvents="none" style={fixedStyles.scrollHint}><Text style={styles.hintText}>Desliza para ver más</Text><Ionicons name="chevron-down" size={15} color={dark?darkPalette.secondary:palette.secondary}/></View>:null}{displayedFooter.current}</View>:null}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
    {overlay}
  </Modal>;
}

const fixedStyles=StyleSheet.create({keyboardAvoiding:{flex:1,width:'100%',justifyContent:'flex-end'},formSheet:{height:'82%'},formScroll:{flex:1},sheetScroll:{flexShrink:1},sheetContent:{paddingBottom:8},closePressed:{opacity:.65,transform:[{scale:.94}]},scrollHint:{height:28,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:4}});
const lightStyles=StyleSheet.create({modalRoot:{flex:1,justifyContent:'flex-end'},backdrop:{...StyleSheet.absoluteFillObject,backgroundColor:'#13251d99'},sheet:{maxHeight:'82%',paddingHorizontal:22,borderTopLeftRadius:25,borderTopRightRadius:25,backgroundColor:palette.white,shadowColor:'#000',shadowOffset:{width:0,height:-8},shadowOpacity:.16,shadowRadius:20,elevation:18},handle:{width:42,height:4,marginTop:9,marginBottom:11,alignSelf:'center',borderRadius:2,backgroundColor:'#d9dfdb'},head:{marginBottom:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},title:{flex:1,fontSize:22,fontWeight:'800',color:palette.ink},close:{width:44,height:44,marginLeft:12,alignItems:'center',justifyContent:'center',borderRadius:13,backgroundColor:'#f1f4f2'},footer:{paddingTop:11,borderTopWidth:1,borderTopColor:palette.line,backgroundColor:palette.white},hintText:{color:palette.secondary,fontSize:12,fontWeight:'700'}});
const darkStyles=StyleSheet.create({modalRoot:{flex:1,justifyContent:'flex-end'},backdrop:{...StyleSheet.absoluteFillObject,backgroundColor:'#050907b8'},sheet:{maxHeight:'82%',paddingHorizontal:22,borderTopLeftRadius:25,borderTopRightRadius:25,backgroundColor:darkPalette.surface,shadowColor:'#000',shadowOffset:{width:0,height:-8},shadowOpacity:.16,shadowRadius:20,elevation:18},handle:{width:42,height:4,marginTop:9,marginBottom:11,alignSelf:'center',borderRadius:2,backgroundColor:darkPalette.border},head:{marginBottom:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},title:{flex:1,fontSize:22,fontWeight:'800',color:darkPalette.text},close:{width:44,height:44,marginLeft:12,alignItems:'center',justifyContent:'center',borderRadius:13,backgroundColor:darkPalette.raised},footer:{paddingTop:11,borderTopWidth:1,borderTopColor:darkPalette.border,backgroundColor:darkPalette.surface},hintText:{color:darkPalette.secondary,fontSize:12,fontWeight:'700'}});
const fieldStyles=StyleSheet.create({field:{marginBottom:14},label:{marginBottom:7,color:palette.secondary,fontSize:12,fontWeight:'700'},labelDark:{color:darkPalette.secondary},input:{minHeight:48,paddingHorizontal:14,borderWidth:1,borderColor:palette.line,borderRadius:11,color:palette.ink,fontSize:14,backgroundColor:'#fafbf9'},inputDark:{borderColor:darkPalette.border,color:darkPalette.text,backgroundColor:'#151b17'}});
