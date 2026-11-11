import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { colorValue, ensureUser, fail, MAX_WORKSPACES, requireIdentity, requireOwner, textValue } from './model/auth';
import { insertCard } from './model/canvas';
import { workspaceSummary } from './validators';
import { spaceTemplates, type SpaceTemplateId, type TemplateCard } from '../shared/space-templates';

const createdWorkspace = v.object({ _id: v.id('workspaces'), rootCanvasId: v.id('canvases') });

async function insertWorkspace(ctx: MutationCtx, title: string, color: string, isDemo: boolean) {
  const identity = await ensureUser(ctx);
  const existing = await ctx.db.query('workspaces')
    .withIndex('by_ownerId_and_deleted', q => q.eq('ownerId', identity.subject).eq('deleted', false))
    .take(MAX_WORKSPACES);
  if (existing.length >= MAX_WORKSPACES) fail('LIMIT_REACHED', 'You have reached the workspace limit.');
  const now = Date.now();
  const _id = await ctx.db.insert('workspaces', {
    ownerId: identity.subject, title, color, isDemo, deleted: false, createdAt: now, updatedAt: now,
  });
  const rootCanvasId = await ctx.db.insert('canvases', {
    workspaceId: _id, title, parentCanvasId: null, parentCardId: null,
    depth: 0, cardCount: 0, strokeCount: 0, createdAt: now,
  });
  await ctx.db.patch(_id, { rootCanvasId });
  return { _id, rootCanvasId };
}

export const list = query({
  args: {},
  returns: v.array(workspaceSummary),
  handler: async ctx => {
    const identity = await requireIdentity(ctx);
    const rows = await ctx.db.query('workspaces')
      .withIndex('by_ownerId_and_deleted', q => q.eq('ownerId', identity.subject).eq('deleted', false))
      .take(MAX_WORKSPACES);
    const joined = await ctx.db.query('members').withIndex('by_userId', q => q.eq('userId', identity.subject)).take(MAX_WORKSPACES);
    const theirs = await Promise.all(joined.map(member => ctx.db.get(member.workspaceId)));
    const all = [
      ...rows.map(row => ({ row, role: 'owner' as const })),
      ...theirs.flatMap(row => row && !row.deleted ? [{ row, role: 'member' as const }] : []),
    ];
    // The count comes from the root canvas's own tally: one small read per space.
    const summaries = await Promise.all(all.map(async ({ row, role }) => {
      if (!row.rootCanvasId) fail('NOT_FOUND', 'Workspace is unavailable.');
      const root = await ctx.db.get(row.rootCanvasId);
      const shared = role === 'member' || !!row.shareCode ||
        !!(await ctx.db.query('members').withIndex('by_workspaceId_and_userId', q => q.eq('workspaceId', row._id)).first());
      return {
        _id: row._id, title: row.title, color: row.color, rootCanvasId: row.rootCanvasId, updatedAt: row.updatedAt, createdAt: row.createdAt,
        cardCount: root?.cardCount ?? 0, isDemo: role === 'owner' && row.isDemo, pinned: role === 'owner' && (row.pinned ?? false),
        role, shared, ...(role === 'member' && row.ownerName ? { ownerName: row.ownerName } : {}),
      };
    }));
    return summaries.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  },
});

async function addTemplate(ctx: MutationCtx, canvasId: Awaited<ReturnType<typeof insertWorkspace>>['rootCanvasId'], template: SpaceTemplateId) {
  const insert = async (parent: typeof canvasId, cards: TemplateCard[]) => {
    for (const { children, ...card } of cards) {
      const created = await insertCard(ctx, { ...card, canvasId: parent });
      if (children) await insert(created.childCanvasId, children);
    }
  };
  await insert(canvasId, spaceTemplates.find(item => item.id === template)?.cards ?? []);
}

