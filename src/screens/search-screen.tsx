import { useQuery } from 'convex/react';
import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import type { SearchBarCommands } from 'react-native-screens';
import { ActivityIndicator, FlatList, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { spacing, useTheme } from '@/theme';

export const kindIcons: Record<string, SymbolViewProps['name']> = {
  note: { ios: 'note.text', android: 'description', web: 'description' },
  canvas: { ios: 'square.stack', android: 'layers', web: 'layers' },
  image: { ios: 'photo', android: 'image', web: 'image' },
  link: { ios: 'link', android: 'link', web: 'link' },
  checklist: { ios: 'checklist', android: 'checklist', web: 'checklist' },
  audio: { ios: 'waveform', android: 'graphic_eq', web: 'graphic_eq' },
  place: { ios: 'mappin.and.ellipse', android: 'place', web: 'place' },
};

export function SearchScreen({ workspaceId }: { workspaceId: Id<'workspaces'> }) {
  const { palette, type } = useTheme();
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const trimmedQuery = query.trim();

  useEffect(() => {
    const timer = setTimeout(() => setTerm(trimmedQuery), 250);
    return () => clearTimeout(timer);
  }, [trimmedQuery]);

  // The bar's own autoFocus is unreliable on a pushed screen, so it is focused once it has mounted.
  const searchBar = useRef<SearchBarCommands>(null);
  useEffect(() => { const timer = setTimeout(() => searchBar.current?.focus(), 550); return () => clearTimeout(timer); }, []);

  const searching = trimmedQuery.length >= 2;
  const currentQuery = searching && term === trimmedQuery;
  const results = useQuery(api.search.cards, currentQuery ? { workspaceId, text: term } : 'skip');
  const items = currentQuery ? results ?? [] : [];
  const pending = searching && (!currentQuery || results === undefined);

  return <>
    <Stack.Screen options={{ title: 'Search' }} />
    <Stack.Header transparent={false} style={{ backgroundColor: palette.paper }} />
    <Stack.SearchBar ref={searchBar} placeholder="Search cards" hideWhenScrolling={false} autoFocus onChangeText={event => setQuery(event.nativeEvent.text)} />
    <FlatList
      data={items}
      keyExtractor={item => item._id}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: palette.paper }}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={Separator}
      ListFooterComponent={items.length >= RESULT_LIMIT ? (
        <Text style={[styles.footer, { color: palette.muted }]}>Showing the first {items.length} matches. Add a word to narrow it down.</Text>
      ) : undefined}
      ListEmptyComponent={pending ? (
        <View style={styles.empty} accessibilityLiveRegion="polite">
          <ActivityIndicator color={palette.muted} accessibilityLabel="Searching" />
        </View>
      ) : (
        <View style={styles.empty} accessibilityLiveRegion="polite">
          <Text accessibilityRole="header" style={type.headline}>{searching ? 'No results' : 'Search this space'}</Text>
          <Text style={[type.secondary, styles.emptyBody]}>
            {searching ? 'Try a different word.' : 'Titles and notes, including canvases inside cards.'}
          </Text>
        </View>
      )}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button"
          accessibilityLabel={`${item.title}, in ${item.canvasTitle}${item.body ? `. ${item.body}` : ''}`}
          onPress={() => {
            Keyboard.dismiss();
            router.replace({ pathname: '/canvas/[id]', params: { id: item.canvasId, card: item._id } });
          }}
          style={({ pressed }) => [styles.result, pressed && styles.pressed]}>
          <SymbolView name={kindIcons[item.kind]} size={18} tintColor={palette.muted} style={styles.kindIcon} />
          <View style={styles.resultCopy}>
            <Text numberOfLines={2} style={type.headline}>{item.title}</Text>
            {!!item.body && <Text numberOfLines={2} style={type.secondary}>{item.body}</Text>}
            <Text numberOfLines={1} style={type.caption}>{item.canvasTitle}</Text>
          </View>
        </Pressable>
      )}
    />
  </>;
}

/** Matches the per-index cap in convex/search.ts. */
const RESULT_LIMIT = 24;
function Separator() {
  const { palette } = useTheme();
  return <View style={[styles.separator, { backgroundColor: palette.line }]} />;
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
  empty: { alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl },
  emptyBody: { textAlign: 'center', maxWidth: 310 },
  result: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.md, minHeight: 44 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 18 + spacing.md },
  pressed: { opacity: 0.55 },
  kindIcon: { marginTop: 2 },
  resultCopy: { flex: 1, minWidth: 0, gap: 2 },
  footer: { fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg },
});
