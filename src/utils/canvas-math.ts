import type { Viewport } from '../types/canvas';

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Bounds = { x: number; y: number; width: number; height: number };

export const MIN_CANVAS_SCALE = 0.2;
export const MAX_CANVAS_SCALE = 4;

export function clampScale(scale: number) {
  'worklet';
  return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, scale));
}

export function screenToWorld(point: Point, viewport: Viewport): Point {
  'worklet';
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

export function worldToScreen(point: Point, viewport: Viewport): Point {
  'worklet';
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  };
}

/** Keep the same document point under the user's fingers while zooming. */
export function zoomAtPoint(viewport: Viewport, focal: Point, scale: number): Viewport {
  'worklet';
  const anchor = screenToWorld(focal, viewport);
  const nextScale = clampScale(scale);
  return {
    x: focal.x - anchor.x * nextScale,
    y: focal.y - anchor.y * nextScale,
    scale: nextScale,
  };
}

export function resizeViewport(viewport: Viewport, before: Size, after: Size): Viewport {
  'worklet';
  if (before.width <= 0 || before.height <= 0) return viewport;
  return {
    ...viewport,
    x: viewport.x + (after.width - before.width) / 2,
    y: viewport.y + (after.height - before.height) / 2,
  };
}

export function focusViewport(card: Bounds, size: Size, preferredScale = 1): Viewport {
  const scale = clampScale(Math.min(preferredScale, Math.max(1, size.width - 48) / card.width, Math.max(1, size.height - 64) / card.height));
  return { scale, x: (size.width - card.width * scale) / 2 - card.x * scale, y: (size.height - card.height * scale) / 2 - card.y * scale };
}

export function keepCardVisible(viewport: Viewport, card: Bounds, size: Size): Viewport {
  const left = card.x * viewport.scale + viewport.x;
  const top = card.y * viewport.scale + viewport.y;
  if (left >= 16 && top >= 24 && left + card.width * viewport.scale <= size.width - 16 && top + card.height * viewport.scale <= size.height - 16) return viewport;
  return focusViewport(card, size, viewport.scale);
}

export function placeCard(cards: readonly Bounds[], center: Point, size: Size): Point {
  const origin = { x: Math.round(center.x - size.width / 2), y: Math.round(center.y - size.height / 2) };
  const safe = (point: Point) => cards.every(card => point.x + size.width + 24 <= card.x || point.x >= card.x + card.width + 24 || point.y + size.height + 24 <= card.y || point.y >= card.y + card.height + 24);
  for (let ring = 0; ring < 24; ring += 1) {
    for (let y = -ring; y <= ring; y += 1) {
      for (let x = -ring; x <= ring; x += 1) {
        if (ring && Math.abs(x) !== ring && Math.abs(y) !== ring) continue;
        const point = { x: Math.max(-99_000, Math.min(99_000, origin.x + x * (size.width + 36))), y: Math.max(-99_000, Math.min(99_000, origin.y + y * (size.height + 36))) };
        if (safe(point)) return point;
      }
    }
  }
  return origin;
}

export function hitCard(cards: readonly (Bounds & { _id: string })[], point: Point): string | null {
  'worklet';
  // Later cards paint above earlier ones, so hit testing follows that same order.
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    const card = cards[index];
    if (
      point.x >= card.x && point.x <= card.x + card.width &&
      point.y >= card.y && point.y <= card.y + card.height
    ) return card._id;
  }
  return null;
}

