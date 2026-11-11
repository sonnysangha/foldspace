import {
  Canvas,
  Circle,
  Fill,
  Group,
  Image as SkiaImage,
  ImageFormat,
  Line,
  Path,
  RoundedRect,
  Skia,
  Text as SkiaText,
  matchFont,
  useCanvasRef,
} from '@shopify/react-native-skia';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { TextInput, View, type LayoutChangeEvent } from 'react-native';
import {
  GestureDetector,
  useCompetingGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { Link } from 'expo-router';
import Animated, { Easing, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { paperColor, PreviewDrawing } from './canvas-preview';
import { useCachedImage } from '@/hooks/use-cached-image';
import { parseChecklist } from '@/utils/checklist';
import { sameData } from '@/utils/stable';
import { strokeGeometry } from '@/utils/stroke-geometry';
import { formatDuration, waveform } from '@/utils/waveform';

import { cardInk, lightPalette, spaceAccent, useTheme, type Palette } from '@/theme';
import type { CanvasCard, CanvasConnector, CanvasStroke, CanvasSurfaceProps, NewStroke, Viewport } from '@/types/canvas';
import {
  clampScale,
  connectorCurve,
  distanceToConnector,
  routeConnector,
  fitViewport,
  focusViewport,
  hitCard,
  hitStroke,
  keepCardVisible,
  resizeViewport,
  screenToWorld,
  serializeStroke,
  unionBounds,
  wrapCanvasText,
  nearBounds,
  type Bounds,
  type Point,
  type Size,
} from '@/utils/canvas-math';

/** The card under the finger: where it is now, and where it started (`ox`, `oy`). */
type DragState = { id: string | null; x: number; y: number; ox: number; oy: number };
const IDLE: DragState = { id: null, x: 0, y: 0, ox: 0, oy: 0 };
/** How far to the right of a selected card its connect dot sits, in screen points. */
const DOT_GAP = 20;
/** A saved line as the eraser sees it: its points, and the box round them for a quick first test. */
type StrokeTarget = { id: string; points: Point[]; width: number; bounds: Bounds | null };
type FontSet = ReturnType<typeof makeFonts>;
/**
 * What the gestures need to know about a card: where it is and whether it is a space.
 * Its text, picture and preview stay behind, so they are not copied across to the UI thread.
 */
type SceneCard = Pick<CanvasCard, '_id' | 'kind' | 'x' | 'y' | 'width' | 'height'>;

const NO_CONNECTORS: CanvasConnector[] = [];
const NO_IDS: string[] = [];
const GLIDE = { duration: 380, easing: Easing.bezier(0.77, 0, 0.175, 1) };

/** Height of one checklist row on a card. Tapping within a row's box ticks it. */
const CHECK_ROW = 26;

/**
 * Only a quick pinch out steps out one level: fingers brought together by at least
 * a fifth within this many milliseconds. A slower pinch is an ordinary zoom.
 */
const FLICK_MS = 350;
const FLICK_SCALE = 0.8;

/** The four typefaces are looked up once for the app, not once for every canvas that opens. */
let sharedFonts: FontSet | null = null;
function canvasFonts() {
  sharedFonts ??= makeFonts();
  return sharedFonts;
}

function makeFonts() {
  const fontFamily = process.env.EXPO_OS === 'ios' ? 'Helvetica Neue' : 'sans-serif';
  return {
    label: matchFont({ fontFamily, fontSize: 10, fontWeight: '600' }),
    title: matchFont({ fontFamily, fontSize: 19, fontWeight: '600' }),
    body: matchFont({ fontFamily, fontSize: 14, fontWeight: 'normal' }),
    footer: matchFont({ fontFamily, fontSize: 11, fontWeight: '500' }),
  };
}

/** The site name shown on a link card: the host without a leading "www.". */
function linkHost(url: string | undefined) {
  return url?.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0] ?? '';
}

/**
 * One card, drawn four ways. A note is a title and a description. A space is a title
 * over a live picture of the canvas inside it, on a stacked edge that says "step in".
 * An image shows its picture, and a link shows where it goes.
 */
const CardNode = memo(function CardNode({ card, selected, grouped, handles, editing, playing, drag, positions, group, view, fonts, palette }: {
  card: CanvasCard;
  /** The chrome's colours, for what is drawn around the card. What is on the card uses `cardInk`. */
  palette: Palette;
  selected: boolean;
  /** Part of a multi-selection. */
  grouped: boolean;
  /** Show the connect dot and resize grip. */
  handles: boolean;
  /** Its text is being typed in place, so the drawn text steps aside. */
  editing: boolean;
  playing: boolean;
  drag: SharedValue<DragState>;
  positions: SharedValue<Record<string, Point>>;
  group: SharedValue<string[]>;
  view: SharedValue<Viewport>;
  fonts: FontSet;
}) {
  const image = useCachedImage(card.kind === 'audio' ? null : card.kind === 'link' ? card.linkImage : card.imageUrl);
  // While a card is held it follows the finger. Once released it reads the position the
  // gesture left on the UI thread, so it cannot snap back for a frame while React catches up.
  // Only the id and position go into the worklet; the rest of the card has no business on the UI thread.
  const cardId = card._id, cardX = card.x, cardY = card.y;
  const transform = useDerivedValue(() => {
    const current = drag.get();
    if (current.id === cardId) return [{ translateX: current.x }, { translateY: current.y }];
    const placed = positions.get()[cardId];
    const x = placed ? placed.x : cardX, y = placed ? placed.y : cardY;
    // Cards selected together travel with the one being dragged.
    const members = group.get();
    const rides = current.id !== null && members.length > 1 && members.includes(cardId) && members.includes(current.id);
    return [{ translateX: x + (rides ? current.x - current.ox : 0) }, { translateY: y + (rides ? current.y - current.oy : 0) }];
  }, [cardId, cardX, cardY]);
  const isSpace = card.kind === 'canvas';
  const titleLines = useMemo(() => wrapCanvasText(card.title || 'Untitled',
    (text) => fonts.title.measureText(text).width, card.width - 36, isSpace || card.kind === 'link' ? 1 : 2), [card.kind, card.title, card.width, fonts, isSpace]);
  const titleTop = 35 + (card.kind === 'link' && card.linkImage ? Math.min(Math.round(card.height * 0.56), card.height - 96) : 0);
  const titleBottom = titleTop + (titleLines.length - 1) * 25;
  // A photo's description sits under it as a caption of up to two lines.
  const captionLines = useMemo(() => card.kind === 'image' && card.body ? wrapCanvasText(card.body,
    (text) => fonts.body.measureText(text).width, card.width - 36, 2) : [], [card.body, card.kind, card.width, fonts]);
  const captionHeight = captionLines.length ? captionLines.length * 20 + 6 : 0;
  // A link with a share picture shows it above its title, like a preview card.
  const banner = card.kind === 'link' && image ? Math.min(Math.round(card.height * 0.56), card.height - 96) : 0;
  const imageHeight = (card.kind === 'image' || card.kind === 'place') && image ? Math.max(0, card.height - titleBottom - 26 - captionHeight) : 0;
  const host = card.kind === 'link' ? linkHost(card.url) : '';
  const hostLine = useMemo(() => host ? wrapCanvasText(host, (text) => fonts.body.measureText(text).width, card.width - 36, 1)[0] ?? '' : '', [card.width, fonts, host]);
  const hostWidth = hostLine ? fonts.body.measureText(hostLine).width : 0;
  const bodyY = titleBottom + (hostLine ? 50 : 26);
  const previewY = titleBottom + 14;
  const previewHeight = card.height - previewY - 34;
  const hasPreview = isSpace && !!card.preview && (card.preview.cards.length > 0 || card.preview.strokes.length > 0);
  const isList = card.kind === 'checklist';
  const items = useMemo(() => isList ? parseChecklist(card.body).slice(0, Math.max(0, Math.floor((card.height - titleBottom - 22) / CHECK_ROW))).map(item => ({
    ...item, label: wrapCanvasText(item.text, (text) => fonts.body.measureText(text).width, card.width - 60, 1)[0] ?? '',
  })) : [], [card.body, card.height, card.width, fonts, isList, titleBottom]);
  const isVoice = card.kind === 'audio';
  const bars = useMemo(() => isVoice ? waveform(card._id, Math.max(8, Math.floor((card.width - 86) / 6))) : [], [card._id, card.width, isVoice]);
  const isPlace = card.kind === 'place';
  const bodyLines = useMemo(() => wrapCanvasText(card.body,
    (text) => fonts.body.measureText(text).width, card.width - 36,
    isSpace || isList || isVoice || isPlace || imageHeight > 0 ? 0 : Math.max(0, Math.floor((card.height - 18 - bodyY) / 20) + 1)), [bodyY, card.body, card.height, card.width, fonts, imageHeight, isList, isPlace, isSpace, isVoice]);
  const count = card.preview?.cardCount ?? 0;

  return (
    <Group transform={transform}>
      {/* A space has a second sheet peeking out below it, so its outline reaches round that too. */}
      {(selected || grouped) && <RoundedRect x={-4} y={-4} width={card.width + 8} height={card.height + 8 + (isSpace ? 8 : 0)}
        r={12} color={palette.ink} style="stroke" strokeWidth={2} />}
      {isSpace && <>
        <RoundedRect x={10} y={8} width={card.width - 20} height={card.height} r={9} color={lightPalette.surface} />
        <RoundedRect x={10} y={8} width={card.width - 20} height={card.height} r={9} color={palette.cardEdge} style="stroke" strokeWidth={1} />
      </>}
      {!isSpace && <RoundedRect x={1} y={3} width={card.width} height={card.height} r={9} color={palette.cardShadow} />}
      <RoundedRect x={0} y={0} width={card.width} height={card.height} r={9} color={paperColor(card.color)} />
      <RoundedRect x={0} y={0} width={card.width} height={card.height} r={9} color={palette.cardEdge} style="stroke" strokeWidth={1} />
      {banner > 0 && image && <Group clip={Skia.RRectXY(Skia.XYWHRect(0.5, 0.5, card.width - 1, banner), 9, 9)}>
        <SkiaImage image={image} x={0} y={0} width={card.width} height={banner + 10} fit="cover" />
      </Group>}
      {!editing && titleLines.map((line, index) => <SkiaText key={`title-${index}`} x={18} y={titleTop + index * 25}
        text={line} font={fonts.title} color={cardInk.ink} />)}
      {imageHeight > 0 && image && <Group clip={{ x: 12, y: titleBottom + 14, width: card.width - 24, height: imageHeight }}>
        <SkiaImage image={image} x={12} y={titleBottom + 14} width={card.width - 24} height={imageHeight} fit="cover" />
      </Group>}
      {imageHeight > 0 && captionLines.map((line, index) => <SkiaText key={`caption-${index}`} x={18} y={titleBottom + 14 + imageHeight + 20 + index * 20}
        text={line} font={fonts.body} color={cardInk.muted} />)}
      {isSpace && previewHeight > 24 && <Group transform={[{ translateX: 12 }, { translateY: previewY }]}>
        <RoundedRect x={0} y={0} width={card.width - 24} height={previewHeight} r={5} color={palette.canvas} />
        {hasPreview && card.preview && <PreviewDrawing preview={card.preview} palette={palette} width={card.width - 24} height={previewHeight} padding={8} />}
      </Group>}
      {!!hostLine && <>
        <SkiaText x={18} y={titleBottom + 24} text={hostLine} font={fonts.body} color={cardInk.muted} />
        <Line p1={{ x: 18, y: titleBottom + 28 }} p2={{ x: 18 + hostWidth, y: titleBottom + 28 }} color={cardInk.faint} strokeWidth={1} />
      </>}
      {!editing && bodyLines.map((line, index) => <SkiaText key={`body-${index}`} x={18} y={bodyY + index * 20}
        text={line} font={fonts.body} color={cardInk.muted} />)}
      {items.map((item, index) => {
        const y = titleBottom + 14 + index * CHECK_ROW;
        return <Group key={`item-${index}`}>
          <RoundedRect x={18} y={y} width={16} height={16} r={5} color={cardInk.ink} style={item.done ? 'fill' : 'stroke'} strokeWidth={1.4} />
          {item.done && <Path path={`M ${22} ${y + 8.5} L ${25} ${y + 11.5} L ${30.5} ${y + 5}`} color={cardInk.onInk} style="stroke" strokeWidth={1.8} strokeCap="round" strokeJoin="round" />}
          <SkiaText x={42} y={y + 13} text={item.label} font={fonts.body} color={item.done ? cardInk.faint : cardInk.ink} />
          {item.done && <Line p1={{ x: 42, y: y + 8.5 }} p2={{ x: 42 + fonts.body.measureText(item.label).width, y: y + 8.5 }} color={cardInk.faint} strokeWidth={1} />}
        </Group>;
      })}
      {isVoice && <Group transform={[{ translateY: titleBottom + 16 }]}>
        <Circle cx={36} cy={22} r={18} color={cardInk.ink} />
        {playing
          ? <><RoundedRect x={29} y={14} width={5} height={16} r={1.5} color={cardInk.onInk} /><RoundedRect x={38} y={14} width={5} height={16} r={1.5} color={cardInk.onInk} /></>
          : <Path path="M 31 13.5 L 31 30.5 L 45 22 Z" color={cardInk.onInk} />}
        {bars.map((level, index) => {
          const height = 6 + level * 32;
          return <RoundedRect key={index} x={66 + index * 6} y={22 - height / 2} width={3.5} height={height} r={1.75} color={cardInk.faint} />;
        })}
        <SkiaText x={18} y={62} text={formatDuration(card.duration ?? 0)} font={fonts.footer} color={cardInk.muted} />
      </Group>}
      {isPlace && imageHeight === 0 && <Group transform={[{ translateX: card.width / 2 }, { translateY: titleBottom + (card.height - titleBottom) / 2 - 6 }]}>
        <Circle cx={0} cy={-10} r={15} color={lightPalette.danger} />
        <Path path="M -9.5 0.5 L 0 18 L 9.5 0.5 Z" color={lightPalette.danger} />
        <Circle cx={0} cy={-10} r={5.5} color={cardInk.onInk} />
      </Group>}
      {handles && <CardHandles width={card.width} height={card.height} isSpace={isSpace} view={view} palette={palette} />}
      {isSpace && <SkiaText x={18} y={card.height - 13}
        text={count ? `${count} ${count === 1 ? 'card' : 'cards'}` : 'Empty'} font={fonts.footer} color={cardInk.muted} />}
    </Group>
  );
  // Every answer from the server is made of new objects. A card is drawn again only if what it holds has changed.
}, (before, after) => before.selected === after.selected && before.grouped === after.grouped && before.handles === after.handles
  && before.editing === after.editing && before.playing === after.playing && before.drag === after.drag && before.positions === after.positions
  && before.group === after.group && before.view === after.view && before.fonts === after.fonts && before.palette === after.palette
  && sameData(before.card, after.card));

/**
 * The connect dot and resize grip of the selected card. They follow the zoom on every frame,
 * so they are a component of their own: only the one card showing them pays for that.
 */
function CardHandles({ width, height, isSpace, view, palette }: { width: number; height: number; isSpace: boolean; view: SharedValue<Viewport>; palette: Palette }) {
  // Handles keep the same size on screen however far the canvas is zoomed.
  const dotX = useDerivedValue(() => width + DOT_GAP / view.get().scale, [width]);
  const dotR = useDerivedValue(() => 10 / view.get().scale);
  const gripR = useDerivedValue(() => 9 / view.get().scale);
  const pipR = useDerivedValue(() => 3.5 / view.get().scale);
  const hair = useDerivedValue(() => 2 / view.get().scale);
  return <>
    {/* Drag the dot to another card to connect them. */}
    <Circle cx={dotX} cy={height / 2} r={dotR} color={palette.paper} />
    <Circle cx={dotX} cy={height / 2} r={dotR} color={palette.ink} style="stroke" strokeWidth={hair} />
    <Circle cx={dotX} cy={height / 2} r={pipR} color={palette.ink} />
    {/* Drag the corner to resize. */}
    <Circle cx={width + 2} cy={height + 2 + (isSpace ? 8 : 0)} r={gripR} color={palette.ink} />
    <Circle cx={width + 2} cy={height + 2 + (isSpace ? 8 : 0)} r={pipR} color={palette.paper} />
  </>;
}

/**
 * A connector between two cards. Its path is worked out on the UI thread from the cards'
 * live positions, so it stays attached while either card is being dragged.
 */
const ConnectorNode = memo(function ConnectorNode({ fromId, fromX, fromY, fromWidth, fromHeight, toId, toX, toY, toWidth, toHeight, color, selected, bend, drag, positions, group, palette }: {
  /** Each end is given as its id and box alone, so a card's text changing does not redraw its connectors. */
  fromId: string; fromX: number; fromY: number; fromWidth: number; fromHeight: number;
  toId: string; toX: number; toY: number; toWidth: number; toHeight: number;
  color: string; palette: Palette; selected: boolean; bend: number;
  group: SharedValue<string[]>;
  drag: SharedValue<DragState>;
  positions: SharedValue<Record<string, Point>>;
}) {
  const path = useDerivedValue(() => {
    const held = drag.get(), placed = positions.get(), members = group.get();
    const at = (id: string, x: number, y: number) => {
      if (held.id === id) return { x: held.x, y: held.y };
      const spot = placed[id] ?? { x, y };
      const rides = held.id !== null && members.length > 1 && members.includes(id) && members.includes(held.id);
      return rides ? { x: spot.x + held.x - held.ox, y: spot.y + held.y - held.oy } : spot;
    };
    const a = at(fromId, fromX, fromY), b = at(toId, toX, toY);
    const curve = connectorCurve({ x: a.x, y: a.y, width: fromWidth, height: fromHeight }, { x: b.x, y: b.y, width: toWidth, height: toHeight }, bend);
    const builder = Skia.PathBuilder.Make();
    if (!curve) return builder.build();
    const angle = Math.atan2(curve.ey - curve.cy, curve.ex - curve.cx);
    return builder.moveTo(curve.sx, curve.sy).quadTo(curve.cx, curve.cy, curve.ex, curve.ey)
      .moveTo(curve.ex - Math.cos(angle + 0.45) * 13, curve.ey - Math.sin(angle + 0.45) * 13).lineTo(curve.ex, curve.ey)
      .lineTo(curve.ex - Math.cos(angle - 0.45) * 13, curve.ey - Math.sin(angle - 0.45) * 13).build();
  }, [bend, fromId, fromX, fromY, fromWidth, fromHeight, toId, toX, toY, toWidth, toHeight]);
  return <>
    {selected && <Path path={path} color={palette.line} style="stroke" strokeWidth={12} strokeCap="round" strokeJoin="round" />}
    <Path path={path} color={selected ? palette.ink : color} style="stroke" strokeWidth={selected ? 3.5 : 2.5} strokeCap="round" strokeJoin="round" />
  </>;
});

const StrokeNode = memo(function StrokeNode({ stroke, erasing, palette }: {
  stroke: CanvasStroke;
  palette: Palette;
  erasing: SharedValue<string[]>;
}) {
  const path = useMemo(() => Skia.Path.MakeFromSVGString(stroke.path), [stroke.path]);
  const opacity = useDerivedValue(() => erasing.get().includes(stroke._id) ? 0.18 : 1, [stroke._id]);
  if (!path) return null;
  // Ink drawn in the black pen follows the chrome's ink, so it still shows on a dark canvas.
  return <Path path={path} color={spaceAccent(stroke.color, palette)} strokeWidth={stroke.width}
    style="stroke" strokeCap="round" strokeJoin="round" opacity={opacity} />;
}, (before, after) => before.erasing === after.erasing && before.palette === after.palette && sameData(before.stroke, after.stroke));

type ZoomSource = { key: number; canvasId: string; left: number; top: number; width: number; height: number };

/** Invisible stand-in for a drawn card. The surrounding link hands it `onPress`, which the surface calls. */
function ZoomSourceView({ source, pressRef, onPress }: { source: ZoomSource; pressRef: RefObject<(() => void) | null>; onPress?: () => void }) {
  useEffect(() => {
    pressRef.current = onPress ?? null;
    return () => { pressRef.current = null; };
  }, [onPress, pressRef]);
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ position: 'absolute', left: source.left, top: source.top, width: source.width, height: source.height, borderRadius: 9 }} />;
}

