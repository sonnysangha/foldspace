import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import * as Haptics from 'expo-haptics';
import { Link, router, useFocusEffect } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, FlatList, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { spaceTemplates, type SpaceTemplateId } from '../../shared/space-templates';
import { Button } from '@/components/button';
import { CanvasPreviewCover } from '@/components/canvas/canvas-preview';
import { randomNoteColor } from '@/components/native/native-types';
import { useNotice } from '@/components/notice-provider';
import { kindIcons } from '@/screens/search-screen';
import { TemplatePreview } from '@/screens/space-form-screen';
import { radius, spaceAccent, spaceColors, spacing, useTheme, type Palette } from '@/theme';
import { errorMessage } from '@/utils/error-message';
import { relativeTime } from '@/utils/relative-time';

type Space = FunctionReturnType<typeof api.workspaces.list>[number];
type Found = FunctionReturnType<typeof api.search.everywhere>[number];

const SORTS = [
  { id: 'recent', label: 'Recent', compare: (a: Space, b: Space) => b.updatedAt - a.updatedAt },
  { id: 'name', label: 'Name', compare: (a: Space, b: Space) => a.title.localeCompare(b.title) },
  { id: 'created', label: 'Newest', compare: (a: Space, b: Space) => b.createdAt - a.createdAt },
] as const;

/** The space's colour, thinned to a wash of the paper that sits behind its cover. */
function wash(hex: string, paper: string, amount: number) {
  const channel = (color: string, at: number) => parseInt(color.slice(at, at + 2), 16);
  return `#${[1, 3, 5].map(at => Math.round(channel(paper, at) + (channel(hex, at) - channel(paper, at)) * amount).toString(16).padStart(2, '0')).join('')}`;
}

const cardsLabel = (count: number) => count === 0 ? 'Empty' : `${count} ${count === 1 ? 'card' : 'cards'}`;
const sectionLabelFor = (palette: Palette) => ({ fontSize: 13, fontWeight: '600', color: palette.muted }) as const;

function SpaceCover({ canvasId, color, aspect }: { canvasId: Id<'canvases'>; color: string; aspect: number }) {
  const preview = useQuery(api.canvases.preview, { canvasId });
  const { dark, palette } = useTheme();
  // On dark paper a little more of the colour is needed for the tile to read as tinted.
  const background = wash(spaceAccent(color, palette), palette.paper, dark ? 0.12 : 0.07);
  return <View style={{ aspectRatio: aspect, backgroundColor: background, borderRadius: radius.lg, borderCurve: 'continuous', overflow: 'hidden', borderWidth: 1, borderColor: palette.line }}>
    {preview ? <CanvasPreviewCover preview={preview} background={background} padding={14} /> : null}
  </View>;
}

/**
 * One space: its cover, name, and what is inside. A tap zooms into it; holding it offers its
 * actions, so the tile needs no button of its own.
 */
