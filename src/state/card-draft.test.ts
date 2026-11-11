import { describe, expect, it } from 'vitest';
import { CardDraftStore, type CardDraft } from './card-draft';
const initial = { title: 'A thought', body: '' };
function storage() {
  let value: string | null = null;
  return { read: async () => value, write: async (next: string) => { value = next; }, remove: async () => { value = null; }, value: () => value };
}
const tick = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

describe('recoverable card drafts', () => {
  it('serializes saves so a slow older write cannot overwrite newer typing', async () => {
    const disk = storage(); const writes: CardDraft[] = [];
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const store = new CardDraftStore(initial, disk, async draft => { if (!writes.length) await gate; writes.push(draft); });
    store.edit('body', 'First'); const first = store.flush();
    store.edit('body', 'Newest'); const second = store.flush();
    expect(writes).toHaveLength(0);
    release(); await Promise.all([first, second]);
    expect(writes.map(item => item.body)).toEqual(['First', 'Newest']);
    expect(store.getSnapshot().draft.body).toBe('Newest');
    expect(store.getSnapshot().status).toBe('saved');
  });
  it('retains a failed draft on disk, permits retry, and never clears a newer edit', async () => {
    const disk = storage(); let failing = true;
    const store = new CardDraftStore(initial, disk, async () => { if (failing) throw new Error('offline'); });
    store.edit('body', 'Keep this thought');
    expect(await store.flush()).toBe(false); await tick();
    expect(store.getSnapshot().localSaved).toBe(true);
    expect(store.getSnapshot().status).toBe('error');
    expect(JSON.parse(disk.value()!).body).toBe('Keep this thought');
    failing = false; expect(await store.flush()).toBe(true);
    store.edit('body', 'A newer thought'); await tick();
    expect(JSON.parse(disk.value()!).body).toBe('A newer thought');
    await store.flush();
  });
  it('does not replace new typing with a late local recovery read', async () => {
    let release!: (value: string) => void;
    const read = new Promise<string>(resolve => { release = resolve; });
    const disk = storage(); const store = new CardDraftStore(initial, { ...disk, read: () => read }, async () => {});
    const hydration = store.hydrate(); store.edit('body', 'Typed now');
    release(JSON.stringify({ title: 'Old', body: 'Old cached text' })); await hydration;
    expect(store.getSnapshot().draft.body).toBe('Typed now');
    await store.flush();
  });
  it('recovers a persisted draft and ignores cloud echoes while it is unsaved', async () => {
    const disk = storage(); await disk.write(JSON.stringify({ title: 'Recovered', body: 'Still here' }));
    const store = new CardDraftStore(initial, disk, async () => {});
    await store.hydrate(); store.receiveServer(initial);
    expect(store.getSnapshot().draft.title).toBe('Recovered');
    await store.flush();
    expect(store.getSnapshot().status).toBe('saved');
  });
});