/** The canvas as a PNG, or null if it could not be drawn or is no longer wanted. */
async function snapshotPng(canvas: ReturnType<typeof useCanvasRef>, wanted: () => boolean) {
  try {
    const image = await canvas.current?.makeImageSnapshotAsync();
    if (!wanted() || !image) return null;
    return image.encodeToBase64(ImageFormat.PNG, 100);
  } catch { return null; }
}

/** Everything the surface reports back to its parent. */
const HANDLERS = [
  'onCapture', 'onSelect', 'onDragSelect', 'onOpen', 'onMove', 'onStroke', 'onErase', 'onViewportChange', 'onCanvasPoint', 'onInteraction', 'onPinchOut',
  'onWillOpen', 'onToggleItem', 'onSelectConnector', 'onConnect', 'onResize', 'onCardMenu', 'onAddAt', 'onGroupSelect', 'onPlay', 'onLostContent',
] as const;
type HandlerName = (typeof HANDLERS)[number];
type AnyHandler = (...args: unknown[]) => void;

/**
 * A native drawing surface. Controls and accessible board navigation live in the parent screen.
 *
 * The parent re-renders for many reasons that do not concern the canvas, and passes new
 * functions each time. This shell hands the drawing below one unchanging function per
 * callback, each of which calls whatever the parent passed most recently, so the drawing
 * is only rendered again when what it shows has changed.
 */
