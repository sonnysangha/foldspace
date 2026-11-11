import { useUser } from '@clerk/expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from 'convex/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { useCanvasActions } from '@/hooks/use-canvas-actions';
import { spacing, useTheme } from '@/theme';
import type { CameraAction, CanvasCard, CanvasMode, Viewport } from '@/types/canvas';
import { clampScale } from '@/utils/canvas-math';
import { CanvasSurface } from './canvas-surface';

export type NestedCanvasPaneProps = {
  canvasId: Id<'canvases'>; mode: CanvasMode; color: string; strokeWidth: number;
  selectedId: string | null;
  cameraAction?: CameraAction; captureRequest?: number;
  onCapture: (image: string | null, requestId: number) => void;
  onInteraction: () => void;
  onSelectCard: (card: CanvasCard | null) => void;
  onInspectCard: (card: CanvasCard) => void;
  onOpenCard: (card: CanvasCard) => void;
  onExpand: () => void; onAdd: () => void;
  onCardsChange: (cards: CanvasCard[]) => void;
  onCanvasPoint: (x: number, y: number) => void;
  onError: (message: string) => void;
};

/** A camera read back from storage, or nothing if it is missing or malformed. A bad one cannot block the document. */
function savedCamera(value: string | null): Viewport | undefined {
  try {
    const saved = value ? JSON.parse(value) as Viewport : null;
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && Number.isFinite(saved.scale) && saved.scale > 0) return { ...saved, scale: clampScale(saved.scale) };
  } catch { /* Fall through to no camera. */ }
  return undefined;
}

/** The actual child document: camera, mutations and history all belong to its canvas ID. */
function NestedCanvasDocument(props: NestedCanvasPaneProps) {
  const { canvasId, mode, color, strokeWidth, onOpenCard, onExpand, onError } = props;
  const { palette } = useTheme();
  const result = useQuery(api.canvases.cards, { canvasId });
  const ink = useQuery(api.canvases.strokes, { canvasId });
  const actions = useCanvasActions(canvasId);
  const { user } = useUser();
  const storageKey = `foldspace:camera:${user?.id ?? 'signed-out'}:${canvasId}`;
  const [camera, setCamera] = useState<{ key: string; viewport?: Viewport } | null>(null);
  const [epoch, setEpoch] = useState(0);
  const callbacks = useRef(props);
  useEffect(() => { callbacks.current = props; }, [props]);
  const pendingCamera = useRef<{ key: string; viewport: Viewport } | null>(null);
  // Where the camera is now. Only read when the surface has to be rebuilt, so moving it renders nothing.
  const latestCamera = useRef<{ key: string; viewport: Viewport } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistCamera = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const pending = pendingCamera.current;
    pendingCamera.current = null;
    if (pending) void AsyncStorage.setItem(pending.key, JSON.stringify(pending.viewport)).catch(() => {});
  }, []);
  useEffect(() => { if (result) callbacks.current.onCardsChange(result.cards); }, [result]);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(storageKey).then(value => {
      if (!active) return;
      setCamera({ key: storageKey, viewport: savedCamera(value) });
    }).catch(() => { if (active) setCamera({ key: storageKey }); });
    return () => { active = false; persistCamera(); };
  }, [storageKey, persistCamera]);
  const saveCamera = (viewport: Viewport) => {
    latestCamera.current = { key: storageKey, viewport };
    pendingCamera.current = { key: storageKey, viewport };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persistCamera, 180);
  };
  const attempt = async (operation: () => Promise<unknown>, message: string) => {
    try { await operation(); } catch {
      // The surface is rebuilt after a failure; it starts again from where the camera was.
      const camera = latestCamera.current;
      if (camera?.key === storageKey) setCamera(camera);
      setEpoch(value => value + 1); onError(message);
    }
  };
  if (!result || ink === undefined || camera?.key !== storageKey) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator color={palette.muted} accessibilityLabel="Opening the canvas inside" /></View>;
  return <View style={{ flex: 1, minHeight: 0, minWidth: 0, backgroundColor: palette.paper }}>
    <View style={[styles.header, { backgroundColor: palette.paper, borderBottomColor: palette.line }]}>
      <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: palette.muted }]}>
        {result.canvas.title} · {mode === 'draw' ? 'drawing' : mode === 'erase' ? 'erasing' : `${result.cards.length} ${result.cards.length === 1 ? 'card' : 'cards'}`}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Add a card inside this canvas"
        testID="add-inside-card" onPress={props.onAdd}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
        <Text style={[styles.actionLabel, { color: palette.ink }]}>Add</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Open this canvas full screen"
        testID="expand-inside-canvas" onPress={() => { persistCamera(); onExpand(); }}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
        <Text style={[styles.actionLabel, { color: palette.ink }]}>Open</Text>
      </Pressable>
    </View>
    <View style={{ flex: 1, minHeight: 0 }}>
      <CanvasSurface key={`${canvasId}:${epoch}`} cards={result.cards} strokes={ink} connectors={result.connectors} mode={mode} color={color} strokeWidth={strokeWidth} selectedId={props.selectedId} initialViewport={camera.viewport}
        cameraAction={props.cameraAction} captureRequest={props.captureRequest} onCapture={props.onCapture} onInteraction={props.onInteraction}
        onSelect={card => { props.onSelectCard(card); if (card) props.onInspectCard(card); }}
        onDragSelect={props.onSelectCard} onOpen={onOpenCard}
        onMove={(id, x, y) => { void attempt(() => actions.edit(id, { x, y }), 'Could not move this inside card.'); }}
        onStroke={stroke => { void attempt(() => actions.draw(stroke), 'Could not save this stroke. Please draw it again.'); }}
        onErase={ids => { void attempt(() => actions.erase(ids), 'Could not erase this ink.'); }} onViewportChange={saveCamera} onCanvasPoint={props.onCanvasPoint} />
      {!result.cards.length && !ink.length && <View pointerEvents="none" style={styles.empty}>
        <Text style={[styles.emptyBody, { color: palette.muted }]}>Nothing inside yet. Draw here, or tap Add.</Text>
      </View>}
    </View>
  </View>;
}
export function NestedCanvasPane(props: NestedCanvasPaneProps) { return <NestedCanvasDocument key={props.canvasId} {...props} />; }

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingLeft: spacing.lg, paddingRight: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, minWidth: 0, fontSize: 13 },
  action: { minHeight: 44, minWidth: 44, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.55 },
  empty: { position: 'absolute', inset: 0, padding: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  emptyBody: { fontSize: 15, textAlign: 'center' },
});
