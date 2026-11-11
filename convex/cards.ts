import { v } from 'convex/values';
import { mutation } from './_generated/server';
import { colorValue, fail, MAX_CARDS, numberValue, requireCanvas, requireCard, requireIdentity, requireWorkspace, textValue } from './model/auth';
import { insertCard } from './model/canvas';
import { cardKind } from './validators';

export const create = mutation({
  args: { canvasId: v.id('canvases'), kind: cardKind, title: v.string(), body: v.string(), color: v.string(), x: v.number(), y: v.number(), width: v.number(), height: v.number(), imageStorageId: v.optional(v.id('_storage')), url: v.optional(v.string()), duration: v.optional(v.number()), latitude: v.optional(v.number()), longitude: v.optional(v.number()) },
  returns: v.object({ _id: v.id('cards'), childCanvasId: v.id('canvases') }),
  handler: insertCard,
});

/**
 * A note jotted from the library, before any canvas is open. Nothing on the device knows
 * the canvas's layout yet, so the note is placed here: under everything already there.
 */
export const capture = mutation({
  args: { workspaceId: v.id('workspaces'), color: v.string() },
  returns: v.object({ _id: v.id('cards'), canvasId: v.id('canvases') }),
  handler: async (ctx, { workspaceId, color }) => {
    const { workspace } = await requireWorkspace(ctx, workspaceId);
    const canvasId = workspace.rootCanvasId!;
    const cards = await ctx.db.query('cards')
      .withIndex('by_canvasId_and_deleted', q => q.eq('canvasId', canvasId).eq('deleted', false))
      .take(MAX_CARDS);
    const x = cards.length ? Math.min(...cards.map(card => card.x)) : 80;
    const y = cards.length ? Math.max(...cards.map(card => card.y + card.height)) + 40 : 80;
    const created = await insertCard(ctx, { canvasId, kind: 'note', title: 'New sticky note', body: '', color, x, y, width: 280, height: 240 });
    return { _id: created._id, canvasId };
  },
});

/** Gives a place card its map picture, taken on the device after the map has drawn. */
export const setImage = mutation({
  args: { id: v.id('cards'), imageStorageId: v.id('_storage') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { card, workspace, identity } = await requireCard(ctx, args.id);
    if (card.kind !== 'place') fail('INVALID_INPUT', 'Only a place can take a map picture.');
    const image = await ctx.db.query('images').withIndex('by_storageId', q => q.eq('storageId', args.imageStorageId)).unique();
    if (!image || image.workspaceId !== workspace._id) fail('NOT_FOUND', 'This image is unavailable.');
    await ctx.db.patch(card._id, { imageStorageId: args.imageStorageId, updatedAt: Date.now() });
    return null;
  },
});

export const update = mutation({
  args: { id: v.id('cards'), title: v.optional(v.string()), body: v.optional(v.string()), color: v.optional(v.string()), x: v.optional(v.number()), y: v.optional(v.number()), width: v.optional(v.number()), height: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { card, workspace } = await requireCard(ctx, args.id);
    const patch = {
      ...(args.title === undefined ? {} : { title: textValue(args.title, 'Title', 160) }),
      ...(args.body === undefined ? {} : { body: textValue(args.body, 'Note', 8_000, true) }),
      ...(args.color === undefined ? {} : { color: colorValue(args.color) }),
      ...(args.x === undefined ? {} : { x: numberValue(args.x, 'X position', -100_000, 100_000) }),
      ...(args.y === undefined ? {} : { y: numberValue(args.y, 'Y position', -100_000, 100_000) }),
      ...(args.width === undefined ? {} : { width: numberValue(args.width, 'Width', 80, 2_000) }),
      ...(args.height === undefined ? {} : { height: numberValue(args.height, 'Height', 60, 2_000) }),
      updatedAt: Date.now(),
    };
    await ctx.db.patch(card._id, patch);
    if (patch.title !== undefined) await ctx.db.patch(card.childCanvasId, { title: patch.title });
    await ctx.db.patch(workspace._id, { updatedAt: patch.updatedAt });
    return null;
  },
});

/** Read the previous geometry in the same transaction as the edit, for exact undo. */
export const edit = mutation({
  args: { id: v.id('cards'), color: v.optional(v.string()), x: v.optional(v.number()), y: v.optional(v.number()), width: v.optional(v.number()), height: v.optional(v.number()) },
  returns: v.object({ color: v.string(), x: v.number(), y: v.number(), width: v.number(), height: v.number() }),
  handler: async (ctx, args) => {
    const { card, workspace } = await requireCard(ctx, args.id);
    const patch = {
      ...(args.color === undefined ? {} : { color: colorValue(args.color) }),
      ...(args.x === undefined ? {} : { x: numberValue(args.x, 'X position', -100_000, 100_000) }),
      ...(args.y === undefined ? {} : { y: numberValue(args.y, 'Y position', -100_000, 100_000) }),
      ...(args.width === undefined ? {} : { width: numberValue(args.width, 'Width', 80, 2_000) }),
      ...(args.height === undefined ? {} : { height: numberValue(args.height, 'Height', 60, 2_000) }),
      updatedAt: Date.now(),
    };
    await ctx.db.patch(card._id, patch);
    await ctx.db.patch(workspace._id, { updatedAt: patch.updatedAt });
    return { color: card.color, x: card.x, y: card.y, width: card.width, height: card.height };
  },
});

export const remove = mutation({
  args: { id: v.id('cards') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireIdentity(ctx);
    const card = await ctx.db.get(args.id);
    if (!card) fail('NOT_FOUND', 'This card is unavailable.');
    const { canvas, workspace } = await requireCanvas(ctx, card.canvasId);
    if (card.workspaceId !== workspace._id) fail('NOT_FOUND', 'This card is unavailable.');
    if (card.deleted) return null;
    await ctx.db.patch(card._id, { deleted: true, updatedAt: Date.now() });
    await ctx.db.patch(canvas._id, { cardCount: Math.max(0, canvas.cardCount - 1) });
    await ctx.db.patch(workspace._id, { updatedAt: Date.now() });
    return null;
  },
});

export const restore = mutation({
  args: { id: v.id('cards') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireIdentity(ctx);
    const card = await ctx.db.get(id);
    if (!card) fail('NOT_FOUND', 'This card is unavailable.');
    const { canvas, workspace } = await requireCanvas(ctx, card.canvasId);
    if (card.workspaceId !== workspace._id) fail('NOT_FOUND', 'This card is unavailable.');
    if (!card.deleted) return null;
    if (canvas.cardCount >= MAX_CARDS) fail('LIMIT_REACHED', 'This canvas has reached its card limit.');
    await ctx.db.patch(card._id, { deleted: false, updatedAt: Date.now() });
    await ctx.db.patch(canvas._id, { cardCount: canvas.cardCount + 1 });
    await ctx.db.patch(workspace._id, { updatedAt: Date.now() });
    return null;
  },
});