export function CanvasSurface(props: CanvasSurfaceProps) {
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; });
  const [steady] = useState(() => ({
    handlers: Object.fromEntries(HANDLERS.map(name => [name, (...args: unknown[]) => (latest.current[name] as AnyHandler | undefined)?.(...args)])) as Record<HandlerName, AnyHandler>,
    onTitleChange: (value: string) => latest.current.editing?.onTitleChange(value),
    onBodyChange: (value: string) => latest.current.editing?.onBodyChange(value),
  }));
  // A callback the parent leaves out stays left out: some of them switch a behaviour on by being there.
  const handlers = Object.fromEntries(HANDLERS.filter(name => props[name]).map(name => [name, steady.handlers[name]])) as Pick<CanvasSurfaceProps, HandlerName>;
  const editingId = props.editing?.id, editingTitle = props.editing?.title, editingBody = props.editing?.body, selectAll = props.editing?.selectAll;
  const editing = useMemo(() => editingId === undefined ? undefined : {
    id: editingId, title: editingTitle ?? '', body: editingBody ?? '', selectAll, onTitleChange: steady.onTitleChange, onBodyChange: steady.onBodyChange,
  }, [editingId, editingTitle, editingBody, selectAll, steady]);
  return <CanvasDrawing {...props} {...handlers} editing={editing} />;
}

