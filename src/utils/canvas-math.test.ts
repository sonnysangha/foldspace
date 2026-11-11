import { describe, expect, it } from 'vitest';
import type { CanvasCard } from '../types/canvas';
import { focusViewport, keepCardVisible, placeCard, distanceToSegment, fitViewport, hitCard, hitStroke, nearBounds, boundsOfPoints, pathToPoints, resizeViewport, screenToWorld, serializeStroke, simplifyStroke, worldToScreen, wrapCanvasText, zoomAtPoint } from './canvas-math';

describe('canvas coordinate system', () => {
  it('round trips translated, zoomed and negative document coordinates', () => {
    const viewport = { x: 139, y: -41, scale: 0.65 };
    const point = { x: -320, y: 840 };
    expect(screenToWorld(worldToScreen(point, viewport), viewport).x).toBeCloseTo(point.x);
    expect(screenToWorld(worldToScreen(point, viewport), viewport).y).toBeCloseTo(point.y);
  });

  it('keeps the focal document point stationary while zooming, including clamped zoom', () => {
    const viewport = { x: 50, y: 30, scale: 0.8 };
    const focal = { x: 350, y: 200 };
    const anchor = screenToWorld(focal, viewport);
    const next = zoomAtPoint(viewport, focal, 20);
    expect(next.scale).toBe(4);
    expect(worldToScreen(anchor, next)).toEqual(focal);
  });

  it('keeps the same document centre as Duo unfolds', () => {
    const viewport = { x: -80, y: 20, scale: 1.2 };
    const before = { width: 400, height: 800 };
    const after = { width: 900, height: 700 };
    const previousCentre = screenToWorld({ x: 200, y: 400 }, viewport);
    const next = resizeViewport(viewport, before, after);
    expect(screenToWorld({ x: 450, y: 350 }, next)).toEqual(previousCentre);
  });

  it('fits a negative-coordinate board into the available viewport', () => {
    const bounds = { x: -300, y: -200, width: 1200, height: 600 };
    const viewport = fitViewport(bounds, { width: 400, height: 800 }, 40);
    const topLeft = worldToScreen(bounds, viewport);
    const bottomRight = worldToScreen({ x: 900, y: 400 }, viewport);
    expect(topLeft.x).toBeCloseTo(40);
    expect(bottomRight.x).toBeCloseTo(360);
    expect(topLeft.y).toBeGreaterThanOrEqual(40);
    expect(bottomRight.y).toBeLessThanOrEqual(760);
  });
});

describe('canvas hit testing', () => {
  it('selects the topmost overlapping card and ignores empty space', () => {
    const cards = [
      { _id: 'back', x: 0, y: 0, width: 200, height: 100 },
      { _id: 'front', x: 100, y: 0, width: 200, height: 100 },
    ] as CanvasCard[];
    expect(hitCard(cards, { x: 150, y: 50 })).toBe('front');
    expect(hitCard(cards, { x: -1, y: 50 })).toBeNull();
  });

  it('erases by distance to the stroke instead of its rectangular bounds', () => {
    const stroke = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
    expect(hitStroke(stroke, { x: 50, y: 53 }, 4)).toBe(true);
    expect(hitStroke(stroke, { x: 5, y: 90 }, 4)).toBe(false);
    expect(distanceToSegment({ x: 105, y: 100 }, stroke[0], stroke[1])).toBe(5);
  });

  it('reads generated paths and curved seed strokes for bounds and erasing', () => {
    expect(pathToPoints('M10 20L30 40L-5 12')).toEqual([
      { x: 10, y: 20 }, { x: 30, y: 40 }, { x: -5, y: 12 },
    ]);
    const curve = pathToPoints('M0 0 Q50 100 100 0');
    expect(curve).toHaveLength(17);
    expect(curve[8]).toEqual({ x: 50, y: 50 });
    expect(curve[16]).toEqual({ x: 100, y: 0 });
  });
});

