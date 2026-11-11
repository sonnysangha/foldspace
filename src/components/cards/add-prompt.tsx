import * as Location from 'expo-location';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { Glass } from '@/components/glass';
import { spacing, useTheme } from '@/theme';

export type FoundPlace = { title: string; detail: string; latitude: number; longitude: number };

/**
 * The place keeps the name that was searched for; where it was found goes underneath,
 * so "Lisbon" stays "Lisbon" with "Lisboa, Portugal" below it rather than a street name.
 */
function describe(address: Location.LocationGeocodedAddress | undefined, searched: string) {
  const detail = [address?.city, address?.region, address?.country].filter((part, index, all) => part && all.indexOf(part) === index).join(', ');
  return { title: searched, detail };
}

/**
 * A search field that floats over the canvas for adding a link or a place.
 * A place is searched as you type and its matches are listed; a link is added on Return.
 */
export function AddPrompt({ kind, onLink, onPlace, onClose }: {
  kind: 'link' | 'place';
  onLink: (address: string) => void;
  onPlace: (place: FoundPlace) => void;
  onClose: () => void;
}) {
  const { palette, type } = useTheme();
  const [text, setText] = useState('');
  const [found, setFound] = useState<{ query: string; places: FoundPlace[] } | null>(null);
  const query = text.trim();

  useEffect(() => {
    if (kind !== 'place' || query.length < 3) return;
    let active = true;
    const timer = setTimeout(() => {
      void (async () => {
        const hits = (await Location.geocodeAsync(query).catch(() => [])).slice(0, 3);
        const places = await Promise.all(hits.map(async hit => {
          const [address] = await Location.reverseGeocodeAsync(hit).catch(() => []);
          return { ...describe(address, query), latitude: hit.latitude, longitude: hit.longitude };
        }));
        if (active) setFound({ query, places });
      })();
    }, 450);
    return () => { active = false; clearTimeout(timer); };
  }, [kind, query]);

  const searching = kind === 'place' && query.length >= 3 && found?.query !== query;
  const places = kind === 'place' && found?.query === query ? found.places : [];
  const looksLikeLink = /^(https?:\/\/)?[^\s/]+\.[^\s]{2,}$/i.test(query);

  return <Glass style={{ borderRadius: 22, overflow: 'hidden' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.lg, paddingRight: spacing.xs, minHeight: 52 }}>
      <SymbolView name={kind === 'place' ? { ios: 'mappin.and.ellipse', android: 'place', web: 'place' } : { ios: 'link', android: 'link', web: 'link' }} size={17} tintColor={palette.muted} />
      <TextInput autoFocus value={text} onChangeText={setText} testID="add-prompt-field"
        placeholder={kind === 'place' ? 'Search for a place' : 'Paste or type a web address'} placeholderTextColor={palette.faint}
        accessibilityLabel={kind === 'place' ? 'Place' : 'Web address'}
        autoCapitalize={kind === 'place' ? 'words' : 'none'} autoCorrect={false} keyboardType={kind === 'link' ? 'url' : 'default'}
        returnKeyType={kind === 'link' ? 'done' : 'search'}
        onSubmitEditing={() => { if (kind === 'link' && looksLikeLink) onLink(query); else if (places[0]) onPlace(places[0]); }}
        style={{ flex: 1, minHeight: 52, fontSize: 17, color: palette.ink }} />
      {searching && <ActivityIndicator color={palette.muted} />}
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onClose} hitSlop={6}
        style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
        <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={14} weight="semibold" tintColor={palette.ink} />
      </Pressable>
    </View>
    {kind === 'link' && looksLikeLink && <Pressable accessibilityRole="button" accessibilityLabel={`Add ${query}`} testID="add-prompt-link" onPress={() => onLink(query)}
      style={({ pressed }) => ({ minHeight: 52, justifyContent: 'center', paddingHorizontal: spacing.lg, borderTopWidth: 1, borderTopColor: palette.line, opacity: pressed ? 0.5 : 1 })}>
      <Text numberOfLines={1} style={type.headline}>Add link</Text>
      <Text numberOfLines={1} style={type.caption}>{query.replace(/^https?:\/\//i, '')}</Text>
    </Pressable>}
    {places.map((place, index) => <Pressable key={`${place.latitude},${place.longitude}`} accessibilityRole="button" accessibilityLabel={`${place.title}. ${place.detail}`} testID={`add-prompt-place-${index}`}
      onPress={() => onPlace(place)}
      style={({ pressed }) => ({ minHeight: 56, justifyContent: 'center', paddingHorizontal: spacing.lg, borderTopWidth: 1, borderTopColor: palette.line, opacity: pressed ? 0.5 : 1 })}>
      <Text numberOfLines={1} style={type.headline}>{place.title}</Text>
      {!!place.detail && <Text numberOfLines={1} style={type.caption}>{place.detail}</Text>}
    </Pressable>)}
    {kind === 'place' && found?.query === query && !places.length && <Text style={[type.caption, { padding: spacing.lg, borderTopWidth: 1, borderTopColor: palette.line }]}>No places found. Try a fuller name.</Text>}
  </Glass>;
}
