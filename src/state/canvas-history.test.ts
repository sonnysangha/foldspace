import { describe, expect, it } from 'vitest';
import { CanvasHistory } from './canvas-history';

describe('canvas history', () => {
  it('keeps a gesture atomic, redoes it, and discards the redo branch on a new change', async () => {
    const history = new CanvasHistory(); let strokes = 3;
    await history.commit('Erase ink', async () => { strokes = 0; return { value: null, undo: async () => { strokes = 3; }, redo: async () => { strokes = 0; } }; });
    await history.undo(); expect(strokes).toBe(3);
    await history.redo(); expect(strokes).toBe(0);
    await history.undo();
    await history.commit('New note', async () => ({ value: 1, undo: async () => {}, redo: async () => {} }));
    expect(history.getSnapshot().redoCount).toBe(0);
  });
  it('serializes delayed changes and refuses undo while a write is pending', async () => {
    const history = new CanvasHistory(); const order: number[] = [];
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const first = history.commit('First', async () => { await gate; order.push(1); return { value: 1, undo: async () => {}, redo: async () => {} }; });
    const second = history.commit('Second', async () => { order.push(2); return { value: 2, undo: async () => {}, redo: async () => {} }; });
    expect(await history.undo()).toBe(false);
    release(); await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
    expect(history.getSnapshot().undoCount).toBe(2);
  });
  it('retains a failed undo for retry and isolates documents', async () => {
    const first = new CanvasHistory(); const other = new CanvasHistory(); let fail = true;
    await first.commit('Delete card', async () => ({ value: null, undo: async () => { if (fail) throw new Error('offline'); }, redo: async () => {} }));
    await expect(first.undo()).rejects.toThrow('offline');
    expect(first.getSnapshot().undoCount).toBe(1);
    fail = false; await first.undo();
    expect(first.getSnapshot().redoCount).toBe(1);
    expect(other.getSnapshot().undoCount).toBe(0);
  });
});

it('keeps redo available after a no-op edit and excludes failed mutations', async () => {
  const history = new CanvasHistory();
  const action = { value: null, undo: async () => {}, redo: async () => {} };
  await history.commit('Move', async () => action);
  await history.undo();
  await history.commit('Same size', async () => ({ ...action, skip: true }));
  expect(history.getSnapshot().redoCount).toBe(1);
  await expect(history.commit('Failed edit', async () => { throw new Error('rejected'); })).rejects.toThrow('rejected');
  expect(history.getSnapshot().undoCount).toBe(0);
  expect(history.getSnapshot().redoCount).toBe(1);
});