export function boundsOfPoints(points: readonly Point[]): Bounds | null {
  if (!points.length) return null;
  let left = points[0].x;
  let top = points[0].y;
  let right = left;
  let bottom = top;
  for (const point of points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function unionBounds(bounds: readonly Bounds[]): Bounds | null {
  if (!bounds.length) return null;
  const points = bounds.flatMap((rect) => [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ]);
  return boundsOfPoints(points);
}

export function fitViewport(bounds: Bounds | null, size: Size, padding = 48): Viewport {
  if (!bounds || !size.width || !size.height) return { x: padding, y: padding, scale: 1 };
  const scale = Math.min(1.25, clampScale(Math.min(
    Math.max(1, size.width - padding * 2) / Math.max(1, bounds.width),
    Math.max(1, size.height - padding * 2) / Math.max(1, bounds.height),
  )));
  return {
    x: (size.width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (size.height - bounds.height * scale) / 2 - bounds.y * scale,
    scale,
  };
}

export function distanceToSegment(point: Point, start: Point, end: Point): number {
  'worklet';
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
  ));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/** Whether a point is inside a box, or within `reach` of it. A cheap first test before measuring against every segment of a line. */
export function nearBounds(bounds: Bounds | null, point: Point, reach: number): boolean {
  'worklet';
  return !!bounds && point.x >= bounds.x - reach && point.x <= bounds.x + bounds.width + reach
    && point.y >= bounds.y - reach && point.y <= bounds.y + bounds.height + reach;
}

export function hitStroke(points: readonly Point[], point: Point, tolerance: number): boolean {
  'worklet';
  if (points.length === 1) return distanceToSegment(point, points[0], points[0]) <= tolerance;
  for (let index = 1; index < points.length; index += 1) {
    if (distanceToSegment(point, points[index - 1], points[index]) <= tolerance) return true;
  }
  return false;
}

/** Ramer-Douglas-Peucker keeps turns while dropping redundant touch samples. */
export function simplifyStroke(points: readonly Point[], tolerance: number): Point[] {
  'worklet';
  if (points.length <= 2) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const segments: [number, number][] = [[0, points.length - 1]];
  while (segments.length) {
    const [first, last] = segments.pop()!;
    let greatestDistance = tolerance;
    let greatestIndex = -1;
    for (let index = first + 1; index < last; index += 1) {
      const distance = distanceToSegment(points[index], points[first], points[last]);
      if (distance > greatestDistance) {
        greatestDistance = distance;
        greatestIndex = index;
      }
    }
    if (greatestIndex !== -1) {
      keep[greatestIndex] = true;
      segments.push([first, greatestIndex], [greatestIndex, last]);
    }
  }
  return points.filter((_point, index) => keep[index]);
}

function encodeStroke(points: readonly Point[]): string {
  'worklet';
  let path = '';
  for (let index = 0; index < points.length; index += 1) {
    // At most two decimals; integers stay short. Also normalizes negative zero.
    const x = Math.round(points[index].x * 100) / 100;
    const y = Math.round(points[index].y * 100) / 100;
    path += `${index === 0 ? 'M' : 'L'}${x} ${y}`;
  }
  return path;
}

/**
 * The server caps a path at 8000 characters. Compact ink on the UI runtime at
 * gesture completion, starting below one screen pixel of error. Only extremely
 * intricate long strokes need a larger tolerance to fit the finite record.
 */
export function serializeStroke(points: readonly Point[], maxLength = 7800, tolerance = 0.45): string {
  'worklet';
  let source = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!source.length) return '';
  if (source.length === 1) source = [source[0], { x: source[0].x + 0.01, y: source[0].y }];
  let nextTolerance = Math.max(0.01, tolerance);
  let simplified = simplifyStroke(source, nextTolerance);
  let path = encodeStroke(simplified);
  while (path.length > maxLength && simplified.length > 2) {
    nextTolerance *= 2;
    simplified = simplifyStroke(source, nextTolerance);
    path = encodeStroke(simplified);
  }
  return path;
}

/** App-generated ink uses M/L. Also sample Q/C curves when loading SVG fixtures. */
export function pathToPoints(path: string): Point[] {
  const tokens = path.match(/[MLQCHVZmlqchvz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  const points: Point[] = [];
  let index = 0;
  let command = '';
  let current: Point = { x: 0, y: 0 };
  let subpath: Point = { x: 0, y: 0 };
  const isCommand = (value: string) => /^[a-z]$/i.test(value);
  while (index < tokens.length) {
    if (isCommand(tokens[index])) command = tokens[index++];
    const upper = command.toUpperCase();
    const relative = command !== upper;
    const arity = upper === 'Q' ? 4 : upper === 'C' ? 6 : upper === 'H' || upper === 'V' ? 1 : 2;
    if (upper === 'Z') {
      current = { ...subpath };
      points.push(current);
      command = '';
      continue;
    }
    if (!command || index + arity > tokens.length || tokens.slice(index, index + arity).some(isCommand)) break;
    const values = tokens.slice(index, index + arity).map(Number);
    index += arity;
    const pointAt = (offset: number) => ({
      x: values[offset] + (relative ? current.x : 0),
      y: values[offset + 1] + (relative ? current.y : 0),
    });
    if (upper === 'M' || upper === 'L') {
      current = pointAt(0);
      points.push(current);
      if (upper === 'M') {
        subpath = current;
        command = relative ? 'l' : 'L';
      }
    } else if (upper === 'H' || upper === 'V') {
      current = upper === 'H'
        ? { x: values[0] + (relative ? current.x : 0), y: current.y }
        : { x: current.x, y: values[0] + (relative ? current.y : 0) };
      points.push(current);
    } else if (upper === 'Q' || upper === 'C') {
      const start = current;
      const control1 = pointAt(0);
      const control2 = upper === 'C' ? pointAt(2) : control1;
      const end = pointAt(upper === 'C' ? 4 : 2);
      for (let step = 1; step <= 16; step += 1) {
        const t = step / 16;
        const u = 1 - t;
        points.push(upper === 'Q' ? {
          x: u * u * start.x + 2 * u * t * control1.x + t * t * end.x,
          y: u * u * start.y + 2 * u * t * control1.y + t * t * end.y,
        } : {
          x: u * u * u * start.x + 3 * u * u * t * control1.x + 3 * u * t * t * control2.x + t * t * t * end.x,
          y: u * u * u * start.y + 3 * u * u * t * control1.y + 3 * u * t * t * control2.y + t * t * t * end.y,
        });
      }
      current = end;
    } else break;
  }
  return points;
}

export function wrapCanvasText(text: string, measure: (text: string) => number, width: number, maxLines: number): string[] {
  if (width <= 0 || maxLines <= 0) return [];
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate) > width) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    lines.push(line);
  }
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines && visible.length) {
    let last = visible[visible.length - 1];
    while (last.length && measure(`${last}…`) > width) last = last.slice(0, -1);
    visible[visible.length - 1] = `${last.trimEnd()}…`;
  }
  // Also contain a single unbroken word such as a pasted URL.
  return visible.map((line) => {
    if (measure(line) <= width) return line;
    while (line.length && measure(`${line}…`) > width) line = line.slice(0, -1);
    return `${line}…`;
  });
}

