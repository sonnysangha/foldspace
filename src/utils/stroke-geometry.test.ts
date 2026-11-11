import { describe, expect, it } from 'vitest';
import { STROKE_GEOMETRY_LIMIT, strokeGeometry } from './stroke-geometry';

describe('remembered line geometry', () => {
  it('reads a line once and hands back the same result afterwards', () => {
    const first = strokeGeometry('geo-a', 'M0 0L10 20');
    expect(first.points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 20 }]);
    expect(first.bounds).toEqual({ x: 0, y: 0, width: 10, height: 20 });
    expect(strokeGeometry('geo-a', 'M0 0L10 20')).toBe(first);
  });
  it('reads again if the same id arrives with a different path', () => {
    const first = strokeGeometry('geo-b', 'M0 0L10 20');
    const second = strokeGeometry('geo-b', 'M5 5L6 6');
    expect(second).not.toBe(first);
    expect(second.bounds).toEqual({ x: 5, y: 5, width: 1, height: 1 });
  });
  it('gives a path with no points an empty box', () => {
    expect(strokeGeometry('geo-empty', '')).toMatchObject({ points: [], bounds: null });
  });
  it('forgets the line used longest ago once it holds too many', () => {
    const oldest = strokeGeometry('geo-old', 'M1 1L2 2');
    const kept = strokeGeometry('geo-kept', 'M1 1L2 2');
    for (let index = 0; index < STROKE_GEOMETRY_LIMIT - 1; index += 1) {
      strokeGeometry(`geo-fill-${index}`, 'M0 0L1 1');
      // Still in use, so it is never the one dropped.
      if (index % 100 === 0) expect(strokeGeometry('geo-kept', 'M1 1L2 2')).toBe(kept);
    }
    expect(strokeGeometry('geo-kept', 'M1 1L2 2')).toBe(kept);
    expect(strokeGeometry('geo-old', 'M1 1L2 2')).not.toBe(oldest);
  });
});