export const create = mutation({
  args: { title: v.string(), color: v.string(), template: v.optional(v.union(v.literal('blank'), v.literal('storyboard'), v.literal('project'), v.literal('journal'))) },
  returns: createdWorkspace,
  handler: async (ctx, args) => {
    const created = await insertWorkspace(ctx, textValue(args.title, 'Title', 160), colorValue(args.color), false);
    if (args.template && args.template !== 'blank') await addTemplate(ctx, created.rootCanvasId, args.template);
    return created;
  },
});

export const setPinned = mutation({
  args: { id: v.id('workspaces'), pinned: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { id, pinned }) => {
    const { workspace } = await requireOwner(ctx, id);
    await ctx.db.patch(workspace._id, { pinned });
    return null;
  },
});

export const update = mutation({
  args: { id: v.id('workspaces'), title: v.optional(v.string()), color: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireOwner(ctx, args.id);
    const title = args.title === undefined ? workspace.title : textValue(args.title, 'Title', 160);
    const color = args.color === undefined ? workspace.color : colorValue(args.color);
    await ctx.db.patch(workspace._id, { title, color, updatedAt: Date.now() });
    await ctx.db.patch(workspace.rootCanvasId!, { title });
    return null;
  },
});

export const rename = mutation({
  args: { id: v.id('workspaces'), title: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workspace } = await requireOwner(ctx, args.id);
    const title = textValue(args.title, 'Title', 160);
    await ctx.db.patch(workspace._id, { title, updatedAt: Date.now() });
    await ctx.db.patch(workspace.rootCanvasId!, { title });
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id('workspaces') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const workspace = await ctx.db.get(args.id);
    if (!workspace || workspace.ownerId !== identity.subject) fail('NOT_FOUND', 'This workspace is unavailable.');
    if (workspace.deleted) return null;
    // Every descendant access checks this tombstone; no unbounded recursive deletion.
    await ctx.db.patch(workspace._id, { deleted: true, updatedAt: Date.now() });
    return null;
  },
});

/** Undo for `remove`. The tombstone kept every canvas, so restoring is one patch. */
export const restore = mutation({
  args: { id: v.id('workspaces') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const workspace = await ctx.db.get(args.id);
    if (!workspace || workspace.ownerId !== identity.subject) fail('NOT_FOUND', 'This workspace is unavailable.');
    if (!workspace.deleted) return null;
    const existing = await ctx.db.query('workspaces')
      .withIndex('by_ownerId_and_deleted', q => q.eq('ownerId', identity.subject).eq('deleted', false))
      .take(MAX_WORKSPACES);
    if (existing.length >= MAX_WORKSPACES) fail('LIMIT_REACHED', 'You have reached the workspace limit.');
    await ctx.db.patch(workspace._id, { deleted: false, updatedAt: Date.now() });
    return null;
  },
});