const CanvasDrawing = memo(function CanvasDrawing({
  cards, strokes, connectors = NO_CONNECTORS, connecting = false, mode, selectedId, color, strokeWidth, initialViewport, preferReadableStart = false, cameraAction, captureRequest = 0, onCapture,
  onSelect, onDragSelect, onOpen, onMove, onStroke, onErase, onViewportChange, onCanvasPoint, onInteraction, onPinchOut, onWillOpen, onToggleItem, selectedConnectorId, onSelectConnector,
  groupIds = NO_IDS, editing, playingId, onConnect, onResize, onCardMenu, onAddAt, onGroupSelect, onPlay, onLostContent,
}: CanvasSurfaceProps) {
  // The React Compiler lifts small inline functions out of this component, including ones inside
  // gesture worklets, and a lifted function is not a worklet: calling it on the UI thread crashes.
  // This component memoises by hand instead.
  'use no memo';
  const canvasRef = useCanvasRef();
  const { palette } = useTheme();
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [pendingStrokes, setPendingStrokes] = useState<CanvasStroke[]>([]);
  const [pendingErased, setPendingErased] = useState<string[]>([]);
  const [pendingPositions, setPendingPositions] = useState<Record<string, Point>>({});
  const initialView = useRef(initialViewport);
  const consumedCamera = useRef(0);
  const consumedCapture = useRef(0);
  const captureCallback = useRef(onCapture);
  useEffect(() => { captureCallback.current = onCapture; }, [onCapture]);
  const fonts = canvasFonts();
  const viewport = useSharedValue<Viewport>(initialViewport ?? { x: 36, y: 48, scale: 1 });
  const sceneSize = useSharedValue<Size>({ width: 0, height: 0 });
  const sceneCards = useSharedValue<SceneCard[]>([]);
  const positions = useSharedValue<Record<string, Point>>({});
  const strokeTargets = useSharedValue<StrokeTarget[]>([]);
  const drag = useSharedValue<DragState>(IDLE);
  const erasing = useSharedValue<string[]>([]);
  const activePath = useSharedValue(Skia.Path.Make());
  const activeBuilder = useSharedValue(Skia.PathBuilder.Make());
  const activePoints = useSharedValue<Point[]>([]);
  const gestureOrigin = useSharedValue({ point: { x: 0, y: 0 }, viewport: { x: 0, y: 0, scale: 1 } });
  const action = useSharedValue(0); // 0 idle, 1 pan, 2 drag, 3 draw, 4 erase
  const pinchActive = useSharedValue(false);
  const pinchUsed = useSharedValue(false);
  const pinchOrigin = useSharedValue({ anchor: { x: 0, y: 0 }, scale: 1 });
  const twoFingerOrigin = useSharedValue<Viewport>({ x: 0, y: 0, scale: 1 });
  const pinchStart = useSharedValue({ time: 0, gestureScale: 1, viewport: { x: 0, y: 0, scale: 1 } });
  const selectedShared = useSharedValue<string | null>(null);
  const group = useSharedValue<string[]>([]);
  useEffect(() => { selectedShared.set(mode === 'select' && !connecting ? selectedId : null); }, [connecting, mode, selectedId, selectedShared]);
  useEffect(() => { group.set(groupIds); }, [group, groupIds]);
  // Live feedback drawn while a finger is down: a connector being pulled out of a card,
  // the new outline of a card being resized, a selection box, and alignment guides.
  const wire = useSharedValue({ active: false, x1: 0, y1: 0, x2: 0, y2: 0 });
  const ghost = useSharedValue({ active: false, id: '', x: 0, y: 0, w: 0, h: 0, bw: 0, bh: 0 });
  const marquee = useSharedValue({ active: false, x1: 0, y1: 0, x2: 0, y2: 0 });
  const guides = useSharedValue({ v: Number.NaN, h: Number.NaN });
  const holdPoint = useSharedValue({ x: 0, y: 0 });
  const lastEmptyTap = useRef({ time: 0, x: 0, y: 0 });
  const lost = useRef(false);
  // The card being stepped into. Its on-screen frame is the source of the native zoom.
  const [zoomSource, setZoomSource] = useState<ZoomSource | null>(null);
  const pressZoomLink = useRef<(() => void) | null>(null);
  const bodyInput = useRef<ComponentRef<typeof TextInput>>(null);
  const [touchedId, setTouchedId] = useState<string | null>(null);
  const untouched = !!editing?.selectAll && touchedId !== editing.id;

  const displayStrokes = useMemo(() => {
    const persistedPaths = new Set(strokes.map((stroke) => stroke.path));
    return [...strokes, ...pendingStrokes.filter((stroke) => !persistedPaths.has(stroke.path))]
      .filter((stroke) => !pendingErased.includes(stroke._id));
  }, [strokes, pendingStrokes, pendingErased]);

  // Once the saved copies are rendered, the live line can go, unless a new one has begun.
  useEffect(() => {
    if (action.get() !== 3) activePath.set(Skia.Path.Make());
  }, [pendingStrokes, action, activePath]);

  const displayCards = useMemo(() => cards.map((card) => pendingPositions[card._id]
    ? { ...card, ...pendingPositions[card._id] } : card), [cards, pendingPositions]);

  useEffect(() => {
    sceneCards.set(displayCards.map(({ _id, kind, x, y, width, height }) => ({ _id, kind, x, y, width, height })));
    positions.set(Object.fromEntries(displayCards.map((card) => [card._id, { x: card.x, y: card.y }])));
    const current = drag.get();
    const committed = displayCards.find((card) => card._id === current.id);
    if (action.get() !== 2 && (!current.id || (committed?.x === current.x && committed?.y === current.y) || groupIds.includes(current.id))) {
      drag.set(IDLE);
    }
    // The resized card has been redrawn at its new size, so its outline can go.
    if (ghost.get().active && action.get() !== 6) ghost.set({ ...ghost.get(), active: false });
  }, [displayCards, sceneCards, positions, action, drag, ghost, groupIds]);

  const erasable = mode === 'erase';
  useEffect(() => {
    // Only the eraser looks at these, so every line's points are sent across to it only while it is the tool in hand.
    if (!erasable) { strokeTargets.set([]); return; }
    // A fresh line is visible immediately, but cannot be erased until it has a server id.
    strokeTargets.set(displayStrokes.filter((stroke) => !stroke._id.startsWith('pending-')).map((stroke) => {
      const { points, bounds } = strokeGeometry(stroke._id, stroke.path);
      return { id: stroke._id, width: stroke.width, points, bounds };
    }));
  }, [displayStrokes, erasable, strokeTargets]);

  // Optimistic state is dropped as soon as the server copy catches up. This is
  // derived from props, so it is adjusted while rendering rather than in an effect.
  const [syncedStrokes, setSyncedStrokes] = useState(strokes);
  if (syncedStrokes !== strokes) {
    setSyncedStrokes(strokes);
    setPendingStrokes((current) => {
      const next = current.filter((pending) => !strokes.some((stroke) => stroke.path === pending.path));
      return next.length === current.length ? current : next;
    });
    setPendingErased((current) => {
      const next = current.filter((id) => strokes.some((stroke) => stroke._id === id));
      return next.length === current.length ? current : next;
    });
  }

  const [syncedCards, setSyncedCards] = useState(cards);
  if (syncedCards !== cards) {
    setSyncedCards(cards);
    setPendingPositions((current) => {
      const next = { ...current };
      let changed = false;
      for (const id of Object.keys(current)) {
        const card = cards.find((item) => item._id === id);
        if (!card || (card.x === current[id].x && card.y === current[id].y)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }

  useEffect(() => {
    action.set(0);
    drag.set(IDLE);
    activePath.set(Skia.Path.Make());
    activePoints.set([]);
    erasing.set([]);
  }, [mode, action, drag, activePath, activePoints, erasing]);

  const bounds = useMemo(() => unionBounds([
    ...displayCards.map(({ x, y, width, height }) => ({ x, y, width, height })),
    ...displayStrokes.map((stroke) => strokeGeometry(stroke._id, stroke.path).bounds)
      .filter((bound): bound is NonNullable<typeof bound> => Boolean(bound)),
  ]), [displayCards, displayStrokes]);

  const notifyViewport = useCallback((next: Viewport) => {
    onViewportChange?.(next);
    const measured = sceneSize.get();
    if (measured.width && measured.height) onCanvasPoint?.((measured.width / 2 - next.x) / next.scale, (measured.height / 2 - next.y) / next.scale);
    if (measured.width && onLostContent) {
      // Nothing on screen but empty canvas: offer a way back.
      const left = -next.x / next.scale, top = -next.y / next.scale, right = left + measured.width / next.scale, bottom = top + measured.height / next.scale;
      const nowLost = cards.length > 0 && !cards.some(card => card.x < right && card.x + card.width > left && card.y < bottom && card.y + card.height > top);
      if (nowLost !== lost.current) { lost.current = nowLost; onLostContent(nowLost); }
    }
  }, [cards, onLostContent, onViewportChange, onCanvasPoint, sceneSize]);
  const selectById = useCallback((id: string) => {
    onInteraction?.();
    const card = cards.find((card) => card._id === id);
    if (card) onDragSelect?.(card);
  }, [cards, onDragSelect, onInteraction]);
  /**
   * Step into a card with the system zoom transition. Cards are drawn by Skia, so a
   * transparent view is laid over the card's frame to give the transition a source,
   * and the link around it is then followed.
   */
  const zoomInto = useCallback((card: CanvasCard) => {
    onWillOpen?.(card);
    if (process.env.EXPO_OS !== 'ios') { onOpen(card); return; }
    const current = viewport.get();
    setZoomSource({
      key: Date.now(), canvasId: card.childCanvasId,
      left: card.x * current.scale + current.x, top: card.y * current.scale + current.y,
      width: card.width * current.scale, height: card.height * current.scale,
    });
  }, [onOpen, onWillOpen, viewport]);
  useEffect(() => {
    if (!zoomSource) return;
    // Two frames: the source view has to be mounted and laid out before the push.
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => pressZoomLink.current?.()); });
    return () => cancelAnimationFrame(frame);
  }, [zoomSource]);
  // Each connector bows whichever way keeps it clear of the other cards.
  const bends = useMemo(() => Object.fromEntries(connectors.map(connector => {
    const from = displayCards.find(card => card._id === connector.fromCardId), to = displayCards.find(card => card._id === connector.toCardId);
    return [connector._id, from && to ? routeConnector(from, to, displayCards.filter(card => card !== from && card !== to)) : 0.14];
  })), [connectors, displayCards]);
  const zoomIntoById = useCallback((id: string) => { const card = cards.find(item => item._id === id); if (card) zoomInto(card); }, [cards, zoomInto]);
  const connectCards = useCallback((from: string, to: string) => onConnect?.(from, to), [onConnect]);
  const resizeCard = useCallback((id: string, width: number, height: number) => onResize?.(id, Math.round(width), Math.round(height)), [onResize]);
  const openMenu = useCallback((id: string, x: number, y: number) => { const card = cards.find(item => item._id === id); if (card) onCardMenu?.(card, { x, y }); }, [cards, onCardMenu]);
  const held = useCallback(() => { if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }, []);
  const reportGroup = useCallback((ids: string[]) => onGroupSelect?.(ids), [onGroupSelect]);
  const snapped = useCallback(() => { if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync(); }, []);
  const pinchOut = useCallback(() => onPinchOut?.(), [onPinchOut]);
  const canStepOut = !!onPinchOut;
  const tapAt = useCallback((id: string | null, point: Point) => {
    onInteraction?.();
    onCanvasPoint?.(point.x, point.y);
    const card = cards.find((item) => item._id === id) ?? null;
    // Selection may open an editor. A double tap has only the deeper navigation intent.
    // A space is a doorway: a tap steps inside. Every other card opens its editor and stays here.
    if (card?.kind === 'canvas' && !connecting) { zoomInto(card); return; }
    const titleRows = card ? wrapCanvasText(card.title || 'Untitled', (text) => fonts.title.measureText(text).width, card.width - 36, 2).length : 1;
    if (card?.kind === 'audio' && onPlay && !connecting && Math.hypot(point.x - card.x - 36, point.y - card.y - (35 + (titleRows - 1) * 25 + 38)) <= 24) { onPlay(card); return; }
    if (card?.kind === 'checklist' && onToggleItem && !connecting) {
      // A tap on a tick box ticks it without opening the card.
      const titleLines = wrapCanvasText(card.title || 'Untitled', (text) => fonts.title.measureText(text).width, card.width - 36, 2).length;
      const row = Math.floor((point.y - card.y - (35 + (titleLines - 1) * 25 + 9)) / CHECK_ROW);
      if (point.x - card.x <= 44 && row >= 0 && row < parseChecklist(card.body).length) { onToggleItem(card, row); return; }
    }
    if (!card && onSelectConnector && !connecting) {
      // A tap on empty canvas that lands on a connector selects it.
      const reach = 16 / viewport.get().scale;
      const hit = connectors.find(connector => {
        const from = displayCards.find(item => item._id === connector.fromCardId), to = displayCards.find(item => item._id === connector.toCardId);
        return from && to && distanceToConnector(point, from, to, bends[connector._id]) <= reach;
      });
      onSelectConnector(hit ?? null);
      if (hit) return;
    } else onSelectConnector?.(null);
    if (!card && onAddAt && !connecting) {
      // A second tap on the same empty spot adds a note there.
      const previous = lastEmptyTap.current, now = Date.now();
      if (now - previous.time < 340 && Math.hypot(point.x - previous.x, point.y - previous.y) < 34 / viewport.get().scale) { lastEmptyTap.current = { time: 0, x: 0, y: 0 }; onAddAt(point); return; }
      lastEmptyTap.current = { time: now, x: point.x, y: point.y };
    }
    onSelect(card);
  }, [bends, cards, connecting, connectors, displayCards, onAddAt, onPlay, onSelectConnector, viewport, fonts, onCanvasPoint, onSelect, onInteraction, onToggleItem, zoomInto]);
  const commitStroke = useCallback((stroke: NewStroke) => {
    onInteraction?.();
    setPendingStrokes((current) => [...current, {
      ...stroke, _id: `pending-${Date.now()}-${current.length}`, canvasId: cards[0]?.canvasId ?? '',
    }]);
    onStroke(stroke);
  }, [cards, onStroke, onInteraction]);
  const commitErase = useCallback((ids: string[]) => {
    onInteraction?.();
    const persisted = ids.filter((id) => !id.startsWith('pending-'));
    setPendingErased((current) => [...new Set([...current, ...persisted])]);
    setPendingStrokes((current) => current.filter((stroke) => !ids.includes(stroke._id)));
    if (persisted.length) onErase(persisted);
  }, [onErase, onInteraction]);
  const commitMove = useCallback((id: string, x: number, y: number, dx: number, dy: number) => {
    onInteraction?.();
    // Cards selected together are moved together, by the same amount.
    const moved = groupIds.length > 1 && groupIds.includes(id)
      ? displayCards.filter(card => groupIds.includes(card._id)).map(card => card._id === id ? { id, x, y } : { id: card._id, x: card.x + dx, y: card.y + dy })
      : [{ id, x, y }];
    setPendingPositions((current) => ({ ...current, ...Object.fromEntries(moved.map(item => [item.id, { x: item.x, y: item.y }])) }));
    for (const item of moved) onMove(item.id, item.x, item.y);
  }, [displayCards, groupIds, onMove, onInteraction]);
  const interact = useCallback(() => onInteraction?.(), [onInteraction]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const nextSize = { width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height };
    const previous = sceneSize.get();
    if (previous.width === nextSize.width && previous.height === nextSize.height) return;
    let next = previous.width > 0
      ? resizeViewport(viewport.get(), previous, nextSize)
      : initialView.current ?? fitViewport(bounds, nextSize);
    // A broad board fitted to a narrow phone makes every note too small to read.
    // Start near its first thought; Fit all ideas remains available in the toolbar.
    const first = cards[0];
    if (!previous.width && !initialView.current && preferReadableStart && nextSize.width < 620 && next.scale < 0.6 && first) {
      const scale = Math.min(1, (nextSize.width - 72) / first.width);
      next = { scale, x: (nextSize.width - first.width * scale) / 2 - first.x * scale, y: 72 - first.y * scale };
    }
    const focused = cards.find(card => card._id === selectedId);
    if (previous.width && focused && mode === 'select') next = keepCardVisible(next, focused, nextSize);
    viewport.set(next);
    sceneSize.set(nextSize);
    setSize(nextSize);
    notifyViewport(next);
  }, [bounds, cards, mode, notifyViewport, preferReadableStart, sceneSize, selectedId, viewport]);

  useEffect(() => {
    if (!cameraAction || consumedCamera.current === cameraAction.id || !size.width || !size.height) return;
    consumedCamera.current = cameraAction.id;
    const target = cards.find(card => card._id === (cameraAction.cardId ?? selectedId));
    const next = cameraAction.kind === 'focus' && target ? focusViewport(target, size) : fitViewport(bounds, size);
    viewport.set(withTiming(next, GLIDE)); notifyViewport(next);
  }, [cameraAction, size, cards, selectedId, bounds, viewport, notifyViewport]);

  useEffect(() => {
    if (!captureRequest || consumedCapture.current === captureRequest || !size.width || !size.height) return;
    let active = true;
    void (async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const png = await snapshotPng(canvasRef, () => active);
      if (active) { consumedCapture.current = captureRequest; captureCallback.current?.(png, captureRequest); }
    })();
    return () => { active = false; };
  }, [captureRequest, size.width, size.height, canvasRef]);

  const pan = usePanGesture({
    minPointers: 1,
    maxPointers: 1,
    minDistance: 5,
    onBegin(event) {
      pinchUsed.set(false);
      const current = viewport.get();
      gestureOrigin.set({ point: { x: event.x, y: event.y }, viewport: current });
    },
    onActivate() {
      // 7 to 9 belong to the hold gesture: a selection box, or a held card.
      if (pinchActive.get() || action.get() >= 7) return;
      scheduleOnRN(interact);
      const origin = gestureOrigin.get();
      const point = screenToWorld(origin.point, origin.viewport);
      if (mode === 'draw') {
        action.set(3);
        activePoints.set([point]);
        const builder = Skia.PathBuilder.Make().moveTo(point.x, point.y).lineTo(point.x + 0.01, point.y);
        activeBuilder.set(builder);
        activePath.set(builder.build());
      } else if (mode === 'erase') {
        action.set(4);
        erasing.set([]);
      } else {
        const chosen = sceneCards.get().find((item) => item._id === selectedShared.get());
        const reach = 26 / origin.viewport.scale;
        const gap = DOT_GAP / origin.viewport.scale;
        if (chosen && Math.hypot(point.x - (chosen.x + chosen.width + gap), point.y - (chosen.y + chosen.height / 2)) <= reach) {
          // Pulling a connector out of the selected card's dot.
          action.set(5);
          wire.set({ active: true, x1: chosen.x + chosen.width + gap, y1: chosen.y + chosen.height / 2, x2: point.x, y2: point.y });
          return;
        }
        if (chosen && Math.hypot(point.x - (chosen.x + chosen.width), point.y - (chosen.y + chosen.height)) <= reach) {
          // Dragging the selected card's corner to resize it.
          action.set(6);
          ghost.set({ active: true, id: chosen._id, x: chosen.x, y: chosen.y, w: chosen.width, h: chosen.height, bw: chosen.width, bh: chosen.height });
          return;
        }
        const id = hitCard(sceneCards.get(), point);
        const card = sceneCards.get().find((item) => item._id === id);
        if (card) {
          action.set(2);
          drag.set({ id: card._id, x: card.x, y: card.y, ox: card.x, oy: card.y });
          scheduleOnRN(selectById, card._id);
        } else {
          action.set(1);
        }
      }
    },
    onUpdate(event) {
      if (pinchActive.get() || event.numberOfPointers > 1 || action.get() >= 7) return;
      const currentAction = action.get();
      const origin = gestureOrigin.get();
      if (currentAction === 1) {
        viewport.set({ ...origin.viewport,
          x: origin.viewport.x + event.translationX,
          y: origin.viewport.y + event.translationY });
      } else if (currentAction === 2) {
        const current = drag.get();
        const all = sceneCards.get();
        const card = all.find((item) => item._id === current.id);
        if (card) {
          let x = card.x + event.translationX / origin.viewport.scale, y = card.y + event.translationY / origin.viewport.scale;
          // Snap to the edges and centres of the other cards, and show the line it snapped to.
          const near = 7 / origin.viewport.scale, members = group.get();
          let guideV = Number.NaN, guideH = Number.NaN, bestX = near, bestY = near;
          for (const other of all) {
            if (other._id === card._id || (members.includes(card._id) && members.includes(other._id))) continue;
            // Left edge, centre, right edge of the other card against the same three of this one; then top, middle, bottom.
            for (let theirEdge = 0; theirEdge < 3; theirEdge += 1) {
              const theirs = other.x + other.width * theirEdge / 2;
              for (let myEdge = 0; myEdge < 3; myEdge += 1) {
                const mine = card.width * myEdge / 2;
                const gap = Math.abs(x + mine - theirs);
                if (gap < bestX) { bestX = gap; guideV = theirs; x = theirs - mine; }
              }
            }
            for (let theirEdge = 0; theirEdge < 3; theirEdge += 1) {
              const theirs = other.y + other.height * theirEdge / 2;
              for (let myEdge = 0; myEdge < 3; myEdge += 1) {
                const mine = card.height * myEdge / 2;
                const gap = Math.abs(y + mine - theirs);
                if (gap < bestY) { bestY = gap; guideH = theirs; y = theirs - mine; }
              }
            }
          }
          const before = guides.get();
          if ((!Number.isNaN(guideV) && guideV !== before.v) || (!Number.isNaN(guideH) && guideH !== before.h)) scheduleOnRN(snapped);
          guides.set({ v: guideV, h: guideH });
          drag.set({ id: card._id, x, y, ox: current.ox, oy: current.oy });
        }
      } else if (currentAction === 5) {
        const point = screenToWorld({ x: event.x, y: event.y }, viewport.get());
        wire.set({ ...wire.get(), x2: point.x, y2: point.y });
      } else if (currentAction === 6) {
        const base = ghost.get();
        ghost.set({ ...base, w: Math.min(2000, Math.max(140, base.bw + event.translationX / origin.viewport.scale)), h: Math.min(2000, Math.max(90, base.bh + event.translationY / origin.viewport.scale)) });
      } else if (currentAction === 3) {
        const point = screenToWorld({ x: event.x, y: event.y }, viewport.get());
        const points = activePoints.get();
        const last = points[points.length - 1];
        if (!last || Math.hypot(last.x - point.x, last.y - point.y) >= 0.6 / viewport.get().scale) {
          activePoints.modify((samples) => {
            samples.push(point);
            return samples;
          });
          activePath.set(activeBuilder.get().lineTo(point.x, point.y).build());
        }
      } else if (currentAction === 4) {
        const point = screenToWorld({ x: event.x, y: event.y }, viewport.get());
        const current = erasing.get();
        const reach = 12 / viewport.get().scale;
        const hits = strokeTargets.get().filter((stroke) =>
          nearBounds(stroke.bounds, point, reach + stroke.width / 2) && !current.includes(stroke.id) && hitStroke(stroke.points, point, reach + stroke.width / 2));
        if (hits.length) erasing.set([...current, ...hits.map((stroke) => stroke.id)]);
      }
    },
    onDeactivate(event) {
      const currentAction = action.get();
      if (currentAction >= 7) return;
      let committed = false;
      if (!event.canceled) {
        if (currentAction === 2) {
          const current = drag.get();
          if (current.id) {
            // Keep hit testing aligned until the parent commits the new card coordinates.
            const id = current.id;
            const placed = { x: current.x, y: current.y };
            const dx = current.x - current.ox, dy = current.y - current.oy, members = group.get();
            const together = members.length > 1 && members.includes(id);
            const spot = (card: SceneCard) => card._id === id ? placed : together && members.includes(card._id) ? { x: card.x + dx, y: card.y + dy } : null;
            sceneCards.set(sceneCards.get().map((card) => { const next = spot(card); return next ? { ...card, ...next } : card; }));
            positions.modify((value) => { for (const card of sceneCards.get()) if (card._id === id || (together && members.includes(card._id))) value[card._id] = { x: card.x, y: card.y }; return value; });
            scheduleOnRN(commitMove, id, placed.x, placed.y, dx, dy);
          }
        } else if (currentAction === 3 && activePoints.get().length) {
          const path = serializeStroke(activePoints.get(), 7800, 0.45 / viewport.get().scale);
          if (path) { scheduleOnRN(commitStroke, { path, color, width: strokeWidth }); committed = true; }
        } else if (currentAction === 4) {
          scheduleOnRN(commitErase, erasing.get());
        } else if (currentAction === 5) {
          const line = wire.get(), from = selectedShared.get();
          const target = hitCard(sceneCards.get(), { x: line.x2, y: line.y2 });
          if (from && target && target !== from) scheduleOnRN(connectCards, from, target);
        } else if (currentAction === 6) {
          const box = ghost.get();
          if (box.w !== box.bw || box.h !== box.bh) scheduleOnRN(resizeCard, box.id, box.w, box.h);
          else ghost.set({ ...box, active: false });
        } else if (currentAction === 1) scheduleOnRN(notifyViewport, viewport.get());
      }
      wire.set({ ...wire.get(), active: false });
      guides.set({ v: Number.NaN, h: Number.NaN });
      if (event.canceled && currentAction === 6) ghost.set({ ...ghost.get(), active: false });
      // A finished line stays drawn until React shows its saved copy; clearing it here
      // would leave a frame or two with no line at all.
      action.set(0);
      if (currentAction !== 2 || event.canceled) drag.set(IDLE);
      if (!committed) activePath.set(Skia.Path.Make());
      activePoints.set([]);
      erasing.set([]);
    },
  });

  const pinch = usePinchGesture({
    onActivate(event) {
      scheduleOnRN(interact);
      const current = viewport.get();
      pinchActive.set(true);
      pinchUsed.set(true);
      action.set(0);
      drag.set(IDLE);
      activePath.set(Skia.Path.Make());
      activePoints.set([]);
      erasing.set([]);
      pinchOrigin.set({
        anchor: screenToWorld({ x: event.focalX, y: event.focalY }, current),
        scale: current.scale,
      });
      pinchStart.set({ time: Date.now(), gestureScale: 1, viewport: current });
    },
    onUpdate(event) {
      const origin = pinchOrigin.get();
      const scale = clampScale(origin.scale * event.scale);
      viewport.set({ x: event.focalX - origin.anchor.x * scale,
        y: event.focalY - origin.anchor.y * scale, scale });
      // The raw gesture scale, because the camera's own scale stops at its minimum.
      pinchStart.modify((value) => { value.gestureScale = event.scale; return value; });
    },
    onDeactivate() {
      pinchActive.set(false);
      const start = pinchStart.get();
      if (canStepOut && Date.now() - start.time <= FLICK_MS && start.gestureScale <= FLICK_SCALE) {
        // A flick out leaves this canvas. Put its camera back so it reopens as it was.
        viewport.set(start.viewport);
        scheduleOnRN(pinchOut);
        return;
      }
      if (mode === 'select' && Date.now() - start.time <= FLICK_MS + 120 && start.gestureScale >= 1.35) {
        // A quick pinch in on a space steps into it, the mirror of flicking out.
        const anchor = pinchOrigin.get().anchor;
        const id = hitCard(sceneCards.get(), anchor);
        if (id && sceneCards.get().find(card => card._id === id)?.kind === 'canvas') {
          viewport.set(start.viewport);
          scheduleOnRN(zoomIntoById, id);
          return;
        }
      }
      const current = viewport.get();
      scheduleOnRN(notifyViewport, current);
    },
  });

  // Holding still: on a card it opens that card's menu; on empty canvas it starts a selection box.
  const hold = usePanGesture({
    enabled: mode === 'select' && !connecting,
    maxPointers: 1,
    activateAfterLongPress: 380,
    onActivate(event) {
      // A drag, pan or pinch that is already under way keeps the touch.
      if (action.get() !== 0 || pinchActive.get()) return;
      const point = screenToWorld({ x: event.x, y: event.y }, viewport.get());
      const id = hitCard(sceneCards.get(), point);
      if (id) {
        // A buzz says the card is held. Letting go opens its menu; moving drags it instead.
        const card = sceneCards.get().find(item => item._id === id);
        if (card) { action.set(8); drag.set({ id, x: card.x, y: card.y, ox: card.x, oy: card.y }); holdPoint.set({ x: event.x, y: event.y }); scheduleOnRN(held); }
        return;
      }
      action.set(7);
      marquee.set({ active: true, x1: point.x, y1: point.y, x2: point.x, y2: point.y });
      scheduleOnRN(snapped);
    },
    onUpdate(event) {
      if (action.get() === 8 || action.get() === 9) {
        const moved = Math.hypot(event.translationX, event.translationY);
        if (action.get() === 8 && moved > 10) action.set(9);
        if (action.get() === 9) {
          const held = drag.get(), scale = viewport.get().scale;
          drag.set({ ...held, x: held.ox + event.translationX / scale, y: held.oy + event.translationY / scale });
        }
        return;
      }
      if (action.get() !== 7) return;
      const point = screenToWorld({ x: event.x, y: event.y }, viewport.get());
      marquee.set({ ...marquee.get(), x2: point.x, y2: point.y });
    },
    onDeactivate() {
      if (action.get() === 8 || action.get() === 9) {
        const held = drag.get();
        if (action.get() === 9 && held.id) {
          const id = held.id, placed = { x: held.x, y: held.y };
          sceneCards.set(sceneCards.get().map((card) => card._id === id ? { ...card, ...placed } : card));
          positions.modify((value) => { value[id] = placed; return value; });
          scheduleOnRN(commitMove, id, placed.x, placed.y, held.x - held.ox, held.y - held.oy);
        } else {
          if (held.id) scheduleOnRN(openMenu, held.id, holdPoint.get().x, holdPoint.get().y);
          drag.set(IDLE);
        }
        action.set(0);
        return;
      }
      if (action.get() !== 7) return;
      const box = marquee.get();
      const left = Math.min(box.x1, box.x2), right = Math.max(box.x1, box.x2), top = Math.min(box.y1, box.y2), bottom = Math.max(box.y1, box.y2);
      scheduleOnRN(reportGroup, sceneCards.get().filter(card => card.x < right && card.x + card.width > left && card.y < bottom && card.y + card.height > top).map(card => card._id));
      marquee.set({ ...box, active: false });
      action.set(0);
    },
  });

  const twoFingerPan = usePanGesture({
    minPointers: 2,
    maxPointers: 2,
    averageTouches: true,
    onBegin() {
      pinchUsed.set(false);
    },
    onActivate(event) {
      scheduleOnRN(interact);
      const current = viewport.get();
      twoFingerOrigin.set({ ...current,
        x: current.x - event.translationX, y: current.y - event.translationY });
    },
    onUpdate(event) {
      // Pinch also follows the moving centroid. Never apply its translation twice.
      if (!pinchActive.get() && !pinchUsed.get()) {
        const origin = twoFingerOrigin.get();
        viewport.set({ ...origin, x: origin.x + event.translationX, y: origin.y + event.translationY });
      }
    },
    onDeactivate() {
      if (!pinchActive.get()) scheduleOnRN(notifyViewport, viewport.get());
    },
  });

  const singleTap = useTapGesture({
    maxDistance: 5,
    onActivate(event) {
      if (pinchActive.get() || pinchUsed.get()) return;
      const point = screenToWorld({ x: event.x, y: event.y }, viewport.get());
      if (mode === 'draw') {
        scheduleOnRN(commitStroke, { path: serializeStroke([point]), color, width: strokeWidth });
      } else if (mode === 'erase') {
        const reach = 12 / viewport.get().scale;
        const hits = strokeTargets.get().filter((stroke) =>
          nearBounds(stroke.bounds, point, reach + stroke.width / 2) && hitStroke(stroke.points, point, reach + stroke.width / 2));
        scheduleOnRN(commitErase, hits.map((stroke) => stroke.id));
      } else scheduleOnRN(tapAt, hitCard(sceneCards.get(), point), point);
    },
  });

  const singlePointer = useCompetingGestures(pan, hold, singleTap);
  const gestures = useSimultaneousGestures(singlePointer, pinch, twoFingerPan);
  const worldTransform = useDerivedValue(() => {
    const current = viewport.get();
    return [{ translateX: current.x }, { translateY: current.y }, { scale: current.scale }];
  });
  // The dots are laid out once for a given spacing and surface size, starting at the corner
  // with a spare row and column, and then slid into place. Moving the canvas only changes
  // the slide; the dots are laid out again when zooming changes how far apart they sit.
  const gridPath = useSharedValue(Skia.Path.Make());
  useAnimatedReaction(() => {
    const measured = sceneSize.get();
    return { spacing: Math.max(20, 40 * viewport.get().scale), width: measured.width, height: measured.height };
  }, (grid, previous) => {
    if (previous && previous.spacing === grid.spacing && previous.width === grid.width && previous.height === grid.height) return;
    const path = Skia.PathBuilder.Make();
    for (let x = 0; x < grid.width + grid.spacing; x += grid.spacing) {
      for (let y = 0; y < grid.height + grid.spacing; y += grid.spacing) path.moveTo(x, y).lineTo(x + 0.1, y);
    }
    gridPath.set(path.build());
  });
  const gridTransform = useDerivedValue(() => {
    const current = viewport.get();
    const spacing = Math.max(20, 40 * current.scale);
    // One step back, so the spare row and column cover the edge the dots slide in from.
    return [{ translateX: ((current.x % spacing) + spacing) % spacing - spacing }, { translateY: ((current.y % spacing) + spacing) % spacing - spacing }];
  });

  const wirePath = useDerivedValue(() => {
    const line = wire.get(), builder = Skia.PathBuilder.Make();
    return line.active ? builder.moveTo(line.x1, line.y1).lineTo(line.x2, line.y2).build() : builder.build();
  });
  const boxPath = useDerivedValue(() => {
    const resize = ghost.get(), select = marquee.get(), builder = Skia.PathBuilder.Make();
    const rect = (x: number, y: number, w: number, h: number) => builder.moveTo(x, y).lineTo(x + w, y).lineTo(x + w, y + h).lineTo(x, y + h).lineTo(x, y);
    if (resize.active) rect(resize.x, resize.y, resize.w, resize.h);
    if (select.active) rect(Math.min(select.x1, select.x2), Math.min(select.y1, select.y2), Math.abs(select.x2 - select.x1), Math.abs(select.y2 - select.y1));
    return builder.build();
  });
  const guidePath = useDerivedValue(() => {
    const lines = guides.get(), builder = Skia.PathBuilder.Make();
    if (!Number.isNaN(lines.v)) builder.moveTo(lines.v, -100000).lineTo(lines.v, 100000);
    if (!Number.isNaN(lines.h)) builder.moveTo(-100000, lines.h).lineTo(100000, lines.h);
    return builder.build();
  });
  const hairline = useDerivedValue(() => 1.5 / viewport.get().scale);
  const wireWidth = useDerivedValue(() => 2.5 / viewport.get().scale);

  // Typing in place: a text field laid exactly over the card, moving and scaling with the canvas.
  const editingCard = editing ? displayCards.find(card => card._id === editing.id) : undefined;
  const editingId = editingCard?._id ?? '', editingX = editingCard?.x ?? 0, editingY = editingCard?.y ?? 0;
  const editorStyle = useAnimatedStyle(() => {
    const view = viewport.get(), spot = positions.get()[editingId] ?? { x: editingX, y: editingY };
    return { transform: [{ translateX: view.x + spot.x * view.scale }, { translateY: view.y + spot.y * view.scale }, { scale: view.scale }] };
  });
  const editingWidth = editingCard?.width ?? 0;
  // Where the card being typed on sits now. Kept to one side so the camera below moves
  // only when editing starts; the card may be moved afterwards without the camera chasing it.
  const editingBox = useRef({ x: editingX, y: editingY, width: editingWidth });
  useEffect(() => { editingBox.current = { x: editingX, y: editingY, width: editingWidth }; }, [editingX, editingY, editingWidth]);
  useEffect(() => {
    if (!editingId || !size.width) return;
    const box = editingBox.current;
    // Bring the card to the top of the screen, at a readable size, clear of the keyboard.
    const scale = Math.min(1.4, Math.max(viewport.get().scale, Math.min(1, (size.width - 48) / box.width)));
    const next = { scale, x: (size.width - box.width * scale) / 2 - box.x * scale, y: 110 - box.y * scale };
    viewport.set(withTiming(next, GLIDE));
  }, [editingId, size.width, viewport]);

  return (
    <GestureDetector gesture={gestures}>
      <View collapsable={false} onLayout={onLayout} style={{ flex: 1, overflow: 'hidden', backgroundColor: palette.canvas }}
        accessible accessibilityLabel="Canvas. Use the card list to read and open cards."
        accessibilityHint="Drag to move around. Pinch to zoom. Select a drawing tool to sketch."
        testID="canvas-surface">
        <Canvas ref={canvasRef} style={{ flex: 1 }} opaque>
          <Fill color={palette.canvas} />
          <Group transform={gridTransform}>
            <Path path={gridPath} style="stroke" strokeWidth={1.5} strokeCap="round" color={palette.canvasDot} />
          </Group>
          <Group transform={worldTransform}>
            {connectors.map((connector) => {
              const from = displayCards.find(card => card._id === connector.fromCardId), to = displayCards.find(card => card._id === connector.toCardId);
              return from && to ? <ConnectorNode key={connector._id} fromId={from._id} fromX={from.x} fromY={from.y} fromWidth={from.width} fromHeight={from.height}
                toId={to._id} toX={to.x} toY={to.y} toWidth={to.width} toHeight={to.height} bend={bends[connector._id] ?? 0.14} color={spaceAccent(connector.color ?? palette.muted, palette)} palette={palette} selected={connector._id === selectedConnectorId} drag={drag} positions={positions} group={group} /> : null;
            })}
            {displayCards.map((card) => <CardNode key={card._id} card={card} selected={card._id === selectedId} grouped={groupIds.includes(card._id)}
              handles={card._id === selectedId && mode === 'select' && !connecting && !editing && groupIds.length === 0} editing={editing?.id === card._id} playing={playingId === card._id}
              drag={drag} positions={positions} group={group} view={viewport} fonts={fonts} palette={palette} />)}
            {displayStrokes.map((stroke) => <StrokeNode key={stroke._id} stroke={stroke} erasing={erasing} palette={palette} />)}
            <Path path={activePath} style="stroke" strokeWidth={strokeWidth}
              color={spaceAccent(color, palette)} strokeCap="round" strokeJoin="round" />
            <Path path={guidePath} style="stroke" strokeWidth={hairline} color={palette.danger} />
            <Path path={wirePath} style="stroke" strokeWidth={wireWidth} strokeCap="round" color={palette.ink} />
            <Path path={boxPath} style="stroke" strokeWidth={hairline} color={palette.ink} />
          </Group>
        </Canvas>
        {editing && editingCard && <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: editingCard.width, height: editingCard.height, transformOrigin: 'top left' }, editorStyle]}>
          <TextInput autoFocus value={untouched ? '' : editing.title} placeholder={untouched ? editing.title : 'Title'} placeholderTextColor={cardInk.faint}
            // A new note shows its stand-in title as a placeholder, so the first keystroke replaces it.
            onChangeText={value => { setTouchedId(editing.id); editing.onTitleChange(value); }}
            accessibilityLabel="Card title" testID="inline-title" maxLength={160} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => bodyInput.current?.focus()}
            style={{ position: 'absolute', left: 18, right: 18, top: 13, height: 28, padding: 0, fontFamily: 'Helvetica Neue', fontSize: 19, fontWeight: '600', color: cardInk.ink }} />
          <TextInput ref={bodyInput} value={editing.body} onChangeText={editing.onBodyChange} placeholder="Write something" placeholderTextColor={cardInk.faint}
            accessibilityLabel="Card description" testID="inline-body" multiline maxLength={8000} scrollEnabled={false}
            style={{ position: 'absolute', left: 18, right: 18, top: 46, bottom: 10, padding: 0, fontFamily: 'Helvetica Neue', fontSize: 14, lineHeight: 20, color: cardInk.muted, textAlignVertical: 'top' }} />
        </Animated.View>}
        {zoomSource && <Link key={zoomSource.key} href={{ pathname: '/canvas/[id]', params: { id: zoomSource.canvasId } }} asChild>
          <Link.AppleZoom>
            <ZoomSourceView source={zoomSource} pressRef={pressZoomLink} />
          </Link.AppleZoom>
        </Link>}
      </View>
    </GestureDetector>
  );
});

export default CanvasSurface;
