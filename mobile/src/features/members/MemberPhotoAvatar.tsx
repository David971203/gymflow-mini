import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

import { api } from '../../api';
import type { Member } from '../../types';
import { darkPalette, palette } from '../../theme/colors';

type MemberPhotoAvatarProps = {
  member: Member;
  dark?: boolean;
  profile?: boolean;
  editor?: boolean;
};

export function MemberPhotoAvatar({ member, dark = false, profile = false, editor = false }: MemberPhotoAvatarProps) {
  const [source, setSource] = useState<{ uri: string } | null>(null);

  useEffect(() => {
    let active = true;
    if (!member.photoUpdatedAt) {
      setSource(null);
      return () => { active = false; };
    }

    void (async () => {
      const request = await api.memberPhotoSource(member);
      const directory = new Directory(Paths.cache, 'member-photos');
      if (!directory.exists) directory.create({ idempotent:true, intermediates:true });
      const safeId = member.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      const version = new Date(member.photoUpdatedAt as string).getTime();
      const file = new File(directory, `${safeId}-${version}.jpg`);
      if (!file.exists) await File.downloadFileAsync(request.uri, file, { headers:request.headers, idempotent:true });
      if (active) setSource({ uri:file.uri });
    })().catch(() => { if (active) setSource(null); });

    return () => { active = false; };
  }, [member.id, member.photoUpdatedAt]);

  const sizeStyle = editor ? styles.editor : profile ? styles.profile : styles.list;
  const textStyle = editor ? styles.editorInitials : profile ? styles.profileInitials : styles.listInitials;
  return (
    <View style={[sizeStyle, dark && !profile && styles.dark, styles.clip]}>
      {source
        ? <Image source={source} onError={() => setSource(null)} resizeMode="cover" style={styles.image}/>
        : <Text style={textStyle}>{member.firstName[0]}{member.lastName[0]}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  list:{width:48,height:48,marginRight:11,borderRadius:15,alignItems:'center',justifyContent:'center',backgroundColor:'#e8f5ce'},
  listInitials:{color:palette.brand,fontSize:13,fontWeight:'900'},
  profile:{width:52,height:52,marginRight:13,alignItems:'center',justifyContent:'center',borderRadius:17,backgroundColor:palette.accent},
  profileInitials:{color:palette.brand,fontSize:15,fontWeight:'900'},
  editor:{width:88,height:88,alignItems:'center',justifyContent:'center',borderRadius:26,backgroundColor:'#e8f5ce'},
  editorInitials:{color:palette.brand,fontSize:22,fontWeight:'900'},
  dark:{backgroundColor:darkPalette.actionSoft},
  clip:{overflow:'hidden'},
  image:{...StyleSheet.absoluteFillObject,width:'100%',height:'100%'},
});