export const seedDemo = mutation({
  args: {},
  returns: createdWorkspace,
  handler: async ctx => {
    const identity = await requireIdentity(ctx);
    const existing = await ctx.db.query('workspaces')
      .withIndex('by_ownerId_and_deleted_and_isDemo', q => q.eq('ownerId', identity.subject).eq('deleted', false).eq('isDemo', true))
      .first();
    if (existing?.rootCanvasId) return { _id: existing._id, rootCanvasId: existing.rootCanvasId };
    const board = await insertWorkspace(ctx, 'The ocean story', '#478C8A', true);
    const common = { canvasId: board.rootCanvasId, width: 250, height: 190 };
    const northStar = await insertCard(ctx, { ...common, kind: 'note', title: 'A little wonder', body: 'A short film about the things we notice when we slow down.\n\nStart with a sound. End with a feeling.', color: '#FFF0BF', x: 70, y: 90 });
    const research = await insertCard(ctx, { ...common, kind: 'canvas', title: 'Collecting inspiration', body: 'Sea glass, quiet coastlines, handwritten maps.\n\nOpen this card to explore the mood.', color: '#DCECE7', x: 410, y: 60, height: 220 });
    const story = await insertCard(ctx, { ...common, kind: 'canvas', title: 'The story in three acts', body: '01  Arrive\n02  Discover\n03  Take something home', color: '#E4E0F5', x: 750, y: 100, height: 240 });
    await insertCard(ctx, { ...common, kind: 'note', title: 'A question to carry', body: 'What if the smallest discoveries made the biggest memories?', color: '#F9DCCA', x: 135, y: 405, width: 280, height: 160 });
    const shotList = await insertCard(ctx, { ...common, kind: 'canvas', title: 'Little moments', body: 'A pocket-sized shot list.\n\nOpen to step inside.', color: '#D9E8F5', x: 570, y: 420, width: 280, height: 175 });
    await insertCard(ctx, { canvasId: northStar.childCanvasId, kind: 'note', title: 'The heart of it', body: 'Curiosity has no age. Let the film feel found, not performed.', color: '#FFF0BF', x: 100, y: 100, width: 310, height: 170 });
    await insertCard(ctx, { canvasId: research.childCanvasId, kind: 'note', title: 'Color from the coast', body: 'Warm sand\nSea-glass green\nCloud-white linen\nOne sun-faded red accent', color: '#DCECE7', x: 80, y: 100, width: 260, height: 220 });
    await insertCard(ctx, { canvasId: research.childCanvasId, kind: 'note', title: 'Things to listen for', body: 'Pebbles rolling back with the tide.\nA distant gull.\nA jacket moving in the wind.\nLeave room for silence.', color: '#E6E3F6', x: 440, y: 120, width: 300, height: 200 });
    const opening = await insertCard(ctx, { canvasId: story.childCanvasId, kind: 'canvas', title: '01 · Arrive', body: 'A wide beach. A small person. An unhurried morning.', color: '#FFF0BF', x: 60, y: 100, width: 250, height: 200 });
    await insertCard(ctx, { canvasId: story.childCanvasId, kind: 'note', title: '02 · Discover', body: 'A hand finds sea glass. Hold the shot two beats longer than feels comfortable.', color: '#DCECE7', x: 400, y: 100, width: 260, height: 200 });
    await insertCard(ctx, { canvasId: story.childCanvasId, kind: 'note', title: '03 · Take it home', body: 'The glass on a windowsill. The ocean is gone, but the feeling stays.', color: '#F9DCCA', x: 740, y: 100, width: 260, height: 200 });
    await insertCard(ctx, { canvasId: opening.childCanvasId, kind: 'note', title: 'Opening voiceover', body: '“Some days, you don’t need to go far.\nYou just need to look a little closer.”', color: '#FFF0BF', x: 120, y: 120, width: 350, height: 220 });
    await insertCard(ctx, { canvasId: shotList.childCanvasId, kind: 'note', title: 'Shoot at first light', body: '□ Wide coastline\n□ Shoes on the sand\n□ Hand and sea glass\n□ Light through the glass\n□ Windowsill at home', color: '#D9E8F5', x: 100, y: 100, width: 320, height: 240 });
    const strokes = [
      { path: 'M 340 180 C 360 155 380 155 400 170 M 385 160 L 400 170 L 385 178', color: '#4A7672', width: 3 },
      { path: 'M 680 180 C 705 200 720 185 740 180 M 727 170 L 740 180 L 726 186', color: '#77649B', width: 3 },
      { path: 'M 425 470 C 465 495 495 480 550 475', color: '#A57A60', width: 3 },
      { path: 'M 78 315 Q 118 293 158 315 T 238 315 T 318 315', color: '#68A29C', width: 5 },
    ];
    for (const stroke of strokes) await ctx.db.insert('strokes', { ...stroke, workspaceId: board._id, canvasId: board.rootCanvasId, deleted: false, createdAt: Date.now() });
    await ctx.db.patch(board.rootCanvasId, { strokeCount: strokes.length });
    return board;
  },
});
