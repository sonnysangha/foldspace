import { describe, expect, it } from 'vitest';
import { withCardLook } from './card-look';

const canvas = () => ({
  title: 'Board',
  cards: [
    { _id: 'a', color: '#FFFFFF', width: 280, height: 240, x: 10, y: 20, title: 'One' },
    { _id: 'b', color: '#FFF0BF', width: 280, height: 130, x: 400, y: 20, title: 'Two' },
  ],
});

describe('showing a card\'s new colour or size before it is saved', () => {
  it('changes only the card and fields asked for, and leaves the original alone', () => {
    const before = canvas();
    const after = withCardLook(before, 'b', { color: '#dcece7' });
    expect(after.cards[1]).toEqual({ ...before.cards[1], color: '#DCECE7' });
    expect(after.cards[0]).toBe(before.cards[0]);
    expect(after.title).toBe('Board');
    expect(before).toEqual(canvas());
  });
  it('resizes without touching position or colour', () => {
    const after = withCardLook(canvas(), 'a', { width: 360, height: 300 });
    expect(after.cards[0]).toMatchObject({ width: 360, height: 300, x: 10, y: 20, color: '#FFFFFF' });
  });
  it('returns the very same canvas when there is nothing to show', () => {
    const before = canvas();
    expect(withCardLook(before, 'a', {})).toBe(before);
    expect(withCardLook(before, 'a', { color: '#ffffff', width: 280 })).toBe(before);
    expect(withCardLook(before, 'missing', { color: '#000000' })).toBe(before);
  });
});