type Box = { x: number; y: number; width: number; height: number };

/**
 * The curve a connector follows between two cards: it leaves the first card's edge,
 * bows by `bend` (a fraction of its length, either way), and arrives at the second
 * card's edge. Null when the cards touch.
 */
export function connectorCurve(from: Box, to: Box, bend = 0.14) {
  'worklet';
  const ax = from.x + from.width / 2, ay = from.y + from.height / 2, bx = to.x + to.width / 2, by = to.y + to.height / 2;
  const dx = bx - ax, dy = by - ay;
  const leave = Math.min((from.width / 2 + 8) / Math.max(Math.abs(dx), 0.001), (from.height / 2 + 8) / Math.max(Math.abs(dy), 0.001));
  const arrive = Math.min((to.width / 2 + 12) / Math.max(Math.abs(dx), 0.001), (to.height / 2 + 12) / Math.max(Math.abs(dy), 0.001));
  if (leave + arrive >= 1) return null;
  const sx = ax + dx * leave, sy = ay + dy * leave, ex = bx - dx * arrive, ey = by - dy * arrive;
  const length = Math.hypot(ex - sx, ey - sy) || 1;
  const bow = Math.sign(bend) * Math.min(Math.abs(bend) * length, 46 * Math.abs(bend) / 0.14);
  return { sx, sy, ex, ey, cx: (sx + ex) / 2 - (ey - sy) / length * bow, cy: (sy + ey) / 2 + (ex - sx) / length * bow };
}

function sampleConnector(from: Box, to: Box, bend: number) {
  const curve = connectorCurve(from, to, bend);
  if (!curve) return [];
  const points: Point[] = [];
  for (let step = 0; step <= 24; step += 1) {
    const t = step / 24;
    points.push({ x: (1 - t) ** 2 * curve.sx + 2 * (1 - t) * t * curve.cx + t ** 2 * curve.ex, y: (1 - t) ** 2 * curve.sy + 2 * (1 - t) * t * curve.cy + t ** 2 * curve.ey });
  }
  return points;
}

/** How far a point is from a connector's curve, for tapping on it. */
export function distanceToConnector(point: Point, from: Box, to: Box, bend = 0.14) {
  const points = sampleConnector(from, to, bend);
  return points.length ? Math.min(...points.map(sample => Math.hypot(point.x - sample.x, point.y - sample.y))) : Infinity;
}

/**
 * Picks how a connector should bow so it does not run across another card: the gentlest
 * bend, on either side, whose curve stays clear of every card in `others`.
 */
export function routeConnector(from: Box, to: Box, others: readonly Box[]) {
  for (const bend of [0.14, -0.14, 0.34, -0.34, 0.6, -0.6, 0.9, -0.9]) {
    const points = sampleConnector(from, to, bend);
    const blocked = points.some(point => others.some(card => point.x > card.x - 8 && point.x < card.x + card.width + 8 && point.y > card.y - 8 && point.y < card.y + card.height + 8));
    if (!blocked) return bend;
  }
  return 0.14;
}