describe('canvas text', () => {
  it('wraps readable lines and contains an unbroken URL', () => {
    const measure = (text: string) => text.length * 8;
    expect(wrapCanvasText('A gentle place to think and make things', measure, 100, 2)).toEqual(['A gentle', 'place to…']);
    expect(wrapCanvasText('averylongunbrokentitle', measure, 48, 1)).toEqual(['avery…']);
  });
});

describe('bounded ink serialization', () => {
  it('preserves a dense curve within a subpixel tolerance while removing redundant samples', () => {
    const original = Array.from({ length: 2001 }, (_, index) => ({
      x: index / 5, y: 100 + Math.sin(index / 260) * 75,
    }));
    const simplified = simplifyStroke(original, 0.45);
    expect(simplified.length).toBeLessThan(100);
    expect(simplified[0]).toEqual(original[0]);
    expect(simplified.at(-1)).toEqual(original.at(-1));
    for (let index = 0; index < original.length; index += 10) {
      const distance = Math.min(...simplified.slice(1).map((end, segment) =>
        distanceToSegment(original[index], simplified[segment], end)));
      expect(distance).toBeLessThanOrEqual(0.451);
    }
  });

  it('fits a long intricate sketch inside the server limit and retains both endpoints', () => {
    const original = Array.from({ length: 1600 }, (_, index) => ({
      x: -800 + index * 1.125, y: 250 + Math.sin(index * 1.3) * 70,
    }));
    const path = serializeStroke(original);
    expect(path.length).toBeLessThanOrEqual(7800);
    const restored = pathToPoints(path);
    expect(restored[0]).toEqual(original[0]);
    expect(restored.at(-1)?.x).toBeCloseTo(original.at(-1)!.x, 2);
    expect(restored.at(-1)?.y).toBeCloseTo(original.at(-1)!.y, 2);
    expect(restored.length).toBeGreaterThan(2);
  });

  it('creates visible point marks and does not serialize invalid samples', () => {
    expect(serializeStroke([{ x: 1.23456, y: 7.8999 }])).toBe('M1.23 7.9L1.24 7.9');
    expect(serializeStroke([{ x: NaN, y: Infinity }])).toBe('');
  });
});

// Camera and placement behavior matters when a keyboard or hinge changes the visible pane.
describe('visible card placement and camera', () => {
  it('finds a clear position without piling a new card onto existing content', () => {
    const existing = [{ x: 0, y: 0, width: 280, height: 240 }];
    const next = placeCard(existing, { x: 140, y: 120 }, { width: 280, height: 240 });
    expect(next.x + 304 <= 0 || next.x >= 304 || next.y + 264 <= 0 || next.y >= 264).toBe(true);
  });
  it('centers a selected card inside a narrowed pane after keyboard or pose changes', () => {
    const card = { x: 600, y: -100, width: 280, height: 240 };
    const size = { width: 360, height: 360 };
    const camera = focusViewport(card, size);
    expect(worldToScreen({ x: 740, y: 20 }, camera)).toEqual({ x: 180, y: 180 });
    expect(keepCardVisible({ x: 0, y: 0, scale: 1 }, card, size)).toEqual(camera);
    expect(keepCardVisible(camera, card, size)).toBe(camera);
  });
});

describe('the eraser\'s quick test', () => {
  const points = pathToPoints('M10 10L110 60L40 90');
  const bounds = boundsOfPoints(points);
  it('boxes a line by its outermost points', () => {
    expect(bounds).toEqual({ x: 10, y: 10, width: 100, height: 80 });
  });
  it('lets through every point the full test would accept', () => {
    for (let x = -20; x <= 140; x += 7) {
      for (let y = -20; y <= 120; y += 7) {
        if (hitStroke(points, { x, y }, 9)) expect(nearBounds(bounds, { x, y }, 9)).toBe(true);
      }
    }
  });
  it('turns away points beyond its reach, and lines with no points', () => {
    expect(nearBounds(bounds, { x: 121, y: 50 }, 10)).toBe(false);
    expect(nearBounds(bounds, { x: 120, y: 50 }, 10)).toBe(true);
    expect(nearBounds(bounds, { x: 50, y: -1 }, 10)).toBe(false);
    expect(nearBounds(null, { x: 10, y: 10 }, 100)).toBe(false);
  });
});
