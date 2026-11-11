import { describe, expect, it } from 'vitest';
import { keepOrder, sameData } from './stable';

describe('sameData', () => {
  it('compares nested objects and arrays by value', () => {
    const card = { _id: 'a', x: 1, preview: { cards: [{ _id: 'b', title: 'T' }], strokes: [] }, imageUrl: null };
    expect(sameData(card, JSON.parse(JSON.stringify(card)))).toBe(true);
    expect(sameData(card, { ...card, x: 2 })).toBe(false);
    expect(sameData(card, { ...card, preview: { cards: [{ _id: 'b', title: 'Other' }], strokes: [] } })).toBe(false);
  });
  it('notices added, removed and reordered entries', () => {
    expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameData({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(sameData([1, 2], [2, 1])).toBe(false);
    expect(sameData([1, 2], [1, 2, 3])).toBe(false);
  });
  it('does not confuse null, arrays and objects', () => {
    expect(sameData(null, {})).toBe(false);
    expect(sameData([], {})).toBe(false);
    expect(sameData(null, null)).toBe(true);
    expect(sameData('a', 'a')).toBe(true);
  });
});

describe('keepOrder', () => {
  const items = [{ _id: 'c' }, { _id: 'a' }, { _id: 'b' }];
  it('follows the remembered order', () => {
    expect(keepOrder(items, ['a', 'b', 'c']).map(item => item._id)).toEqual(['a', 'b', 'c']);
  });
  it('puts unknown items first, in the order they arrived', () => {
    expect(keepOrder([{ _id: 'new2' }, ...items, { _id: 'new1' }], ['b', 'c']).map(item => item._id)).toEqual(['new2', 'a', 'new1', 'b', 'c']);
  });
  it('drops nothing and ignores ids that are gone', () => {
    expect(keepOrder(items, ['gone', 'b']).map(item => item._id)).toEqual(['c', 'a', 'b']);
  });
});
