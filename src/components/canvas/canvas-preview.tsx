import { Canvas, Fill, Group, Image as SkiaImage, Line, Path, RoundedRect, Skia, Text as SkiaText, matchFont } from '@shopify/react-native-skia';
import { memo, useMemo, useState } from 'react';
import { View } from 'react-native';

import type { CanvasPreview } from '@/types/canvas';
import { boundsOfPoints, pathToPoints, unionBounds, wrapCanvasText } from '@/utils/canvas-math';

import { useCachedImage } from '@/hooks/use-cached-image';
import { cardInk, spaceAccent, useTheme, type Palette } from '@/theme';
import { paperColor } from '@/utils/paper-color';
export { paperColor } from '@/utils/paper-color';

type PreviewFont = ReturnType<typeof matchFont>;

/** One card in a thumbnail: its paper and title, then its photo, or faint lines standing in for text. */
const PreviewCard = memo(function PreviewCard({ card, font, palette }: { card: CanvasPreview['cards'][number]; font: PreviewFont; palette: Palette }) {
  const image = useCachedImage(card.imageUrl);
  const lines = wrapCanvasText(card.title, text => font.measureText(text).width, card.width - 28, card.imageUrl ? 1 : 2);
  const top = 30 + lines.length * 23 - 9;
  const photoHeight = card.height - top - 12;
  return <Group transform={[{ translateX: card.x }, { translateY: card.y }]}>
    <RoundedRect x={0} y={0} width={card.width} height={card.height} r={7} color={paperColor(card.color)} />
    <RoundedRect x={0} y={0} width={card.width} height={card.height} r={7} color={palette.cardEdge} style="stroke" strokeWidth={1.5} />
    {lines.map((line, i) => <SkiaText key={i} x={14} y={30 + i * 23} text={line} font={font} color={cardInk.ink} />)}
    {image && photoHeight > 20
      ? <Group clip={{ x: 12, y: top, width: card.width - 24, height: photoHeight }}>
          <SkiaImage image={image} x={12} y={top} width={card.width - 24} height={photoHeight} fit="cover" />
        </Group>
      : !!card.body && [0, 1, 2].map(i => <Line key={i} p1={{ x: 15, y: 57 + lines.length * 15 + i * 13 }} p2={{ x: card.width - (i === 2 ? 68 : 22), y: 57 + lines.length * 15 + i * 13 }} color={cardInk.line} strokeWidth={3} />)}
    {card.kind === 'canvas' && <RoundedRect x={card.width - 28} y={card.height - 25} width={14} height={11} r={2} color={cardInk.faint} style="stroke" strokeWidth={1.6} />}
  </Group>;
});

/** A noninteractive, bounded view of actual saved content, shared by covers and board cards. */
export const PreviewDrawing = memo(function PreviewDrawing({ preview, palette, width, height, padding = 14 }: {
  preview: CanvasPreview; palette: Palette; width: number; height: number; padding?: number;
}) {
  const font = useMemo(() => matchFont({ fontFamily: process.env.EXPO_OS === 'ios' ? 'Helvetica Neue' : 'sans-serif', fontSize: 18, fontWeight: '500' }), []);
  const paths = useMemo(() => preview.strokes.map(stroke => ({ ...stroke, skPath: Skia.Path.MakeFromSVGString(stroke.path) })), [preview.strokes]);
  const bounds = useMemo(() => unionBounds([
    ...preview.cards.map(({ x, y, width, height }) => ({ x, y, width, height })),
    ...preview.strokes.map(stroke => boundsOfPoints(pathToPoints(stroke.path))).filter(bound => bound !== null),
  ]), [preview]);
  if (!bounds || width <= 0 || height <= 0) return null;
  const scale = Math.min((width - padding * 2) / Math.max(1, bounds.width), (height - padding * 2) / Math.max(1, bounds.height), 1);
  const x = (width - bounds.width * scale) / 2 - bounds.x * scale;
  const y = (height - bounds.height * scale) / 2 - bounds.y * scale;
  return <Group clip={{ x: 0, y: 0, width, height }}>
    <Group transform={[{ translateX: x }, { translateY: y }, { scale }]}>
      {preview.cards.map(card => <PreviewCard key={card._id} card={card} font={font} palette={palette} />)}
      {paths.map((stroke, i) => stroke.skPath && <Path key={i} path={stroke.skPath} color={spaceAccent(stroke.color, palette)} strokeWidth={stroke.width} style="stroke" strokeCap="round" strokeJoin="round" />)}
    </Group>
  </Group>;
});

export function CanvasPreviewCover({ preview, background, padding = 24 }: { preview: CanvasPreview; background?: string; padding?: number }) {
  const { palette } = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  return <View pointerEvents="none" onLayout={event => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })} style={{ flex: 1 }}>
    <Canvas style={{ flex: 1 }} opaque>
      <Fill color={background ?? palette.canvas} />
      <PreviewDrawing preview={preview} palette={palette} width={size.width} height={size.height} padding={padding} />
    </Canvas>
  </View>;
}
