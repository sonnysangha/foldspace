import { describe, expect, it } from 'vitest';
import { fitWithin, LruCache } from './lru';

describe('a cache with a ceiling', () => {
  it('lets go of what was used longest ago', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1); cache.set('b', 2); cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });
  it('counts reading something as using it', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1); cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });
  it('weighs entries by their cost, and frees enough of them for a large one', () => {
    const cache = new LruCache<string, { bytes: number }>(100, value => value.bytes);
    cache.set('a', { bytes: 40 }); cache.set('b', { bytes: 40 });
    expect(cache.cost).toBe(80);
    cache.set('c', { bytes: 70 });
    expect([cache.has('a'), cache.has('b'), cache.has('c')]).toEqual([false, false, true]);
    expect(cache.cost).toBe(70);
  });
  it('keeps the newest entry even when it alone is over the limit', () => {
    const cache = new LruCache<string, { bytes: number }>(100, value => value.bytes);
    cache.set('small', { bytes: 10 }); cache.set('huge', { bytes: 500 });
    expect(cache.has('huge')).toBe(true);
    expect(cache.size).toBe(1);
  });
  it('replaces an entry without counting it twice', () => {
    const cache = new LruCache<string, { bytes: number }>(100, value => value.bytes);
    cache.set('a', { bytes: 60 }); cache.set('a', { bytes: 30 });
    expect(cache.cost).toBe(30);
    expect(cache.size).toBe(1);
  });
});

describe('fitting a picture within a longest side', () => {
  it('shrinks in proportion', () => {
    expect(fitWithin(1800, 1350, 1200)).toEqual({ width: 1200, height: 900 });
    expect(fitWithin(1000, 4000, 1200)).toEqual({ width: 300, height: 1200 });
  });
  it('never enlarges, and never rounds a side away', () => {
    expect(fitWithin(640, 480, 1200)).toEqual({ width: 640, height: 480 });
    expect(fitWithin(5000, 2, 1200)).toEqual({ width: 1200, height: 1 });
  });
});
