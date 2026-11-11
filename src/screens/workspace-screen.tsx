import { useAuth, useUser } from '@clerk/expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAction, useMutation, useQuery, useConvexConnectionState } from 'convex/react';
import { File, Paths } from 'expo-file-system';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useHinge } from 'expo-hinge';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { Stack } from 'expo-router/stack';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { CanvasSurface } from '@/components/canvas/canvas-surface';
import { NestedCanvasPane } from '@/components/canvas/nested-canvas-pane';
import { LoadingView } from '@/components/loading-view';
import { AddPrompt, type FoundPlace } from '@/components/cards/add-prompt';
import { ChecklistEditor } from '@/components/cards/checklist-editor';
import { PlaceMap } from '@/components/cards/place-map';
import { VoicePlayer } from '@/components/cards/voice-player';
import { CardEditor } from '@/components/native/card-editor';
import { CARD_SIZES, includeCurrentColor, PAPER_COLORS, randomNoteColor } from '@/components/native/native-types';
import { paperColor } from '@/utils/paper-color';
import { DrawingControls } from '@/components/native/drawing-controls';
import { DuoLayout } from '@/components/native/duo-layout';
import { Glass } from '@/components/glass';
import { useNotice } from '@/components/notice-provider';
import { Button } from '@/components/button';
import { useCardDraft } from '@/hooks/use-card-draft';
import { useCanvasActions, type CardPatch } from '@/hooks/use-canvas-actions';
import { defaultCardColor, lightPalette, spacing, useTheme } from '@/theme';
import type { CameraAction, CanvasCard, CanvasConnector, CanvasMode, CanvasStroke, NewStroke, Viewport } from '@/types/canvas';
import { placeCard } from '@/utils/canvas-math';
import { resolveCanvasScope } from '@/utils/canvas-scope';
import { parseChecklist, toggleChecklistItem } from '@/utils/checklist';
import { errorMessage } from '@/utils/error-message';
import { formatDuration } from '@/utils/waveform';

/** One row of the menu that opens when a card is held. */
function MenuRow({ label, icon, danger = false, onPress }: { label: string; icon: 'pencil' | 'trash' | 'arrow.triangle.branch' | 'plus.square.on.square' | 'arrow.up.left.and.arrow.down.right'; danger?: boolean; onPress: () => void }) {
  const { palette } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} testID={`card-menu-${label.toLowerCase()}`} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, opacity: pressed ? 0.5 : 1 })}>
    <Text style={{ fontSize: 17, color: danger ? palette.danger : palette.ink }}>{label}</Text>
    <SymbolView name={icon} size={16} tintColor={danger ? palette.danger : palette.ink} />
  </Pressable>;
}

