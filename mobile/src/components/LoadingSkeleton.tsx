import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { darkPalette, palette } from '../theme/colors';

export function LoadingSkeleton({ rows = 5, dark = false }: { rows?: number; dark?: boolean }) {
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue:0.8, duration:700, useNativeDriver:true }),
      Animated.timing(opacity, { toValue:0.35, duration:700, useNativeDriver:true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return <View accessible accessibilityLabel="Cargando contenido" style={styles.list}>
    {Array.from({ length:rows }, (_, index) => <Animated.View key={index} style={[styles.row,dark&&darkStyles.row,{opacity}]}>
      <View style={[styles.avatar,dark&&darkStyles.avatar]}/><View style={styles.body}><View style={[styles.title,dark&&darkStyles.title]}/><View style={[styles.copy,dark&&darkStyles.copy]}/><View style={[styles.copyShort,dark&&darkStyles.copyShort]}/></View>
    </Animated.View>)}
  </View>;
}

const styles=StyleSheet.create({
  list:{gap:10},row:{minHeight:80,padding:14,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:palette.line,borderRadius:16,backgroundColor:palette.white},avatar:{width:48,height:48,marginRight:12,borderRadius:15,backgroundColor:'#dce5df'},body:{flex:1,gap:8},title:{width:'68%',height:14,borderRadius:7,backgroundColor:'#dce5df'},copy:{width:'88%',height:10,borderRadius:5,backgroundColor:'#e5ebe7'},copyShort:{width:'52%',height:10,borderRadius:5,backgroundColor:'#e5ebe7'},
});

const darkStyles=StyleSheet.create({
  row:{borderColor:darkPalette.border,backgroundColor:darkPalette.surface},avatar:{backgroundColor:'#354039'},title:{backgroundColor:'#354039'},copy:{backgroundColor:'#2c352f'},copyShort:{backgroundColor:'#2c352f'},
});