function SpaceTile({ space, width, aspect, now, onPin, onDelete, onLeave }: {
  space: Space; width: number; aspect: number; now: number;
  onPin: (space: Space) => void; onDelete: (space: Space) => void; onLeave: (space: Space) => void;
}) {
  const { palette, type } = useTheme();
  const edit = () => router.push({ pathname: '/edit-workspace/[id]', params: { id: space._id } });
  const search = () => router.push({ pathname: '/search/[id]', params: { id: space._id } });
  const share = () => router.push({ pathname: '/share/[id]', params: { id: space._id } });
  // What can be done with the space. Someone it was shared with can use it and leave it, not manage it.
  const actions = space.role === 'owner' ? [
    { name: 'edit', label: 'Edit', run: edit },
    { name: 'pin', label: space.pinned ? 'Unpin' : 'Pin to top', run: () => onPin(space) },
    { name: 'share', label: space.shared ? 'Sharing' : 'Share', run: share },
    { name: 'search', label: 'Search cards', run: search },
    { name: 'delete', label: 'Delete', run: () => onDelete(space) },
  ] : [
    { name: 'search', label: 'Search cards', run: search },
    { name: 'people', label: 'People', run: share },
    { name: 'leave', label: 'Leave space', run: () => onLeave(space) },
  ];
  // Holding the cover or the name offers them.
  const sheet = () => {
    if (process.env.EXPO_OS !== 'ios') return;
    void Haptics.selectionAsync();
    ActionSheetIOS.showActionSheetWithOptions({
      title: space.title, options: [...actions.map(action => action.label), 'Cancel'],
      destructiveButtonIndex: actions.length - 1, cancelButtonIndex: actions.length, tintColor: palette.ink,
    }, index => actions[index]?.run());
  };
  const detail = space.role === 'member' ? `Shared by ${space.ownerName ?? 'someone'}` : cardsLabel(space.cardCount);
  // The width sits on a plain wrapper: the zoom source is a native view of its own and would not carry it.
  return <View style={{ width, gap: spacing.sm }}>
    {/*
      The cover is the source of the system zoom into the space, and where it returns to. It carries
      no system menu: a link with one loses its place on the way back, and the zoom out breaks.
    */}
    <Link href={{ pathname: '/workspace/[id]', params: { id: space._id } }} asChild>
      <Link.AppleZoom>
        <Pressable accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onLongPress={sheet} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <SpaceCover canvasId={space.rootCanvasId} color={space.color} aspect={aspect} />
        </Pressable>
      </Link.AppleZoom>
    </Link>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${space.title}`}
      accessibilityValue={{ text: `${detail}${space.role === 'owner' && space.shared ? ', shared' : ''}, edited ${relativeTime(space.updatedAt, now)}` }}
      accessibilityActions={actions.map(({ name, label }) => ({ name, label }))}
      onAccessibilityAction={({ nativeEvent }) => actions.find(action => action.name === nativeEvent.actionName)?.run()}
      onPress={() => router.push({ pathname: '/workspace/[id]', params: { id: space._id } })} onLongPress={sheet}
      style={({ pressed }) => ({ gap: 2, paddingHorizontal: 2, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 16, fontWeight: '600', letterSpacing: -0.2, color: palette.ink }}>{space.title}</Text>
        {space.shared && <SymbolView name={{ ios: 'person.2.fill', android: 'group', web: 'group' }} size={13} tintColor={palette.muted} style={{ width: 20, height: 14 }} />}
      </View>
      <Text numberOfLines={1} style={type.caption}>{detail} · {relativeTime(space.updatedAt, now)}</Text>
    </Pressable>
  </View>;
}

function ResultRow({ icon, dot, title, detail, label, onPress }: {
  icon?: (typeof kindIcons)[string]; dot?: string; title: string; detail?: string; label: string; onPress: () => void;
}) {
  const { palette, type } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, paddingVertical: spacing.sm, opacity: pressed ? 0.55 : 1 })}>
    <View style={{ width: 22, alignItems: 'center' }}>
      {icon ? <SymbolView name={icon} size={18} tintColor={palette.muted} /> : <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot && spaceAccent(dot, palette) }} />}
    </View>
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <Text numberOfLines={1} style={type.headline}>{title}</Text>
      {!!detail && <Text numberOfLines={1} style={type.caption}>{detail}</Text>}
    </View>
  </Pressable>;
}

/** Search from the library looks at space names and at the cards inside every space. */
function SearchResults({ text, spaces }: { text: string; spaces: Space[] }) {
  const { palette, type } = useTheme();
  const sectionLabel = sectionLabelFor(palette);
  const [term, setTerm] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setTerm(text), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const deep = text.length >= 2;
  const current = deep && term === text;
  const cards = useQuery(api.search.everywhere, current ? { text: term } : 'skip');
  const pending = deep && (!current || cards === undefined);
  const named = spaces.filter(space => space.title.toLowerCase().includes(text.toLowerCase()));
  const groups = new Map<Id<'workspaces'>, Found[]>();
  for (const card of current ? cards ?? [] : []) groups.set(card.workspaceId, [...groups.get(card.workspaceId) ?? [], card]);
  const nothing = !named.length && !groups.size && !pending;

  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={{ backgroundColor: palette.paper }}
    contentContainerStyle={{ width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl, gap: spacing.lg, flexGrow: 1 }}>
    {!!named.length && <View>
      <Text accessibilityRole="header" style={sectionLabel}>Spaces</Text>
      {named.map(space => <ResultRow key={space._id} dot={space.color} title={space.title} detail={cardsLabel(space.cardCount)} label={`Open ${space.title}`}
        onPress={() => router.push({ pathname: '/workspace/[id]', params: { id: space._id } })} />)}
    </View>}
    {[...groups].map(([id, found]) => <View key={id}>
      <Text accessibilityRole="header" numberOfLines={1} style={sectionLabel}>In {found[0].workspaceTitle}</Text>
      {found.map(card => <ResultRow key={card._id} icon={kindIcons[card.kind]} title={card.title}
        detail={card.body.replace(/\s+/g, ' ').trim() || (card.canvasTitle !== card.workspaceTitle ? card.canvasTitle : undefined)}
        label={`${card.title}, in ${card.workspaceTitle}`}
        onPress={() => router.push({ pathname: '/canvas/[id]', params: { id: card.canvasId, card: card._id } })} />)}
    </View>)}
    {pending && <ActivityIndicator color={palette.muted} accessibilityLabel="Searching" style={{ paddingVertical: spacing.lg }} />}
    {nothing && <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.xl }} accessibilityLiveRegion="polite">
      <Text accessibilityRole="header" style={type.headline}>No results</Text>
      <Text style={[type.secondary, { textAlign: 'center' }]}>Nothing in your spaces or their cards matches.</Text>
    </View>}
  </ScrollView>;
}

export function LibraryScreen() {
  const { palette, type } = useTheme();
  const sectionLabel = sectionLabelFor(palette);
  const spaces = useQuery(api.workspaces.list, {});
  const seed = useMutation(api.workspaces.seedDemo);
  const create = useMutation(api.workspaces.create);
  const capture = useMutation(api.cards.capture);
  const remove = useMutation(api.workspaces.remove);
  const restore = useMutation(api.workspaces.restore);
  const setPinned = useMutation(api.workspaces.setPinned);
  const leave = useMutation(api.sharing.leave);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<'example' | 'note' | SpaceTemplateId | null>(null);
  const lock = useRef(false);
  const [sort, setSort] = useState(0);
  const [listWidth, setListWidth] = useState(0);
  // "2h ago" is measured from when the library was last looked at, not from each render.
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(useCallback(() => { setNow(Date.now()); }, []));
  const notice = useNotice();
  const window = useWindowDimensions();
  // In landscape the tab bar and toolbar stand down one side; the grid stops short of them.
  const insets = useSafeAreaInsets();
  const width = Math.min(listWidth || window.width, 1240) - spacing.lg * 2;
  const columns = width >= 900 ? 4 : width >= 560 ? 3 : 2;
  const gap = spacing.lg;
  const tileWidth = Math.floor((width - gap * (columns - 1)) / columns);
  const text = query.trim();
  const sorted = [...spaces ?? []].sort(SORTS[sort].compare);
  const pinned = sorted.filter(space => space.pinned);
  const rest = sorted.filter(space => !space.pinned);
  const hasExample = spaces?.some(space => space.isDemo) ?? true;
  // A lone pinned space fills a phone's width; on a wide screen it stays the size of a cover, not a poster.
  const pinnedWidth = Math.min(380, pinned.length === 1 ? width : Math.round(width * 0.78));

  /** One thing at a time: a second tap while something is being made is ignored. */
  const run = async (what: NonNullable<typeof busy>, work: () => Promise<void>, failed: string) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(what);
    try { await work(); }
    catch (error) { notice(errorMessage(error, failed)); }
    finally { lock.current = false; setBusy(null); }
  };
  const openExample = () => run('example', async () => {
    router.push({ pathname: '/workspace/[id]', params: { id: (await seed({}))._id } });
  }, 'Could not open the example. Try again.');
  const startFrom = (template: (typeof spaceTemplates)[number]) => run(template.id, async () => {
    const made = await create({ title: template.title, color: spaceColors[0], template: template.id });
    router.push({ pathname: '/workspace/[id]', params: { id: made._id } });
  }, 'Could not make this space. Try again.');
  /** A thought first, filing later: the note lands in the space edited most recently. */
  const quickNote = () => {
    const target = [...spaces ?? []].sort(SORTS[0].compare)[0];
    if (!target) { router.push('/new-workspace'); return; }
    void run('note', async () => {
      const card = await capture({ workspaceId: target._id, color: randomNoteColor() });
      if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
      // A phone types on the note where it sits; a wider screen opens it beside the canvas.
      router.push({ pathname: '/canvas/[id]', params: { id: card.canvasId, card: card._id, edit: window.width < 560 ? 'inline' : '1' } });
    }, 'Could not add a note. Try again.');
  };
  const togglePin = ({ _id: id, pinned: wasPinned }: Space) => {
    void setPinned({ id, pinned: !wasPinned })
      .then(() => notice(wasPinned ? 'Unpinned' : 'Pinned to the top'))
      .catch(error => notice(errorMessage(error, 'Could not update this pin. Try again.')));
  };
  // No "are you sure": the space goes at once, and the message that says so can bring it back.
  const deleteSpace = ({ _id: id, title }: Space) => {
    void remove({ id })
      .then(() => notice(`Deleted “${title}”`, {
        label: 'Undo',
        onPress: () => { void restore({ id }).catch(error => notice(errorMessage(error, 'Could not bring this space back.'))); },
      }))
      .catch(error => notice(errorMessage(error, 'Could not delete this space. Try again.')));
  };
  const leaveSpace = ({ _id: workspaceId, title }: Space) => {
    void leave({ workspaceId })
      .then(() => notice(`Left “${title}”`))
      .catch(error => notice(errorMessage(error, 'Could not leave this space. Try again.')));
  };
  const tile = (space: Space, tileSize: number, aspect: number) =>
    <SpaceTile key={space._id} space={space} width={tileSize} aspect={aspect} now={now} onPin={togglePin} onDelete={deleteSpace} onLeave={leaveSpace} />;

  const header = <View style={{ gap: spacing.xl }}>
    {!!pinned.length && <View style={{ gap: spacing.md }}>
      <Text accessibilityRole="header" style={sectionLabel}>Pinned</Text>
      {pinned.length === 1 ? tile(pinned[0], pinnedWidth, 1.9) : (
        // The row runs to both screen edges so a cover can slide off them, not stop short.
        <ScrollView horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast" snapToInterval={pinnedWidth + gap}
          style={{ marginHorizontal: -spacing.lg }} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap }}>
          {pinned.map(space => tile(space, pinnedWidth, 1.5))}
        </ScrollView>
      )}
    </View>}
    {!!rest.length && <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 }}>
      <Text accessibilityRole="header" style={sectionLabel}>{pinned.length ? 'Everything else' : `${rest.length} ${rest.length === 1 ? 'space' : 'spaces'}`}</Text>
      {rest.length + pinned.length > 1 && <Pressable accessibilityRole="button" accessibilityLabel={`Sorted by ${SORTS[sort].label}`} accessibilityHint="Changes the order" testID="sort-spaces" hitSlop={10}
        onPress={() => { if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync(); setSort((sort + 1) % SORTS.length); }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, opacity: pressed ? 0.5 : 1 })}>
        <Text style={[sectionLabel, { color: palette.ink }]}>{SORTS[sort].label}</Text>
        <SymbolView name={{ ios: 'chevron.up.chevron.down', android: 'unfold_more', web: 'unfold_more' }} size={11} weight="semibold" tintColor={palette.ink} />
      </Pressable>}
    </View>}
  </View>;

  const empty = spaces === undefined
    ? <ActivityIndicator color={palette.muted} style={{ flex: 1 }} />
    : pinned.length ? undefined : <View style={{ gap: spacing.xl, paddingVertical: spacing.xl, width: '100%', maxWidth: 420, alignSelf: 'center' }}>
      <View style={{ gap: spacing.xs }}>
        <Text accessibilityRole="header" style={type.title}>Start a space</Text>
        <Text style={type.secondary}>A canvas for notes, photos and sketches. Begin with a layout, or with nothing at all.</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {spaceTemplates.filter(item => item.id !== 'blank').map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Start with ${item.title}`} accessibilityHint={item.description}
          testID={`start-${item.id}`} disabled={busy !== null} onPress={() => { void startFrom(item); }}
          style={({ pressed }) => ({ flex: 1, padding: spacing.md, gap: spacing.xs, borderRadius: radius.lg, borderCurve: 'continuous', backgroundColor: palette.surface, opacity: busy && busy !== item.id ? 0.45 : pressed ? 0.7 : 1 })}>
          {busy === item.id ? <ActivityIndicator color={palette.muted} style={{ height: 56 }} /> : <TemplatePreview cards={item.cards} />}
          <Text style={{ fontSize: 15, fontWeight: '600', color: palette.ink, textAlign: 'center' }}>{item.title}</Text>
        </Pressable>)}
      </View>
      <View style={{ gap: spacing.xs }}>
        <Button title="Blank space" onPress={() => router.push('/new-workspace')} testID="create-first-space" />
        <View style={{ flexDirection: 'row' }}>
          <Button style={{ flex: 1 }} variant="plain" title={busy === 'example' ? 'Opening…' : 'Open the example'} busy={busy === 'example'} onPress={() => { void openExample(); }} testID="open-example" />
          <Button style={{ flex: 1 }} variant="plain" title="Join a space" onPress={() => router.push('/join')} testID="join-first-space" />
        </View>
      </View>
    </View>;

  return <>
    <Stack.Screen options={{ title: 'Spaces', headerLargeTitleEnabled: true }} />
    <Stack.SearchBar placeholder="Spaces and cards" hideWhenScrolling={false} onChangeText={event => setQuery(event.nativeEvent.text)} />
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button icon="square.and.pencil" accessibilityLabel="New note" disabled={busy !== null} onPress={quickNote}>New note</Stack.Toolbar.Button>
      <Stack.Toolbar.Button icon="plus" accessibilityLabel="New space" onPress={() => router.push('/new-workspace')}>New space</Stack.Toolbar.Button>
    </Stack.Toolbar>
    {text ? <SearchResults text={text} spaces={spaces ?? []} /> : (
      <FlatList key={columns} data={rest} numColumns={columns} keyExtractor={space => space._id}
        onLayout={event => setListWidth(event.nativeEvent.layout.width)}
        contentInsetAdjustmentBehavior="automatic" initialNumToRender={8} windowSize={5}
        style={{ backgroundColor: palette.paper, marginLeft: insets.left, marginRight: insets.right }}
        contentContainerStyle={{ width: '100%', maxWidth: 1240, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl, flexGrow: 1 }}
        columnWrapperStyle={{ gap }}
        ListHeaderComponent={spaces?.length ? header : undefined}
        ListFooterComponent={!!spaces?.length && !hasExample ? <Button variant="plain" title={busy === 'example' ? 'Opening…' : 'Open the example space'} busy={busy === 'example'} onPress={() => { void openExample(); }} testID="open-example" /> : undefined}
        ListEmptyComponent={empty}
        renderItem={({ item }) => tile(item, tileWidth, 1.2)}
      />
    )}
  </>;
}