/** Closes a pane: a back chevron when the pane covers the canvas, a cross when it sits beside it. */
function CloseButton({ wide, onPress, testID }: { wide: boolean; onPress: () => void; testID: string }) {
  const { palette } = useTheme();
  return <Glass style={{ width: 44, height: 44, borderRadius: 22, overflow: 'hidden' }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Close" testID={testID} onPress={onPress}
      style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
      <SymbolView name={wide ? { ios: 'xmark', android: 'close', web: 'close' } : { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={wide ? 14 : 17} weight="semibold" tintColor={palette.ink} />
    </Pressable>
  </Glass>;
}

/** "2 of 4 done", for lists of cards where the raw tick-box lines would be noise. */
function checklistSummary(body: string) {
  const items = parseChecklist(body);
  return `${items.filter(item => item.done).length} of ${items.length} done`;
}

const KIND_NAMES: Record<CanvasCard['kind'], string> = { note: 'Note', canvas: 'Space', image: 'Image', link: 'Link', checklist: 'Checklist', audio: 'Voice note', place: 'Place' };
const KIND_ICONS = { note: 'note.text', canvas: 'square.stack', image: 'photo', link: 'link', checklist: 'checklist', audio: 'waveform', place: 'mappin.and.ellipse' } as const;
const NEW_TITLES: Record<Exclude<CanvasCard['kind'], 'image'>, string> = {
  note: 'New sticky note', canvas: 'Untitled space', link: 'Link', checklist: 'New checklist', audio: 'Voice note', place: 'Place',
};

type CaptureRequest = { id: number; canvasId: string; title: string };

export function WorkspaceScreen({ canvasId, initialCardId, initialView, focusTitle = false, typeInPlace = false }: {
  canvasId: Id<'canvases'>; initialCardId?: string; initialView?: string; focusTitle?: boolean;
  /** Arrive already typing on `initialCardId` where it sits on the canvas, as a new note does. */
  typeInPlace?: boolean;
}) {
  const { palette, type } = useTheme();
  const result = useQuery(api.canvases.get, { canvasId });
  const updateText = useMutation(api.cards.update);
  const setCardImage = useMutation(api.cards.setImage);
  const refreshLink = useAction(api.links.refresh);
  // Connecting takes two taps: 'pick' waits for the first card, then its id waits for the second.
  const [connectFrom, setConnectFrom] = useState<'pick' | string | null>(null);
  const [pickedConnector, setPickedConnector] = useState<CanvasConnector | null>(null);
  // Typing straight onto a note on the canvas, instead of opening the editor.
  const [inlineId, setInlineId] = useState<string | null>(typeInPlace ? initialCardId ?? null : null);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [cardMenu, setCardMenu] = useState<{ card: CanvasCard; x: number; y: number } | null>(null);
  const [prompt, setPrompt] = useState<'link' | 'place' | null>(null);
  const [lostContent, setLostContent] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const player = useAudioPlayer(null);
  const playback = useAudioPlayerStatus(player);
  const keyboardHeight = useKeyboardState(state => state.isVisible ? state.height : 0);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recording = useAudioRecorderState(recorder, 250);
  const [savingVoice, setSavingVoice] = useState(false);
  const actions = useCanvasActions(canvasId);
  const { getToken } = useAuth();
  const { user } = useUser();
  const notice = useNotice();
  const connection = useConvexConnectionState();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const hinge = useHinge();
  const [mode, setMode] = useState<CanvasMode>('select');
  const [selectedId, setSelectedId] = useState<string | null>(initialCardId ?? null);
  const [compactCanvas, setCompactCanvas] = useState(typeInPlace || (!initialCardId && initialView !== 'outline'));
  const [showTools, setShowTools] = useState(false);
  const [showOutline, setShowOutline] = useState(initialView === 'outline');
  const [inspectorMode, setInspectorMode] = useState<'write' | 'inside'>('write');
  const [insideSelection, setInsideSelection] = useState<{ canvasId: string; id: string } | null>(null);
  const [insideDocument, setInsideDocument] = useState<{ canvasId: string; cards: CanvasCard[] } | null>(null);
  const [lastInteractedCanvasId, setLastInteractedCanvasId] = useState<string>(canvasId);
  const [focusTitleId, setFocusTitleId] = useState<string | null>(focusTitle || typeInPlace ? initialCardId ?? null : null);
  const [ink, setInk] = useState('#141414');
  const [penWidth, setPenWidth] = useState(3);
  const [importing, setImporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [capture, setCapture] = useState<CaptureRequest | null>(null);
  const [cameraAction, setCameraAction] = useState<CameraAction | undefined>(() => initialCardId ? { id: Date.now(), kind: 'focus', cardId: initialCardId } : undefined);
  const [cameraCanvasId, setCameraCanvasId] = useState<string>(canvasId);
  const [viewport, setViewport] = useState<Viewport | undefined | null>(null);
  const [surfaceEpoch, setSurfaceEpoch] = useState(0);
  const [availableWidth, setAvailableWidth] = useState(0);
  const adding = useRef(false);
  const captureSequence = useRef(0);
  const pendingCapture = useRef<CaptureRequest | null>(null);
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<{ blur: () => void }>(null);
  const dropPoint = useRef({ x: 200, y: 200 });
  const insideCenter = useRef<{ canvasId: string; point: { x: number; y: number } } | null>(null);
  const pendingViewport = useRef<{ key: string; viewport: Viewport } | null>(null);
  const viewportSave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportKey = `foldspace:camera:${user?.id}:${canvasId}`;
  const wide = (availableWidth || window.width - insets.left - insets.right) >= 560;
  const cards: CanvasCard[] = result?.cards ?? [];
  const strokes: CanvasStroke[] = result?.strokes ?? [];
  const selected = cards.find(card => card._id === selectedId) ?? null;
  const insideContext = !!selected && inspectorMode === 'inside' && !compactCanvas && !showOutline;
  const insideActions = useCanvasActions((selected?.childCanvasId ?? canvasId) as Id<'canvases'>);
  const activeCanvasId = resolveCanvasScope({ rootCanvasId: canvasId, insideCanvasId: insideContext ? selected.childCanvasId : null, lastInteractedCanvasId, wide }) as Id<'canvases'>;
  const activeInside = activeCanvasId !== canvasId;
  const activeActions = activeInside ? insideActions : actions;
  const insideCards = insideDocument && insideDocument.canvasId === selected?.childCanvasId ? insideDocument.cards : [];
  const insideSelected = insideSelection && insideSelection.canvasId === selected?.childCanvasId ? insideCards.find(card => card._id === insideSelection.id) ?? null : null;
  const contextCard = activeInside ? insideSelected : selected;
  const dismissKeyboard = useCallback(() => { editorRef.current?.blur(); Keyboard.dismiss(); }, []);
  const wasExpanded = useRef(wide);
  useEffect(() => {
    if (hinge && wide && !wasExpanded.current) dismissKeyboard();
    wasExpanded.current = wide;
  }, [wide, hinge, dismissKeyboard]);

  const commitDraft = useCallback(async (id: string, values: { title: string; body: string }) => { await updateText({ id: id as Id<'cards'>, ...values }); }, [updateText]);
  const draftState = useCardDraft(user?.id ?? '', selected, commitDraft);
  const { draft, change, flush } = draftState;

  const persistViewport = useCallback(() => {
    if (viewportSave.current) clearTimeout(viewportSave.current);
    viewportSave.current = null;
    const pending = pendingViewport.current;
    pendingViewport.current = null;
    if (pending) void AsyncStorage.setItem(pending.key, JSON.stringify(pending.viewport)).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(viewportKey).then(value => {
      if (!active) return;
      try {
        const saved = value ? JSON.parse(value) as Viewport : undefined;
        setViewport(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && Number.isFinite(saved.scale) && saved.scale >= 0.2 && saved.scale <= 4 ? saved : undefined);
      } catch { setViewport(undefined); }
    }).catch(() => { if (active) setViewport(undefined); });
    return () => { active = false; persistViewport(); };
  }, [viewportKey, persistViewport]);

  const cancelCapture = useCallback((id: number, message: string) => {
    if (pendingCapture.current?.id !== id) return;
    pendingCapture.current = null;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = null;
    setCapture(null); setSharing(false); notice(message);
  }, [notice]);
  useFocusEffect(useCallback(() => () => {
    const wasPending = pendingCapture.current !== null;
    pendingCapture.current = null;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = null;
    if (wasPending) { setCapture(null); setSharing(false); }
  }, []));
  useEffect(() => {
    if (!capture) return;
    const hidden = capture.canvasId === canvasId
      ? !wide && (showTools || (!compactCanvas && (!!selected || showOutline)))
      : !insideContext || selected?.childCanvasId !== capture.canvasId || showTools;
    if (hidden) cancelCapture(capture.id, 'Sharing canceled because the canvas view changed. Try again from the view you want to share.');
  }, [capture, canvasId, wide, showTools, compactCanvas, selected, showOutline, insideContext, cancelCapture]);

  const failure = (message: string) => { notice(message); setSurfaceEpoch(value => value + 1); };
  const openCard = (card: CanvasCard) => { dismissKeyboard(); void flush(); router.push({ pathname: '/canvas/[id]', params: { id: card.childCanvasId } }); };
  const inspectInside = (card: CanvasCard) => {
    dismissKeyboard(); void flush();
    router.push({ pathname: '/canvas/[id]', params: { id: card.canvasId, card: card._id } });
  };
  const chooseCard = (card: CanvasCard | null) => {
    if (connectFrom) {
      // Choosing the other end of a connector. A tap on empty canvas, or the same card, cancels.
      const from = connectFrom;
      if (from === 'pick') { setConnectFrom(card ? card._id : null); return; }
      setConnectFrom(null);
      if (card && card._id !== from) {
        void actions.connect(from, card._id)
          .then(outcome => { if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync(); notice(outcome === 'removed' ? 'Connector removed' : 'Connected'); })
          .catch(error => failure(errorMessage(error, 'Could not connect these cards.')));
      }
      return;
    }
    setGroupIds([]); setCardMenu(null);
    if (!wide && card && card._id === selectedId && compactCanvas) {
      // A second tap on a selected card goes in: a note is typed on in place, anything else opens.
      if (card.kind === 'note') { if (inlineId !== card._id) setInlineId(card._id); }
      else { setInlineId(null); setCompactCanvas(false); }
      return;
    }
    if (inlineId) { Keyboard.dismiss(); setInlineId(null); }
    void flush();
    setInspectorMode('write');
    if (card?._id !== selectedId) setInsideSelection(null);
    setLastInteractedCanvasId(canvasId);
    // On a phone the first tap only selects, so the card can be moved, resized and connected.
    setSelectedId(card?._id ?? null); setCompactCanvas(wide ? !card : true); setShowTools(false); setFocusTitleId(null);
  };
  const saveViewport = (next: Viewport) => {
    setViewport(next);
    pendingViewport.current = { key: viewportKey, viewport: next };
    if (viewportSave.current) clearTimeout(viewportSave.current);
    viewportSave.current = setTimeout(persistViewport, 180);
  };
  const revealCanvas = (target: string) => {
    setShowOutline(false); setShowTools(false);
    if (target !== canvasId) { setInspectorMode('inside'); setCompactCanvas(false); }
    else if (!wide) setCompactCanvas(true);
  };
  const camera = (kind: 'fit' | 'focus', cardId?: string) => {
    dismissKeyboard();
    revealCanvas(activeCanvasId);
    setCameraCanvasId(activeCanvasId);
    setCameraAction({ id: Date.now(), kind, cardId });
  };
  const layoutFor = (target: string) => target !== canvasId ? {
    cards: insideCards,
    center: insideCenter.current?.canvasId === target ? insideCenter.current.point : { x: 200, y: 200 },
  } : { cards, center: dropPoint.current };
  /** Sends a file to storage for this space and returns its id. The endpoint explains size and type limits. */
  const uploadFile = async (bytes: Uint8Array, contentType: 'image/jpeg' | 'audio/mp4') => {
    const token = await getToken({ template: 'convex' });
    if (!token || !result) throw new Error('Sign in again to upload this file.');
    const upload = await fetch(`${process.env.EXPO_PUBLIC_CONVEX_SITE_URL}/upload?workspaceId=${result.workspace._id}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType }, body: bytes as unknown as BodyInit });
    if (!upload.ok) {
      const reason = await upload.json().then((value: unknown) => value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : '').catch(() => '');
      throw new Error(reason || 'Could not upload this file. Try again.');
    }
    return (await upload.json() as { storageId: Id<'_storage'> }).storageId;
  };

  /**
   * Adds a card. A note is a title and a description; a space is a card you tap to step
   * into; a checklist, link, voice note and place each carry their own extra fields.
   */
  const addCard = async (kind: Exclude<CanvasCard['kind'], 'image'> = 'note', target = activeCanvasId, extra: { title?: string; body?: string; url?: string; duration?: number; latitude?: number; longitude?: number; imageStorageId?: Id<'_storage'>; at?: { x: number; y: number } } = {}) => {
    if (!result || adding.current) return;
    adding.current = true;
    const layout = layoutFor(target);
    const targetActions = target === canvasId ? actions : insideActions;
    const size = kind === 'link' || kind === 'audio' ? { width: 280, height: 130 } : { width: 280, height: 240 };
    const { title = NEW_TITLES[kind], at, body, ...fields } = extra;
    // Links and voice notes arrive finished, so they are placed without opening the editor.
    const opens = kind !== 'link' && kind !== 'audio';
    try {
      void flush();
      // A double-tap puts the card under the finger; otherwise it goes in the nearest free spot.
      const point = at ? { x: at.x - size.width / 2, y: at.y - size.height / 2 } : placeCard(layout.cards, layout.center, size);
      const card = await targetActions.create({
        canvasId: target, kind, title, body: body ?? (kind === 'checklist' ? '[ ] ' : ''), color: kind === 'note' || kind === 'checklist' ? randomNoteColor() : defaultCardColor, ...point, ...size, ...fields,
      });
      if (target !== canvasId) router.push({ pathname: '/canvas/[id]', params: { id: target, card: card._id, ...(opens ? { edit: '1' } : {}) } });
      else {
        // On a phone a new note is typed on right where it lands; other kinds open their editor.
        const inPlace = kind === 'note' && !wide && body === undefined;
        setSelectedId(card._id); setInspectorMode('write'); setCompactCanvas(inPlace || !opens); setShowOutline(false); setShowTools(false); setFocusTitleId(opens && kind !== 'place' ? card._id : null);
        setInlineId(inPlace ? card._id : null); setGroupIds([]);
        setLastInteractedCanvasId(canvasId); setCameraCanvasId(canvasId);
        if (!at && !(kind === 'note' && !wide)) setCameraAction({ id: Date.now(), kind: 'focus', cardId: card._id });
      }
      // The page is read in the background; its title and picture arrive on the card when ready.
      if (kind === 'link') void refreshLink({ id: card._id as Id<'cards'> }).catch(() => {});
      if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    } catch (error) { failure(errorMessage(error, 'Could not add a card. Try again.')); }
    finally { adding.current = false; }
  };
  const addPlace = () => { dismissKeyboard(); setPrompt('place'); };
  const placeFound = (place: FoundPlace) => {
    setPrompt(null); Keyboard.dismiss();
    void addCard('place', activeCanvasId, { title: place.title.slice(0, 160), latitude: place.latitude, longitude: place.longitude });
  };
  const startVoiceNote = async () => {
    dismissKeyboard();
    try {
      if (!(await requestRecordingPermissionsAsync()).granted) { notice('Allow the microphone in Settings to record voice notes.'); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch { notice('Could not start recording.'); }
  };
  const finishVoiceNote = async (keep: boolean) => {
    const target = activeCanvasId;
    const seconds = recording.durationMillis / 1000;
    try {
      setSavingVoice(true);
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!keep || !recorder.uri) return;
      const imageStorageId = await uploadFile(await new File(recorder.uri).bytes(), 'audio/mp4');
      await addCard('audio', target, { duration: Math.max(0, Math.round(seconds * 10) / 10), imageStorageId });
    } catch (error) { notice(errorMessage(error, error instanceof Error ? error.message : 'Could not save this voice note.')); }
    finally { setSavingVoice(false); }
  };
  const toggleItem = (card: CanvasCard, index: number) => {
    const body = toggleChecklistItem(card.body, index);
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    // The open card is edited through its draft, so the editor and the canvas stay in step.
    if (selected?._id === card._id) change('body', toggleChecklistItem(draft.body, index));
    else void updateText({ id: card._id as Id<'cards'>, body }).catch(() => failure('Could not tick this item.'));
  };
  const savePlacePicture = (id: string, jpeg: Uint8Array) => {
    void uploadFile(jpeg, 'image/jpeg').then(imageStorageId => setCardImage({ id: id as Id<'cards'>, imageStorageId })).catch(() => {});
  };
  const addLink = () => { dismissKeyboard(); setPrompt('link'); };
  const linkEntered = (typed: string) => {
    setPrompt(null); Keyboard.dismiss();
    const url = /^https?:\/\//i.test(typed) ? typed : `https://${typed}`;
    void addCard('link', activeCanvasId, { url, title: url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0] || 'Link' });
  };
  /** Paste: a picture becomes a photo, a web address becomes a link, and other text becomes a note. */
  const pasteCard = async () => {
    if (!result) return;
    try {
      if (await Clipboard.hasImageAsync()) {
        const image = await Clipboard.getImageAsync({ format: 'jpeg', jpegQuality: 0.88 });
        if (image?.data) {
          notice('Adding image…');
          const base64 = image.data.replace(/^data:[^,]+,/, '');
          const storageId = await uploadFile(Uint8Array.from(atob(base64), character => character.charCodeAt(0)), 'image/jpeg');
          const layout = layoutFor(activeCanvasId);
          await activeActions.create({ canvasId: activeCanvasId, kind: 'image', title: 'Pasted image', body: '', color: '#FFFFFF', ...placeCard(layout.cards, layout.center, { width: 300, height: 320 }), width: 300, height: 320, imageStorageId: storageId });
          notice('Image added');
          return;
        }
      }
      const text = (await Clipboard.getStringAsync()).trim();
      if (!text) { notice('Nothing to paste. Copy a link, some text or an image first.'); return; }
      if (/^(https?:\/\/)?[^\s/]+\.[^\s]{2,}$/i.test(text)) linkEntered(text);
      else await addCard('note', activeCanvasId, { title: text.split('\n')[0].slice(0, 80), body: text.includes('\n') || text.length > 80 ? text.slice(0, 8000) : '' });
    } catch (error) { notice(errorMessage(error, error instanceof Error ? error.message : 'Could not paste that.')); }
  };
  const openLink = (url: string) => { void WebBrowser.openBrowserAsync(url).catch(() => notice('Could not open this link.')); };
  const importImage = async () => {
    if (!result || importing) return;
    const target = activeCanvasId;
    const layout = layoutFor(target);
    try {
      dismissKeyboard(); setImporting(true);
      const image = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
      if (image.canceled) return;
      notice('Adding image…');
      const context = ImageManipulator.manipulate(image.assets[0].uri, { maxWidth: 1800, maxHeight: 1800 });
      const normalized = await (await context.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.88 });
      const storageId = await uploadFile(await new File(normalized.uri).bytes(), 'image/jpeg');
      const point = placeCard(layout.cards, layout.center, { width: 300, height: 320 });
      const added = await activeActions.create({ canvasId: target, kind: 'image', title: image.assets[0].fileName?.replace(/\.[^.]+$/, '').slice(0, 160) || 'An image to explore', body: '', color: '#FFFFFF', ...point, width: 300, height: 320, imageStorageId: storageId });
      if (target !== canvasId) router.push({ pathname: '/canvas/[id]', params: { id: target, card: added._id } });
      else { setSelectedId(added._id); setCompactCanvas(true); setLastInteractedCanvasId(canvasId); setCameraCanvasId(canvasId); setCameraAction({ id: Date.now(), kind: 'focus', cardId: added._id }); }
      notice('Image added');
    } catch (error) { notice(errorMessage(error, error instanceof Error ? error.message : 'Could not add that image.')); }
    finally { setImporting(false); }
  };
  const moveCard = async (id: string, x: number, y: number) => { try { await actions.edit(id, { x, y }); } catch { failure('Could not move the card. Try again.'); } };
  const editSelected = async (patch: CardPatch, label: string) => { if (!selected) return; try { await actions.edit(selected._id, patch, label); } catch { failure('Could not update this card. Try again.'); } };
  const saveStroke = async (stroke: NewStroke) => { try { await actions.draw(stroke); } catch { failure('Could not save this stroke. Please draw it again.'); } };
  const eraseStroke = async (ids: string[]) => { try { await actions.erase(ids); } catch { failure('Could not erase this ink.'); } };
  const undo = async () => { try { await activeActions.history.undo(); } catch { failure('Could not undo. Your action is still available to retry.'); } };
  const redo = async () => { try { await activeActions.history.redo(); } catch { failure('Could not redo. Please try again.'); } };
  const nudge = async (dx: number, dy: number) => {
    if (!contextCard) return;
    try { await activeActions.edit(contextCard._id, { x: Math.max(-100000, Math.min(100000, contextCard.x + dx)), y: Math.max(-100000, Math.min(100000, contextCard.y + dy)) }); revealCanvas(activeCanvasId); setCameraCanvasId(activeCanvasId); setCameraAction({ id: Date.now(), kind: 'focus', cardId: contextCard._id }); }
    catch { failure('Could not move this card.'); }
  };
  /** Deletes straight away. The notice and its Undo are the safety net, so there is no "are you sure". */
  const deleteSelected = (card?: CanvasCard) => {
    const deleting = card ?? contextCard;
    if (!deleting) return;
    setInlineId(null); setCardMenu(null);
    const history = activeActions.history;
    void (async () => {
      if (!activeInside && !await flush()) { notice('This card has unsaved changes. Retry saving before deleting it.'); return; }
      await activeActions.remove(deleting._id);
      dismissKeyboard();
      if (activeInside) setInsideSelection(null); else { setSelectedId(null); setCompactCanvas(true); }
      if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      notice(`Deleted “${deleting.title}”`, { label: 'Undo', onPress: () => { void history.undo().catch(() => failure('Could not undo. Try again from the toolbar.')); } });
    })().catch(error => failure(errorMessage(error, 'Could not delete this card.')));
  };
  const connectCards = (from: string, to: string) => {
    void actions.connect(from, to)
      .then(outcome => { if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync(); notice(outcome === 'removed' ? 'Connector removed' : 'Connected'); })
      .catch(error => failure(errorMessage(error, 'Could not connect these cards.')));
  };
  const startConnect = (from: string) => { dismissKeyboard(); void flush(); setInlineId(null); setCardMenu(null); if (!wide) setCompactCanvas(true); setConnectFrom(from); };
  const duplicateCard = (card: CanvasCard) => {
    setCardMenu(null);
    void actions.create({ kind: card.kind, title: card.title, body: card.body, color: card.color, x: card.x + 32, y: card.y + 32, width: card.width, height: card.height, ...(card.url ? { url: card.url } : {}) })
      .then(copy => { setSelectedId(copy._id); if (card.kind === 'link') void refreshLink({ id: copy._id as Id<'cards'> }).catch(() => {}); })
      .catch(error => failure(errorMessage(error, 'Could not duplicate this card.')));
  };
  const deleteGroup = () => {
    const ids = groupIds;
    setGroupIds([]);
    void (async () => { for (const id of ids) await actions.remove(id); notice(`Deleted ${ids.length} ${ids.length === 1 ? 'card' : 'cards'}`); })()
      .catch(error => failure(errorMessage(error, 'Could not delete these cards.')));
  };
  /** Plays or pauses a voice note from its card on the canvas. */
  const playVoice = (card: CanvasCard) => {
    if (!card.imageUrl) return;
    if (playingId === card._id && playback.playing) { player.pause(); return; }
    if (playingId !== card._id) { player.replace(card.imageUrl); setPlayingId(card._id); }
    else if (playback.duration && playback.currentTime >= playback.duration - 0.05) void player.seekTo(0);
    player.play();
  };
  const onCapture = useCallback((image: string | null, requestId: number) => {
    const request = pendingCapture.current;
    if (!request || request.id !== requestId) return;
    pendingCapture.current = null;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = null;
    setCapture(null);
    void (async () => {
      try {
        if (!image) throw new Error('Could not create this image. Please try again.');
        const file = new File(Paths.cache, `foldspace-${Date.now()}.png`);
        file.create(); file.write(image, { encoding: 'base64' });
        await Sharing.shareAsync(file.uri, { dialogTitle: request.title, mimeType: 'image/png' });
      } catch (error) { notice(error instanceof Error ? error.message : 'Could not share this view.'); }
      finally { setSharing(false); }
    })();
  }, [notice]);
  const shareCanvas = () => {
    if (!result || sharing) return;
    dismissKeyboard(); revealCanvas(activeCanvasId);
    const request = { id: ++captureSequence.current, canvasId: activeCanvasId, title: activeInside && selected ? selected.title : result.canvas.title };
    pendingCapture.current = request;
    setSharing(true); setCapture(request);
    captureTimer.current = setTimeout(() => cancelCapture(request.id, 'Could not create this image. Please try sharing this view again.'), 12000);
  };
  const selectTool = (next: CanvasMode) => {
    dismissKeyboard(); setMode(next); setShowTools(false); setShowOutline(false);
    if (!insideContext) setCompactCanvas(true);
  };

  if (!result || viewport === null) return <LoadingView label="Opening…" />;
  const goBack = () => { dismissKeyboard(); void flush(); if (router.canGoBack()) router.back(); else router.dismissTo('/'); };
  const parentCrumb = result.breadcrumbs.length > 1 ? result.breadcrumbs[result.breadcrumbs.length - 2] : null;
  /** One level out: the parent canvas, or from a space's top canvas, the library. */
  const stepOut = () => {
    if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!parentCrumb) { goBack(); return; }
    dismissKeyboard(); void flush();
    if (result.breadcrumbs.length === 2) router.dismissTo({ pathname: '/workspace/[id]', params: { id: result.workspace._id } });
    else router.dismissTo({ pathname: '/canvas/[id]', params: { id: parentCrumb._id } });
  };
  const findInSpace = () => { dismissKeyboard(); void flush(); router.push({ pathname: '/search/[id]', params: { id: result.workspace._id } }); };
  const sizeIndex = selected ? CARD_SIZES.findIndex(size => size.width === selected.width && size.height === selected.height) : -1;
  const nextSize = CARD_SIZES[(sizeIndex + 1) % CARD_SIZES.length];
  const cardBar = selected ? (
        <Glass style={{ flexDirection: 'row', alignItems: 'center', height: 44, borderRadius: 22, paddingHorizontal: spacing.xs, overflow: 'hidden' }}>
          <View accessibilityRole="radiogroup" accessibilityLabel="Color" testID="card-color" style={{ flexDirection: 'row', alignItems: 'center' }}>
            {includeCurrentColor(PAPER_COLORS, selected.color).map(option => {
              const active = option.value === selected.color;
              return <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ selected: active, checked: active }}
                onPress={() => { if (!active) void editSelected({ color: option.value }, 'Change paper'); }} hitSlop={{ top: 8, bottom: 8 }}
                style={({ pressed }) => ({ width: 28, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: option.value, borderWidth: active ? 2 : 1, borderColor: active ? palette.ink : palette.cardEdge }} />
              </Pressable>;
            })}
          </View>
          <View style={{ width: 1, height: 20, backgroundColor: palette.line, marginHorizontal: spacing.xs }} />
          <Pressable accessibilityRole="button" accessibilityLabel={`Size: ${sizeIndex >= 0 ? CARD_SIZES[sizeIndex].label : 'Custom'}. Change to ${nextSize.label}`} testID="card-size"
            onPress={() => { void editSelected({ width: nextSize.width, height: nextSize.height }, 'Resize card'); }}
            style={({ pressed }) => ({ width: 36, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
            {sizeIndex >= 0
              ? <Text style={{ fontSize: 15, fontWeight: '600', color: palette.ink }}>{CARD_SIZES[sizeIndex].short}</Text>
              : <Text style={{ fontSize: 15, fontWeight: '600', color: palette.faint }}>M</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Connect to another card" testID="connect-card"
            onPress={() => startConnect(selected._id)}
            style={({ pressed }) => ({ width: 36, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
            <SymbolView name={{ ios: 'arrow.turn.up.right', android: 'call_made', web: 'call_made' }} size={16} weight="semibold" tintColor={palette.ink} />
          </Pressable>
          {!wide && compactCanvas && <Pressable accessibilityRole="button" accessibilityLabel="Open card" testID="open-card"
            onPress={() => { Keyboard.dismiss(); setInlineId(null); setCompactCanvas(false); }}
            style={({ pressed }) => ({ width: 36, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
            <SymbolView name={{ ios: 'arrow.up.left.and.arrow.down.right', android: 'open_in_full', web: 'open_in_full' }} size={15} weight="semibold" tintColor={palette.ink} />
          </Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel="Delete card" testID="delete-card" onPress={() => deleteSelected()}
            style={({ pressed }) => ({ width: 36, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
            <SymbolView name={{ ios: 'trash', android: 'delete', web: 'delete' }} size={17} tintColor={palette.danger} />
          </Pressable>
        </Glass>
  ) : null;
  const canvas = <View style={{ flex: 1, backgroundColor: palette.canvas }}>
    <CanvasSurface key={`${canvasId}:${surfaceEpoch}`} cards={cards} strokes={strokes} connectors={result.connectors} connecting={!!connectFrom} selectedConnectorId={pickedConnector?._id ?? null} onSelectConnector={setPickedConnector}
      groupIds={groupIds} playingId={playback.playing ? playingId : null} onPlay={playVoice} onConnect={connectCards} onLostContent={setLostContent}
      onResize={(id, width, height) => { void actions.edit(id, { width, height }, 'Resize card').catch(() => failure('Could not resize this card.')); }}
      onCardMenu={(card, at) => { void flush(); setInlineId(null); setGroupIds([]); setSelectedId(card._id); if (!wide) setCompactCanvas(true); setCardMenu({ card, ...at }); }}
      onAddAt={point => { void addCard('note', canvasId, { at: point }); }}
      onGroupSelect={ids => { void flush(); setInlineId(null); setSelectedId(null); setCompactCanvas(true); setGroupIds(ids); }}
      editing={inlineId && selected?._id === inlineId ? { id: inlineId, title: draft.title, body: draft.body, selectAll: focusTitleId === inlineId, onTitleChange: value => change('title', value), onBodyChange: value => change('body', value) } : undefined} mode={mode} selectedId={selectedId} color={ink} strokeWidth={penWidth} initialViewport={viewport ?? undefined} preferReadableStart onWillOpen={() => { dismissKeyboard(); void flush(); }} onToggleItem={toggleItem} onPinchOut={stepOut}
      cameraAction={cameraCanvasId === canvasId ? cameraAction : undefined} captureRequest={capture?.canvasId === canvasId ? capture.id : 0} onCapture={onCapture} onInteraction={() => setLastInteractedCanvasId(canvasId)}
      onSelect={chooseCard} onDragSelect={card => { void flush(); if (card._id !== selectedId) setInsideSelection(null); setSelectedId(card._id); }} onOpen={openCard} onMove={(...args) => { void moveCard(...args); }} onStroke={stroke => { void saveStroke(stroke); }} onErase={ids => { void eraseStroke(ids); }} onViewportChange={saveViewport} onCanvasPoint={(x, y) => { dropPoint.current = { x, y }; }} />
    {!cards.length && !strokes.length && mode === 'select' && <View pointerEvents="box-none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm }}>
      <Text accessibilityRole="header" style={type.title}>Empty canvas</Text>
      <Text style={[type.secondary, { textAlign: 'center' }]}>Add a note, or pick the pen and draw.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.md }}>
        <Button title="Add a note" onPress={() => { void addCard('note', canvasId); }} testID="add-first-card" />
        <Button variant="secondary" title="Draw" onPress={() => { setLastInteractedCanvasId(canvasId); selectTool('draw'); }} testID="start-drawing" />
      </View>
    </View>}
    <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + spacing.xs, left: insets.left + spacing.md, right: spacing.md, flexDirection: 'row' }}>
      <Glass style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', height: 44, borderRadius: 22, overflow: 'hidden' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" testID="canvas-back" onPress={goBack}
          style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
          <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={17} weight="semibold" tintColor={palette.ink} />
        </Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ alignItems: 'center', gap: spacing.sm, paddingRight: spacing.lg }}>
          {result.breadcrumbs.map((crumb, index) => {
            const current = crumb._id === canvasId;
            return <View key={crumb._id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              {index > 0 && <SymbolView name="chevron.right" size={8} tintColor={palette.faint} />}
              <Pressable accessibilityRole={current ? 'header' : 'button'} accessibilityLabel={current ? crumb.title : `${crumb.title}, go back`} disabled={current} onPress={() => {
                dismissKeyboard(); void flush();
                if (index === 0) router.dismissTo({ pathname: '/workspace/[id]', params: { id: result.workspace._id } });
                else router.dismissTo({ pathname: '/canvas/[id]', params: { id: crumb._id } });
              }} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text numberOfLines={1} style={{ maxWidth: 180, color: current ? palette.ink : palette.muted, fontSize: 15, fontWeight: current ? '600' : '400' }}>{crumb.title}</Text>
              </Pressable>
            </View>;
          })}
        </ScrollView>
      </Glass>
    </View>
    {pickedConnector && !connectFrom && <View pointerEvents="box-none" style={{ position: 'absolute', left: spacing.md, right: spacing.md, bottom: insets.bottom + 76, alignItems: 'center' }}>
      <Glass style={{ flexDirection: 'row', alignItems: 'center', height: 52, borderRadius: 26, paddingHorizontal: spacing.xs, overflow: 'hidden' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Delete connector" testID="delete-connector"
          onPress={() => {
            const { fromCardId, toCardId } = pickedConnector;
            setPickedConnector(null);
            void actions.connect(fromCardId, toCardId)
              .then(() => notice('Connector deleted', { label: 'Undo', onPress: () => { void actions.history.undo().catch(() => failure('Could not undo. Try again from the toolbar.')); } }))
              .catch(error => failure(errorMessage(error, 'Could not delete this connector.')));
          }}
          style={({ pressed }) => ({ height: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, opacity: pressed ? 0.5 : 1 })}>
          <SymbolView name={{ ios: 'trash', android: 'delete', web: 'delete' }} size={17} tintColor={palette.danger} />
          <Text style={{ fontSize: 16, fontWeight: '600', color: palette.danger }}>Delete connector</Text>
        </Pressable>
      </Glass>
    </View>}
    {selected && !wide && compactCanvas && !connectFrom && !cardMenu && <View pointerEvents="box-none" style={{ position: 'absolute', left: spacing.md, right: spacing.md, bottom: keyboardHeight ? keyboardHeight + spacing.md : insets.bottom + 76, alignItems: 'center' }}>{cardBar}</View>}
    {groupIds.length > 0 && <View pointerEvents="box-none" style={{ position: 'absolute', left: spacing.md, right: spacing.md, bottom: insets.bottom + 76, alignItems: 'center' }}>
      <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 52, borderRadius: 26, paddingLeft: spacing.lg, paddingRight: spacing.xs, overflow: 'hidden' }}>
        <Text accessibilityLiveRegion="polite" style={{ fontSize: 16, fontWeight: '600', color: palette.ink }}>{groupIds.length} selected</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${groupIds.length} cards`} testID="delete-group" onPress={deleteGroup} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: spacing.md, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: palette.danger }}>Delete</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Done selecting" onPress={() => setGroupIds([])} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: spacing.md, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
          <Text style={{ fontSize: 16, color: palette.muted }}>Done</Text>
        </Pressable>
      </Glass>
    </View>}
    {lostContent && !prompt && <View pointerEvents="box-none" style={{ position: 'absolute', left: spacing.md, right: spacing.md, top: insets.top + 60, alignItems: 'center' }}>
      <Glass style={{ height: 44, borderRadius: 22, overflow: 'hidden' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to your cards" testID="back-to-content" onPress={() => camera('fit')} style={({ pressed }) => ({ height: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, opacity: pressed ? 0.5 : 1 })}>
          <SymbolView name={{ ios: 'scope', android: 'my_location', web: 'my_location' }} size={15} tintColor={palette.ink} />
          <Text style={{ fontSize: 15, fontWeight: '600', color: palette.ink }}>Back to your cards</Text>
        </Pressable>
      </Glass>
    </View>}
    {prompt && <View pointerEvents="box-none" style={{ position: 'absolute', left: spacing.md, right: spacing.md, top: insets.top + 60, alignItems: 'center' }}>
      <View style={{ width: '100%', maxWidth: 440 }}><AddPrompt key={prompt} kind={prompt} onLink={linkEntered} onPlace={placeFound} onClose={() => { Keyboard.dismiss(); setPrompt(null); }} /></View>
    </View>}
    {cardMenu && <>
      <Pressable accessibilityLabel="Close menu" onPress={() => setCardMenu(null)} style={{ position: 'absolute', inset: 0 }} />
      <Glass style={{ position: 'absolute', left: Math.max(spacing.md, Math.min(cardMenu.x - 20, (availableWidth || window.width) - 232)), top: Math.max(insets.top + 60, Math.min(cardMenu.y - 20, window.height - insets.bottom - 330)), width: 216, borderRadius: 18, overflow: 'hidden', paddingVertical: spacing.xs }}>
        {cardMenu.card.kind === 'canvas' && <MenuRow label="Open" icon="arrow.up.left.and.arrow.down.right" onPress={() => { setCardMenu(null); openCard(cardMenu.card); }} />}
        <MenuRow label="Edit" icon="pencil" onPress={() => { setCardMenu(null); if (cardMenu.card.kind === 'note' && !wide) setInlineId(cardMenu.card._id); else setCompactCanvas(false); }} />
        {['note', 'checklist', 'link'].includes(cardMenu.card.kind) && <MenuRow label="Duplicate" icon="plus.square.on.square" onPress={() => duplicateCard(cardMenu.card)} />}
        <MenuRow label="Connect" icon="arrow.triangle.branch" onPress={() => startConnect(cardMenu.card._id)} />
        <MenuRow label="Delete" icon="trash" danger onPress={() => deleteSelected(cardMenu.card)} />
      </Glass>
    </>}
    {connectFrom && <View pointerEvents="box-none" style={{ position: 'absolute', left: spacing.md, right: spacing.md, bottom: insets.bottom + 76, alignItems: 'center' }}>
      <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 52, borderRadius: 26, paddingLeft: spacing.lg, paddingRight: spacing.xs, overflow: 'hidden' }}>
        <Text accessibilityLiveRegion="polite" style={{ fontSize: 16, fontWeight: '600', color: palette.ink }}>{connectFrom === 'pick' ? 'Tap the first card' : 'Now tap the card to connect to'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel connecting" onPress={() => setConnectFrom(null)} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: spacing.md, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
          <Text style={{ fontSize: 16, color: palette.muted }}>Cancel</Text>
        </Pressable>
      </Glass>
    </View>}
    {(recording.isRecording || savingVoice) && <View pointerEvents="box-none" style={{ position: 'absolute', left: spacing.md, right: spacing.md, bottom: insets.bottom + 76, alignItems: 'center' }}>
      <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, height: 52, borderRadius: 26, paddingLeft: spacing.lg, paddingRight: spacing.xs, overflow: 'hidden' }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: palette.danger }} />
        <Text accessibilityLiveRegion="polite" style={{ fontSize: 17, fontWeight: '600', color: palette.ink, fontVariant: ['tabular-nums'], minWidth: 44 }}>{savingVoice ? 'Saving…' : formatDuration(recording.durationMillis / 1000)}</Text>
        {!savingVoice && <>
          <Pressable accessibilityRole="button" accessibilityLabel="Discard recording" onPress={() => { void finishVoiceNote(false); }} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: spacing.sm, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
            <Text style={{ fontSize: 16, color: palette.muted }}>Discard</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Stop and save recording" testID="stop-recording" onPress={() => { void finishVoiceNote(true); }}
            style={({ pressed }) => ({ height: 44, paddingHorizontal: spacing.lg, borderRadius: 22, backgroundColor: palette.ink, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: palette.onInk }}>Done</Text>
          </Pressable>
        </>}
      </Glass>
    </View>}
    {mode !== 'select' && <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 56, left: spacing.lg, right: spacing.lg }}><Text style={type.caption}>{mode === 'draw' ? 'One finger draws. Two fingers move. Tap the pen again to stop.' : 'Drag across ink to erase it.'}</Text></View>}
  </View>;
  const closeEditor = () => { dismissKeyboard(); void flush(); setSelectedId(null); setFocusTitleId(null); setCompactCanvas(true); };
  const outline = <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: 110 }} keyboardShouldPersistTaps="handled">
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.md }}>
      <CloseButton wide={wide} onPress={() => { setShowOutline(false); if (!selected) setCompactCanvas(true); }} testID="done-card-list" />
      <Text accessibilityRole="header" style={type.headline}>{cards.length} {cards.length === 1 ? 'card' : 'cards'}</Text>
    </View>
    {cards.map(card => <Pressable accessibilityRole="button" accessibilityState={{ selected: selectedId === card._id }} accessibilityLabel={`${card.title}. ${KIND_NAMES[card.kind]}. ${card.kind === 'checklist' ? checklistSummary(card.body) : card.body}`} key={card._id} onPress={() => { chooseCard(card); setShowOutline(false); setCameraCanvasId(canvasId); setCameraAction({ id: Date.now(), kind: 'focus', cardId: card._id }); }}
      style={({ pressed }) => ({ minHeight: 52, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: palette.line, opacity: pressed ? 0.55 : 1 })}>
      <SymbolView name={KIND_ICONS[card.kind]} tintColor={palette.muted} size={18} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={type.headline}>{card.title}</Text>
        {card.kind === 'checklist'
          ? <Text style={type.secondary}>{checklistSummary(card.body)}</Text>
          : !!card.body && <Text numberOfLines={2} style={type.secondary}>{card.body}</Text>}
      </View>
    </Pressable>)}
    <Button variant="plain" title="Add a note" onPress={() => { void addCard(); }} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
  </ScrollView>;
  const selectedEditor = selected ? <CardEditor key={selected._id} editorRef={editorRef} autoFocus={focusTitleId === selected._id} kind={selected.kind} url={selected.url} title={draft.title} body={draft.body} color={selected.color} imageUrl={selected.kind === 'image' ? selected.imageUrl : selected.kind === 'link' ? selected.linkImage : undefined}
    renderExtra={selected.kind === 'checklist'
      ? width => <ChecklistEditor body={draft.body} width={width} onChange={value => change('body', value)} />
      : selected.kind === 'audio' && selected.imageUrl
        ? width => <VoicePlayer id={selected._id} url={selected.imageUrl!} duration={selected.duration ?? 0} width={width} />
        : selected.kind === 'place' && selected.latitude !== undefined && selected.longitude !== undefined
          ? width => <PlaceMap title={draft.title} latitude={selected.latitude!} longitude={selected.longitude!} width={width} needsSnapshot={!selected.imageUrl} onSnapshot={jpeg => savePlacePicture(selected._id, jpeg)} />
          : undefined}
    onTitleChange={value => change('title', value)} onBodyChange={value => change('body', value)}
    onOpenCanvas={selected.kind === 'canvas' ? () => openCard(selected) : undefined} onOpenLink={selected.url ? () => openLink(selected.url!) : undefined} /> : null;
  // The editor is the card's own paper, so the whole pane takes its colour.
  const editorPaper = selected ? paperColor(selected.color) : palette.paper;

  const editor = selected ? <View style={{ flex: 1, minHeight: 0, backgroundColor: editorPaper }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.xs }}>
      <CloseButton wide={wide} onPress={closeEditor} testID="done-editing" />
      {draftState.status === 'error' && <Pressable accessibilityRole="button" accessibilityLabel="Not saved. Retry" onPress={() => { void flush(); }} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: lightPalette.danger, fontSize: 15 }}>{draftState.localSaved ? 'Saved on this device · Retry' : 'Not saved · Retry'}</Text>
      </Pressable>}
    </View>
    <View style={{ flex: 1, minHeight: 0 }}>{inspectorMode === 'inside' ? <NestedCanvasPane key={selected.childCanvasId} canvasId={selected.childCanvasId as Id<'canvases'>} selectedId={insideSelected?._id ?? null} mode={mode} color={ink} strokeWidth={penWidth}
      cameraAction={cameraCanvasId === selected.childCanvasId ? cameraAction : undefined} captureRequest={capture?.canvasId === selected.childCanvasId ? capture.id : 0} onCapture={onCapture} onInteraction={() => setLastInteractedCanvasId(selected.childCanvasId)}
      onSelectCard={card => setInsideSelection(card ? { canvasId: card.canvasId, id: card._id } : null)} onInspectCard={inspectInside} onOpenCard={openCard} onExpand={() => openCard(selected)} onAdd={() => { void addCard('note', selected.childCanvasId as Id<'canvases'>); }}
      onCardsChange={items => setInsideDocument({ canvasId: selected.childCanvasId, cards: items })} onCanvasPoint={(x, y) => { insideCenter.current = { canvasId: selected.childCanvasId, point: { x, y } }; }} onError={notice} /> : selectedEditor}</View>
    {/* Colour, size, connect and delete float at the bottom of the note, above the keyboard when it is up. */}
    <View pointerEvents="box-none" style={{ position: 'absolute', left: spacing.md, right: spacing.md, bottom: keyboardHeight ? keyboardHeight - insets.bottom + spacing.md : 72, alignItems: 'center' }}>{cardBar}</View>
  </View> : <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl }}><Text style={[type.secondary, { textAlign: 'center' }]}>Tap a note to edit it.{'\n'}Tap a space to step inside.</Text></View>;
  const side = showTools ? (
    <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.md, paddingTop: spacing.xs, gap: spacing.lg, paddingBottom: 110 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <CloseButton wide={wide} onPress={() => setShowTools(false)} testID="done-pen-settings" />
        <Text accessibilityRole="header" style={type.headline}>Pen</Text>
      </View>
      <DrawingControls color={ink} width={penWidth} onColorChange={setInk} onWidthChange={setPenWidth} />
    </ScrollView>
  ) : showOutline ? outline : editor;
  const showSecondary = showTools || (!compactCanvas && (!!selected || showOutline));

  const sideColor = selected && !showTools && !showOutline ? editorPaper : palette.paper;
  const toggleCardList = () => {
    dismissKeyboard();
    if (activeInside && selected) router.push({ pathname: '/canvas/[id]', params: { id: selected.childCanvasId, view: 'outline' } });
    else { setShowOutline(value => !value); setCompactCanvas(false); setShowTools(false); }
  };
  const drawing = mode !== 'select';

  // No navigation bar: the canvas runs edge to edge. Back and the trail float over it,
  // and every other control lives in the bottom toolbar.
  return <>
    <Stack.Screen options={{ title: result.canvas.title, headerShown: false }} />
    {/* A card's paper is light in both appearances; when it fills the screen the status bar must stay dark on it. */}
    {showSecondary && !wide && sideColor !== palette.paper && <StatusBar style="dark" />}
    <View onLayout={event => setAvailableWidth(event.nativeEvent.layout.width - insets.left - insets.right)} style={{ flex: 1, backgroundColor: palette.canvas }}>
      {!connection.isWebSocketConnected && connection.hasEverConnected && <View accessibilityRole="alert" style={{ paddingTop: insets.top + spacing.sm, paddingBottom: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: palette.surface }}><Text style={[type.caption, { textAlign: 'center' }]}>Offline. Changes will sync when you reconnect.</Text></View>}
      <DuoLayout primary={canvas} secondary={/* The pane's colour runs to every screen edge, under the system's side bar too; only its content is inset. */
        <View style={{ flex: 1, minHeight: 0, paddingTop: insets.top, paddingRight: insets.right, paddingLeft: wide ? 0 : insets.left, paddingBottom: insets.bottom, backgroundColor: sideColor }}>{side}</View>} wide={wide} showSecondary={showSecondary} secondaryColor={sideColor} />
    </View>
    <Stack.Toolbar placement="bottom" tintColor={palette.ink}>
      {/* Tapping and moving cards is the default. The pen is the only tool, switched on and off. */}
      <Stack.Toolbar.Button icon="pencil.tip.crop.circle" tintColor={palette.ink} accessibilityLabel="Draw" selected={mode === 'draw'} onPress={() => selectTool(mode === 'draw' ? 'select' : 'draw')}>Draw</Stack.Toolbar.Button>
      <Stack.Toolbar.Button hidden={drawing} icon="arrow.triangle.branch" tintColor={palette.ink} accessibilityLabel="Connect cards" selected={!!connectFrom}
        onPress={() => { dismissKeyboard(); void flush(); setPickedConnector(null); setShowOutline(false); setShowTools(false); if (!wide) { setSelectedId(null); setCompactCanvas(true); } setConnectFrom(value => value ? null : 'pick'); }}>Connect cards</Stack.Toolbar.Button>
      <Stack.Toolbar.Button hidden={!drawing} icon="eraser" tintColor={palette.ink} accessibilityLabel="Erase ink" selected={mode === 'erase'} onPress={() => selectTool(mode === 'erase' ? 'draw' : 'erase')}>Erase ink</Stack.Toolbar.Button>
      <Stack.Toolbar.Button hidden={!drawing || window.fontScale > 1.2} icon="slider.horizontal.3" tintColor={palette.ink} accessibilityLabel="Pen settings" selected={showTools} onPress={() => { dismissKeyboard(); setShowTools(value => !value); }}>Pen settings</Stack.Toolbar.Button>
      <Stack.Toolbar.Spacer />
      <Stack.Toolbar.Button icon="arrow.uturn.backward" accessibilityLabel={`Undo ${activeActions.undoLabel || 'change'}`} disabled={!activeActions.undoCount || activeActions.pending > 0} onPress={() => { void undo(); }}>Undo</Stack.Toolbar.Button>
      <Stack.Toolbar.Button icon="arrow.uturn.forward" accessibilityLabel={`Redo ${activeActions.redoLabel || 'change'}`} disabled={!activeActions.redoCount || activeActions.pending > 0} onPress={() => { void redo(); }}>Redo</Stack.Toolbar.Button>
      <Stack.Toolbar.Spacer />
      {/* One Add button. Double-tapping empty canvas is the quick way to drop a note. */}
      <Stack.Toolbar.Menu hidden={drawing} icon="plus" accessibilityLabel="Add">
        <Stack.Toolbar.MenuAction icon="square.and.pencil" onPress={() => { void addCard(); }}>Note</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="plus.square.on.square" onPress={() => { void addCard('canvas'); }}>Space</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="checklist" onPress={() => { void addCard('checklist'); }}>Checklist</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="photo" disabled={importing} onPress={() => { void importImage(); }}>{importing ? 'Adding photo…' : 'Photo'}</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="mic" disabled={recording.isRecording || savingVoice} onPress={() => { void startVoiceNote(); }}>Voice note</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="mappin.and.ellipse" onPress={addPlace}>Place</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="link" onPress={addLink}>Link</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="doc.on.clipboard" onPress={() => { void pasteCard(); }}>Paste</Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
      <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
        <Stack.Toolbar.MenuAction icon="list.bullet.rectangle" onPress={toggleCardList}>{showOutline ? 'Hide card list' : 'Card list'}</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="magnifyingglass" onPress={findInSpace}>Search</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="person.2" onPress={() => { dismissKeyboard(); void flush(); router.push({ pathname: '/share/[id]', params: { id: result.workspace._id } }); }}>Share space</Stack.Toolbar.MenuAction>
        {contextCard && <Stack.Toolbar.Menu icon="rectangle" title="Selected card" accessibilityLabel="Selected card">
          <Stack.Toolbar.MenuAction icon="pencil" onPress={() => {
            if (activeInside) inspectInside(contextCard);
            else { setInspectorMode('write'); setLastInteractedCanvasId(canvasId); setCompactCanvas(false); setShowOutline(false); setShowTools(false); }
          }}>Edit</Stack.Toolbar.MenuAction>
          {contextCard.kind === 'canvas' && <Stack.Toolbar.MenuAction icon="square.stack" onPress={() => openCard(contextCard)}>Open space</Stack.Toolbar.MenuAction>}
          {!!contextCard.url && <Stack.Toolbar.MenuAction icon="safari" onPress={() => openLink(contextCard.url!)}>Open link</Stack.Toolbar.MenuAction>}
          <Stack.Toolbar.MenuAction icon="scope" onPress={() => camera('focus', contextCard._id)}>Show on canvas</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.Menu icon="arrow.up.and.down.and.arrow.left.and.right" title="Move card" accessibilityLabel="Move card" disabled={activeActions.pending > 0}>
            <Stack.Toolbar.MenuAction icon="arrow.left" onPress={() => { void nudge(-36, 0); }}>Move left</Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon="arrow.right" onPress={() => { void nudge(36, 0); }}>Move right</Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon="arrow.up" onPress={() => { void nudge(0, -36); }}>Move up</Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon="arrow.down" onPress={() => { void nudge(0, 36); }}>Move down</Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={() => deleteSelected()}>Delete card</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>}
        <Stack.Toolbar.MenuAction icon="arrow.up.left.and.arrow.down.right" onPress={() => camera('fit')}>Zoom to fit</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="square.and.arrow.up" disabled={sharing} onPress={shareCanvas}>{sharing ? 'Creating image…' : 'Share as image'}</Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="house" onPress={() => { dismissKeyboard(); void flush(); router.dismissTo('/'); }}>All spaces</Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  </>;
}
