import { ImageFormat, makeImageFromView } from '@shopify/react-native-skia';
import { AppleMaps } from 'expo-maps';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, type ComponentRef } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import { cardInk, lightPalette, radius, spacing } from '@/theme';

/**
 * A live map centred on a place card's pin. The canvas itself is a drawing, so the first
 * time the map is shown it is photographed and handed to `onSnapshot` to become the card's picture.
 */
export function PlaceMap({ title, latitude, longitude, width, needsSnapshot, onSnapshot }: {
  title: string; latitude: number; longitude: number; width: number;
  needsSnapshot: boolean; onSnapshot: (jpeg: Uint8Array) => void;
}) {
  const frame = useRef<ComponentRef<typeof View>>(null);
  const taken = useRef(false);
  useEffect(() => {
    if (!needsSnapshot || taken.current) return;
    // Map tiles arrive over the network; give them a moment before taking the picture.
    const timer = setTimeout(() => {
      void makeImageFromView(frame as never).then(image => {
        const bytes = image?.encodeToBytes(ImageFormat.JPEG, 82);
        if (bytes?.length && !taken.current) { taken.current = true; onSnapshot(bytes); }
      }).catch(() => {});
    }, 3500);
    return () => clearTimeout(timer);
  }, [needsSnapshot, onSnapshot]);

  if (process.env.EXPO_OS !== 'ios') return null;
  return <View style={{ width, gap: spacing.sm }}>
    <View ref={frame} collapsable={false} style={{ width, height: Math.round(width * 0.72), borderRadius: radius.md, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: lightPalette.surface }}>
      <AppleMaps.View style={{ flex: 1 }} cameraPosition={{ coordinates: { latitude, longitude }, zoom: 11 }}
        markers={[{ id: 'pin', coordinates: { latitude, longitude }, title, tintColor: lightPalette.danger }]}
        uiSettings={{ compassEnabled: false, myLocationButtonEnabled: false }} />
    </View>
    <Pressable accessibilityRole="link" accessibilityLabel="Open in Maps" testID="open-in-maps"
      onPress={() => { void Linking.openURL(`https://maps.apple.com/?ll=${latitude},${longitude}&q=${encodeURIComponent(title)}`); }}
      style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: 22, backgroundColor: cardInk.ink, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ fontSize: 16, fontWeight: '600', color: cardInk.onInk }}>Open in Maps</Text>
      <SymbolView name={{ ios: 'arrow.up.right', android: 'north_east', web: 'north_east' }} size={14} tintColor={cardInk.onInk} />
    </Pressable>
  </View>;
}
