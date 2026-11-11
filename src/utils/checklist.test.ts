import { describe, expect, it } from 'vitest';
import { parseChecklist, serializeChecklist, toggleChecklistItem } from './checklist';

describe('checklist bodies', () => {
  it('reads ticked, unticked and plain lines', () => {
    expect(parseChecklist('[ ] one\n[x] two\nthree\n\n')).toEqual([
      { done: false, text: 'one' }, { done: true, text: 'two' }, { done: false, text: 'three' },
    ]);
  });
  it('round-trips and toggles one item', () => {
    const body = serializeChecklist([{ done: false, text: 'a' }, { done: false, text: 'b' }]);
    expect(body).toBe('[ ] a\n[ ] b');
    expect(toggleChecklistItem(body, 1)).toBe('[ ] a\n[x] b');
    expect(toggleChecklistItem(toggleChecklistItem(body, 1), 1)).toBe(body);
  });
});
