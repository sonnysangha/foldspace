// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import { publicWebUrl } from './links';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', './**/*.js', '!./**/*.test.ts']);
const setup = () => {
  const t = convexTest(schema, modules);
  return { t, alice: t.withIdentity({ subject: 'clerk-alice' }), bob: t.withIdentity({ subject: 'clerk-bob' }) };
};
const note = { kind: 'note' as const, title: 'A thought', body: 'Keep it simple.', color: '#FFF0BF', x: 100, y: 120, width: 250, height: 180 };

describe('workspace and nested canvas ownership', () => {
  it('creates a complete starter board atomically and isolates pin/edit controls', async () => {
    const { alice, bob } = setup();
    const board = await alice.mutation(api.workspaces.create, { title: 'A new film', color: '#DCECE7', template: 'storyboard' });
    const root = await alice.query(api.canvases.get, { canvasId: board.rootCanvasId });
    expect(root.cards).toHaveLength(4);
    expect((await alice.query(api.canvases.get, { canvasId: root.cards[0].childCanvasId })).cards).toHaveLength(2);
    await alice.mutation(api.workspaces.setPinned, { id: board._id, pinned: true });
    expect((await alice.query(api.workspaces.list, {}))[0].pinned).toBe(true);
    await expect(bob.mutation(api.workspaces.setPinned, { id: board._id, pinned: false })).rejects.toThrow('unavailable');
    await expect(bob.mutation(api.workspaces.update, { id: board._id, title: 'Stolen' })).rejects.toThrow('unavailable');
  });

  it('searches titles and notes in nested canvases without leaking deleted branches or other users', async () => {
    const { t, alice, bob } = setup();
    const board = await alice.mutation(api.workspaces.create, { title: 'Private', color: '#FFFFFF' });
    const parent = await alice.mutation(api.cards.create, { ...note, canvasId: board.rootCanvasId });
    const child = await alice.mutation(api.cards.create, { ...note, title: 'Tide notes', body: 'A quiet shoreline', canvasId: parent.childCanvasId });
    expect((await alice.query(api.search.cards, { workspaceId: board._id, text: 'tide' }))[0]._id).toBe(child._id);
    expect((await alice.query(api.search.cards, { workspaceId: board._id, text: 'shoreline' }))[0].canvasId).toBe(parent.childCanvasId);
    await expect(bob.query(api.search.cards, { workspaceId: board._id, text: 'tide' })).rejects.toThrow('unavailable');
    await expect(t.query(api.search.cards, { workspaceId: board._id, text: 'tide' })).rejects.toThrow('Sign in');
    await alice.mutation(api.cards.remove, { id: parent._id });
    expect(await alice.query(api.search.cards, { workspaceId: board._id, text: 'tide' })).toEqual([]);
    await alice.mutation(api.cards.restore, { id: parent._id });
    expect((await alice.query(api.search.cards, { workspaceId: board._id, text: 'tide' }))[0]._id).toBe(child._id);
  });

  it('shares a space by code: members edit its canvases, only the owner manages it, and leaving closes the door', async () => {
    const { t, alice, bob } = setup();
    const carol = t.withIdentity({ subject: 'clerk-carol', name: 'Carol' });
    const board = await alice.mutation(api.workspaces.create, { title: 'Trip', color: '#FFFFFF' });
    await expect(bob.mutation(api.sharing.enable, { workspaceId: board._id })).rejects.toThrow('unavailable');
    const code = await alice.mutation(api.sharing.enable, { workspaceId: board._id });
    expect(code).toMatch(/^[A-Z2-9]{12}$/);
    expect(await alice.mutation(api.sharing.enable, { workspaceId: board._id })).toBe(code);
    await expect(t.mutation(api.sharing.join, { code })).rejects.toThrow('Sign in');
    expect(await bob.mutation(api.sharing.join, { code: 'AAAA-AAAA-AAAA' })).toBeNull();

    expect((await carol.mutation(api.sharing.join, { code: `${code.slice(0, 4)}-${code.slice(4).toLowerCase()}` }))?._id).toBe(board._id);
    await carol.mutation(api.sharing.join, { code });
    const hers = await carol.query(api.workspaces.list, {});
    expect(hers).toMatchObject([{ _id: board._id, role: 'member', shared: true, pinned: false }]);
    expect((await alice.query(api.workspaces.list, {}))[0]).toMatchObject({ role: 'owner', shared: true });

    const added = await carol.mutation(api.cards.create, { ...note, title: 'From Carol', canvasId: board.rootCanvasId });
    expect((await alice.query(api.canvases.get, { canvasId: board.rootCanvasId })).cards.map((card: { _id: string }) => card._id)).toContain(added._id);
    await expect(carol.mutation(api.workspaces.update, { id: board._id, title: 'Mine now' })).rejects.toThrow('Only the owner');
    await expect(carol.mutation(api.workspaces.remove, { id: board._id })).rejects.toThrow('unavailable');
    await expect(carol.mutation(api.sharing.disable, { workspaceId: board._id })).rejects.toThrow('Only the owner');
    await expect(bob.query(api.canvases.get, { canvasId: board.rootCanvasId })).rejects.toThrow('unavailable');

    const seen = await carol.query(api.sharing.status, { workspaceId: board._id });
    expect(seen).toMatchObject({ role: 'member', code: null, members: [{ name: 'Carol', isYou: true }] });
    expect((await alice.query(api.sharing.status, { workspaceId: board._id })).code).toBe(code);

    await carol.mutation(api.sharing.leave, { workspaceId: board._id });
    await expect(carol.query(api.canvases.get, { canvasId: board.rootCanvasId })).rejects.toThrow('unavailable');
    await carol.mutation(api.sharing.join, { code });
    await alice.mutation(api.sharing.disable, { workspaceId: board._id });
    expect(await carol.query(api.workspaces.list, {})).toEqual([]);
    expect(await carol.mutation(api.sharing.join, { code })).toBeNull();
    // Wrong codes are counted, and a run of them locks further tries out for a while.
    for (let i = 0; i < 7; i += 1) expect(await bob.mutation(api.sharing.join, { code: 'BBBB-BBBB-BBBB' })).toBeNull();
    await expect(bob.mutation(api.sharing.join, { code: 'BBBB-BBBB-BBBB' })).rejects.toThrow('Too many');
    expect((await alice.query(api.workspaces.list, {}))[0].shared).toBe(false);
  });

  it('searches every space from the library, counts cards, and jots a note under what is there', async () => {
    const { t, alice, bob } = setup();
    const first = await alice.mutation(api.workspaces.create, { title: 'First', color: '#FFFFFF' });
    const second = await alice.mutation(api.workspaces.create, { title: 'Second', color: '#FFFFFF' });
    const theirs = await bob.mutation(api.workspaces.create, { title: 'Theirs', color: '#FFFFFF' });
    await alice.mutation(api.cards.create, { ...note, title: 'Harbour plan', canvasId: first.rootCanvasId });
    const low = await alice.mutation(api.cards.create, { ...note, title: 'Harbour photos', y: 900, canvasId: second.rootCanvasId });
    await bob.mutation(api.cards.create, { ...note, title: 'Harbour secrets', canvasId: theirs.rootCanvasId });
    const found = await alice.query(api.search.everywhere, { text: 'harbour' });
    expect(found.map(card => card.workspaceTitle).sort()).toEqual(['First', 'Second']);
    await expect(t.query(api.search.everywhere, { text: 'harbour' })).rejects.toThrow('Sign in');
    await alice.mutation(api.cards.remove, { id: low._id });
    expect((await alice.query(api.search.everywhere, { text: 'harbour' })).map(card => card.workspaceTitle)).toEqual(['First']);

    const jotted = await alice.mutation(api.cards.capture, { workspaceId: first._id, color: '#FFF2B2' });
    const root = await alice.query(api.canvases.get, { canvasId: first.rootCanvasId });
    const placed = root.cards.find((card: { _id: string }) => card._id === jotted._id)!;
    const other = root.cards.find((card: { _id: string }) => card._id !== jotted._id)!;
    expect(placed.y).toBeGreaterThanOrEqual(other.y + other.height);
    await expect(bob.mutation(api.cards.capture, { workspaceId: first._id, color: '#FFF2B2' })).rejects.toThrow('unavailable');
    const listed = await alice.query(api.workspaces.list, {});
    expect(listed.find(space => space._id === first._id)!.cardCount).toBe(2);
    expect(listed.find(space => space._id === second._id)!.cardCount).toBe(0);
  });

  it('restores a deleted card and its live descendants once, with correct counts and ownership', async () => {
    const { alice, bob } = setup();
    const board = await alice.mutation(api.workspaces.create, { title: 'Restore', color: '#FFFFFF' });
    const parent = await alice.mutation(api.cards.create, { ...note, canvasId: board.rootCanvasId });
    await alice.mutation(api.cards.create, { ...note, canvasId: parent.childCanvasId });
    await alice.mutation(api.cards.remove, { id: parent._id });
    await expect(bob.mutation(api.cards.restore, { id: parent._id })).rejects.toThrow('unavailable');
    await alice.mutation(api.cards.restore, { id: parent._id });
    await alice.mutation(api.cards.restore, { id: parent._id });
    expect((await alice.query(api.canvases.preview, { canvasId: board.rootCanvasId })).cardCount).toBe(1);
    expect((await alice.query(api.canvases.get, { canvasId: parent.childCanvasId })).cards).toHaveLength(1);
    await alice.mutation(api.workspaces.remove, { id: board._id });
    await expect(alice.mutation(api.cards.restore, { id: parent._id })).rejects.toThrow('unavailable');
  });

  it('erases and restores a batch once and rejects mixed-canvas batches atomically', async () => {
    const { alice, bob } = setup();
    const board = await alice.mutation(api.workspaces.create, { title: 'Ink', color: '#FFFFFF' });
    const other = await bob.mutation(api.workspaces.create, { title: 'Other', color: '#FFFFFF' });
    const args = { path: 'M 0 0 L 20 20', color: '#123456', width: 3 };
    const a = await alice.mutation(api.strokes.create, { ...args, canvasId: board.rootCanvasId });
    const b = await alice.mutation(api.strokes.create, { ...args, canvasId: board.rootCanvasId });
    const foreign = await bob.mutation(api.strokes.create, { ...args, canvasId: other.rootCanvasId });
    await expect(alice.mutation(api.strokes.setDeleted, { canvasId: board.rootCanvasId, ids: [a, foreign], deleted: true })).rejects.toThrow('unavailable');
    expect((await alice.query(api.canvases.get, { canvasId: board.rootCanvasId })).strokes).toHaveLength(2);
    await alice.mutation(api.strokes.setDeleted, { canvasId: board.rootCanvasId, ids: [a, a, b], deleted: true });
    expect((await alice.query(api.canvases.preview, { canvasId: board.rootCanvasId })).strokeCount).toBe(0);
    await alice.mutation(api.strokes.setDeleted, { canvasId: board.rootCanvasId, ids: [a, b], deleted: false });
    await alice.mutation(api.strokes.setDeleted, { canvasId: board.rootCanvasId, ids: [a, b], deleted: false });
    expect((await alice.query(api.canvases.preview, { canvasId: board.rootCanvasId })).strokeCount).toBe(2);
  });

  it('returns bounded live previews only to the owner and revokes them after removal', async () => {
    const { t, alice, bob } = setup();
    const board = await alice.mutation(api.workspaces.create, { title: 'Private cover', color: '#FFFFFF' });
    const parent = await alice.mutation(api.cards.create, { ...note, kind: 'canvas', canvasId: board.rootCanvasId });
    for (let i = 0; i < 14; i += 1) {
      await alice.mutation(api.cards.create, { ...note, title: `Thought ${i}`, canvasId: parent.childCanvasId });
    }
    const preview = await alice.query(api.canvases.preview, { canvasId: parent.childCanvasId });
    expect(preview.cardCount).toBe(14);
    expect(preview.cards).toHaveLength(12);
    await alice.mutation(api.cards.update, { id: preview.cards[0]._id, title: 'A changed thought' });
    const root = await alice.query(api.canvases.get, { canvasId: board.rootCanvasId });
    expect(root.cards[0].preview?.cards[0].title).toBe('A changed thought');
    await expect(bob.query(api.canvases.preview, { canvasId: parent.childCanvasId })).rejects.toThrow('unavailable');
    await expect(t.query(api.canvases.preview, { canvasId: parent.childCanvasId })).rejects.toThrow('Sign in');
    await alice.mutation(api.cards.remove, { id: parent._id });
    await expect(alice.query(api.canvases.preview, { canvasId: parent.childCanvasId })).rejects.toThrow('unavailable');
  });

  it('rejects anonymous reads, creation and seeding', async () => {
    const { t } = setup();
    await expect(t.query(api.workspaces.list, {})).rejects.toThrow('Sign in');
    await expect(t.mutation(api.workspaces.create, { title: 'Private', color: '#FFFFFF' })).rejects.toThrow('Sign in');
    await expect(t.mutation(api.workspaces.seedDemo, {})).rejects.toThrow('Sign in');
  });

  it('isolates reads, renames, additions, deletion and storage registration by Clerk subject', async () => {
    const { t, alice, bob } = setup();
    const board = await alice.mutation(api.workspaces.create, { title: 'Alice private', color: '#FFFFFF' });
    const card = await alice.mutation(api.cards.create, { ...note, canvasId: board.rootCanvasId });
    const strokeId = await alice.mutation(api.strokes.create, { canvasId: board.rootCanvasId, path: 'M 0 0 L 50 50', color: '#123456', width: 3 });
    expect(await bob.query(api.workspaces.list, {})).toEqual([]);
    await expect(bob.query(api.canvases.get, { canvasId: board.rootCanvasId })).rejects.toThrow('unavailable');
    await expect(bob.query(api.canvases.get, { canvasId: card.childCanvasId })).rejects.toThrow('unavailable');
    await expect(bob.mutation(api.workspaces.rename, { id: board._id, title: 'Stolen' })).rejects.toThrow('unavailable');
    await expect(bob.mutation(api.workspaces.remove, { id: board._id })).rejects.toThrow('unavailable');
    await expect(bob.mutation(api.cards.create, { ...note, canvasId: board.rootCanvasId })).rejects.toThrow('unavailable');
    await expect(bob.mutation(api.cards.update, { id: card._id, body: 'Stolen' })).rejects.toThrow('unavailable');
    await expect(bob.mutation(api.cards.remove, { id: card._id })).rejects.toThrow('unavailable');
    await expect(bob.mutation(api.strokes.create, { canvasId: board.rootCanvasId, path: 'M 0 0 L 50 50', color: '#123456', width: 3 })).rejects.toThrow('unavailable');
    await expect(bob.mutation(api.strokes.remove, { id: strokeId })).rejects.toThrow('unavailable');
    await expect(bob.mutation(api.strokes.restore, { id: strokeId })).rejects.toThrow('unavailable');
    await expect(bob.query(internal.storage.authorizeUpload, { workspaceId: board._id })).rejects.toThrow('unavailable');
    await expect(t.query(api.canvases.get, { canvasId: board.rootCanvasId })).rejects.toThrow('Sign in');
    expect((await alice.query(api.canvases.get, { canvasId: board.rootCanvasId })).cards[0].body).toBe(note.body);
  });

  it('persists nested content, updates breadcrumb titles and blocks all descendants after removal', async () => {
    const { alice } = setup();
    const board = await alice.mutation(api.workspaces.create, { title: 'Original', color: '#FFFFFF' });
    const card = await alice.mutation(api.cards.create, { ...note, canvasId: board.rootCanvasId });
    const nested = await alice.mutation(api.cards.create, { ...note, title: 'Nested', canvasId: card.childCanvasId });
    await alice.mutation(api.cards.update, { id: card._id, title: 'Renamed', x: -500 });
    await alice.mutation(api.workspaces.rename, { id: board._id, title: 'New root' });
    const result = await alice.query(api.canvases.get, { canvasId: nested.childCanvasId });
    expect(result.breadcrumbs.map((item: { title: string }) => item.title)).toEqual(['New root', 'Renamed', 'Nested']);
    await alice.mutation(api.cards.remove, { id: card._id });
    await expect(alice.query(api.canvases.get, { canvasId: nested.childCanvasId })).rejects.toThrow('unavailable');
    await expect(alice.mutation(api.cards.create, { ...note, canvasId: card.childCanvasId })).rejects.toThrow('unavailable');
    expect((await alice.query(api.canvases.get, { canvasId: board.rootCanvasId })).cards).toEqual([]);
    await alice.mutation(api.workspaces.remove, { id: board._id });
    expect(await alice.query(api.workspaces.list, {})).toEqual([]);
    await expect(alice.query(api.canvases.get, { canvasId: board.rootCanvasId })).rejects.toThrow('unavailable');
  });

  it('restores a removed workspace with its canvases, for its owner only', async () => {
    const { alice, bob } = setup();
    const board = await alice.mutation(api.workspaces.create, { title: 'Kept', color: '#FFFFFF' });
    await alice.mutation(api.cards.create, { ...note, canvasId: board.rootCanvasId });
    await alice.mutation(api.workspaces.remove, { id: board._id });
    await expect(bob.mutation(api.workspaces.restore, { id: board._id })).rejects.toThrow('unavailable');
    expect(await alice.query(api.workspaces.list, {})).toEqual([]);
    await alice.mutation(api.workspaces.restore, { id: board._id });
    await alice.mutation(api.workspaces.restore, { id: board._id });
    expect((await alice.query(api.workspaces.list, {})).map((item: { title: string }) => item.title)).toEqual(['Kept']);
    expect((await alice.query(api.canvases.get, { canvasId: board.rootCanvasId })).cards).toHaveLength(1);
  });

  it('stores link cards with a web address and rejects anything else', async () => {
    const { alice } = setup();
    const board = await alice.mutation(api.workspaces.create, { title: 'Links', color: '#FFFFFF' });
    const link = { ...note, kind: 'link' as const, title: 'Convex', canvasId: board.rootCanvasId };
    await alice.mutation(api.cards.create, { ...link, url: ' https://www.convex.dev/docs ' });
    await expect(alice.mutation(api.cards.create, link)).rejects.toThrow('web address');
    await expect(alice.mutation(api.cards.create, { ...link, url: 'javascript:alert(1)' })).rejects.toThrow('web address');
    await expect(alice.mutation(api.cards.create, { ...link, url: 'tel:123' })).rejects.toThrow('web address');
    const card = (await alice.query(api.canvases.get, { canvasId: board.rootCanvasId })).cards[0];
    expect(card).toMatchObject({ kind: 'link', url: 'https://www.convex.dev/docs' });
  });

  it('validates checklists, voice notes and places', async () => {
    const { alice } = setup();
    const board = await alice.mutation(api.workspaces.create, { title: 'Kinds', color: '#FFFFFF' });
    const base = { ...note, canvasId: board.rootCanvasId };
    await alice.mutation(api.cards.create, { ...base, kind: 'checklist', body: '[ ] one\n[x] two' });
    await expect(alice.mutation(api.cards.create, { ...base, kind: 'audio', duration: 4 })).rejects.toThrow('recording');
    await expect(alice.mutation(api.cards.create, { ...base, kind: 'place' })).rejects.toThrow('place');
    await expect(alice.mutation(api.cards.create, { ...base, kind: 'place', latitude: 120, longitude: 0 })).rejects.toThrow('range');
    const place = await alice.mutation(api.cards.create, { ...base, kind: 'place', latitude: 64.1, longitude: -21.9 });
    const cards = (await alice.query(api.canvases.get, { canvasId: board.rootCanvasId })).cards;
    expect(cards.find((card: { _id: string }) => card._id === place._id)).toMatchObject({ kind: 'place', latitude: 64.1, longitude: -21.9 });
    expect(cards.some((card: { kind: string; body: string }) => card.kind === 'checklist' && card.body === '[ ] one\n[x] two')).toBe(true);
  });

  it('connects two cards, toggles the connector off, and hides it with a deleted card', async () => {
    const { alice, bob } = setup();
    const board = await alice.mutation(api.workspaces.create, { title: 'Wires', color: '#FFFFFF' });
    const a = await alice.mutation(api.cards.create, { ...note, canvasId: board.rootCanvasId });
    const b = await alice.mutation(api.cards.create, { ...note, x: 500, canvasId: board.rootCanvasId });
    const ends = { canvasId: board.rootCanvasId, fromCardId: a._id, toCardId: b._id };
    const read = async () => (await alice.query(api.canvases.get, { canvasId: board.rootCanvasId })).connectors;
    expect(await alice.mutation(api.connectors.toggle, ends)).toBe('added');
    expect(await read()).toHaveLength(1);
    await expect(alice.mutation(api.connectors.toggle, { ...ends, toCardId: a._id })).rejects.toThrow('different');
    await expect(bob.mutation(api.connectors.toggle, ends)).rejects.toThrow('unavailable');
    await alice.mutation(api.cards.remove, { id: b._id });
    expect(await read()).toHaveLength(0);
    await alice.mutation(api.cards.restore, { id: b._id });
    expect(await read()).toHaveLength(1);
    expect(await alice.mutation(api.connectors.toggle, { ...ends, fromCardId: b._id, toCardId: a._id })).toBe('removed');
    expect(await read()).toHaveLength(0);
  });

  it('only lets link previews fetch public web addresses', () => {
    for (const ok of ['https://docs.expo.dev/router', 'http://example.org']) expect(publicWebUrl(ok)?.href).toBeTruthy();
    for (const bad of ['http://localhost:3000', 'http://127.0.0.1', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5', 'http://[::1]/', 'http://2130706433', 'http://0x7f.1', 'https://db.internal', 'https://user:pw@site.com', 'https://site.com:8443', 'ftp://site.com', 'file:///etc/passwd', 'http://intranet']) expect(publicWebUrl(bad)).toBeNull();
  });

  it('rejects a corrupt cross-workspace parent even when the same person owns both boards', async () => {
    const { t, alice } = setup();
    const first = await alice.mutation(api.workspaces.create, { title: 'One', color: '#FFFFFF' });
    const second = await alice.mutation(api.workspaces.create, { title: 'Two', color: '#FFFFFF' });
    const child = await alice.mutation(api.cards.create, { ...note, canvasId: first.rootCanvasId });
    await t.run(ctx => ctx.db.patch(child.childCanvasId, { parentCanvasId: second.rootCanvasId }));
    await expect(alice.query(api.canvases.get, { canvasId: child.childCanvasId })).rejects.toThrow('unavailable');
  });

  it('rejects image reuse across boards and produces an image URL only inside the owned board', async () => {
    const { t, alice, bob } = setup();
    const first = await alice.mutation(api.workspaces.create, { title: 'One', color: '#FFFFFF' });
    const second = await alice.mutation(api.workspaces.create, { title: 'Two', color: '#FFFFFF' });
    const storageId = await t.run(ctx => ctx.storage.store(new Blob(['fixture'], { type: 'image/png' })));
    await alice.mutation(internal.storage.registerUpload, { workspaceId: first._id, storageId, contentType: 'image/png', size: 7 });
    await expect(alice.mutation(api.cards.create, { ...note, kind: 'image', canvasId: second.rootCanvasId, imageStorageId: storageId })).rejects.toThrow('image is unavailable');
    await expect(bob.mutation(internal.storage.registerUpload, { workspaceId: first._id, storageId, contentType: 'image/png', size: 7 })).rejects.toThrow('unavailable');
    await alice.mutation(api.cards.create, { ...note, kind: 'image', canvasId: first.rootCanvasId, imageStorageId: storageId });
    expect((await alice.query(api.canvases.get, { canvasId: first.rootCanvasId })).cards[0].imageUrl).toBeTruthy();
    await expect(bob.query(api.canvases.get, { canvasId: first.rootCanvasId })).rejects.toThrow('unavailable');
  });
});

describe('drawing and seeded experience', () => {
  it('makes erase/restore idempotent without losing stroke data', async () => {
    const { t, alice } = setup();
    const board = await alice.mutation(api.workspaces.create, { title: 'Draw', color: '#FFFFFF' });
    const path = 'M 10 20 Q 50 90 120 20';
    const id = await alice.mutation(api.strokes.create, { canvasId: board.rootCanvasId, path, color: '#102030', width: 4 });
    await alice.mutation(api.strokes.remove, { id });
    await alice.mutation(api.strokes.remove, { id });
    expect((await alice.query(api.canvases.get, { canvasId: board.rootCanvasId })).strokes).toEqual([]);
    await alice.mutation(api.strokes.restore, { id });
    await alice.mutation(api.strokes.restore, { id });
    expect((await alice.query(api.canvases.get, { canvasId: board.rootCanvasId })).strokes).toEqual([{ _id: id, canvasId: board.rootCanvasId, path, color: '#102030', width: 4 }]);
    expect(await t.run(async ctx => (await ctx.db.get('canvases', board.rootCanvasId))?.strokeCount)).toBe(1);
  });

  it('rejects non-finite coordinates, out-of-range strokes and markup paths', async () => {
    const { alice } = setup();
    const board = await alice.mutation(api.workspaces.create, { title: 'Bounds', color: '#FFFFFF' });
    await expect(alice.mutation(api.cards.create, { ...note, canvasId: board.rootCanvasId, x: Infinity })).rejects.toThrow('range');
    await expect(alice.mutation(api.strokes.create, { canvasId: board.rootCanvasId, path: 'M 0 0 L 10 10', color: '#FFFFFF', width: -1 })).rejects.toThrow('range');
    await expect(alice.mutation(api.strokes.create, { canvasId: board.rootCanvasId, path: '<script/>', color: '#FFFFFF', width: 2 })).rejects.toThrow('invalid');
    await expect(alice.mutation(api.strokes.create, { canvasId: board.rootCanvasId, path: 'M 0 0 L 1e100 1', color: '#FFFFFF', width: 2 })).rejects.toThrow('outside');
  });

  it('seeds one explicit sample per user with nested canvases and vector drawings', async () => {
    const { alice, bob } = setup();
    const board = await alice.mutation(api.workspaces.seedDemo, {});
    expect(await alice.mutation(api.workspaces.seedDemo, {})).toEqual(board);
    const root = await alice.query(api.canvases.get, { canvasId: board.rootCanvasId });
    expect(root.workspace.title).toBe('The ocean story');
    expect(root.cards.length).toBeGreaterThanOrEqual(5);
    expect(root.strokes.length).toBeGreaterThanOrEqual(3);
    expect((await alice.query(api.workspaces.list, {}))[0].isDemo).toBe(true);
    const research = root.cards.find((card: { title: string; childCanvasId: string }) => card.title === 'Collecting inspiration')!;
    expect((await alice.query(api.canvases.get, { canvasId: research.childCanvasId })).cards.length).toBeGreaterThan(1);
    const bobsBoard = await bob.mutation(api.workspaces.seedDemo, {});
    expect(bobsBoard._id).not.toBe(board._id);
    await expect(bob.query(api.canvases.get, { canvasId: board.rootCanvasId })).rejects.toThrow('unavailable');
  });
});

describe('authenticated image upload', () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  it('requires a real owner and rejects malformed IDs without a server error', async () => {
    const { t, alice, bob } = setup();
    const board = await alice.mutation(api.workspaces.create, { title: 'Photos', color: '#FFFFFF' });
    expect((await t.fetch(`/upload?workspaceId=${board._id}`, { method: 'POST' })).status).toBe(401);
    expect((await bob.fetch(`/upload?workspaceId=${board._id}`, { method: 'POST' })).status).toBe(404);
    expect((await alice.fetch('/upload?workspaceId=not-an-id', { method: 'POST' })).status).toBe(404);
  });

  it('registers accepted images to the caller and rejects disguised files', async () => {
    const { alice } = setup();
    const board = await alice.mutation(api.workspaces.create, { title: 'Photos', color: '#FFFFFF' });
    const rejected = await alice.fetch(`/upload?workspaceId=${board._id}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: '<svg/>' });
    expect(rejected.status).toBe(415);
    const uploaded = await alice.fetch(`/upload?workspaceId=${board._id}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: pngBytes });
    expect(uploaded.status).toBe(200);
    const { storageId } = await uploaded.json();
    await alice.mutation(api.cards.create, { ...note, kind: 'image', canvasId: board.rootCanvasId, imageStorageId: storageId });
    expect((await alice.query(api.canvases.get, { canvasId: board.rootCanvasId })).cards[0].imageUrl).toBeTruthy();
  });
});
