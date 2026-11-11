import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { query, type QueryCtx } from './_generated/server';
import { MAX_CARDS, MAX_DEPTH, MAX_STROKES, requireCanvas } from './model/auth';
import { MAX_CONNECTORS } from './connectors';
import { readPreview } from './model/preview';
import { canvasPreview, publicCard, publicStroke } from './validators';

export const preview = query({
  args: { canvasId: v.id('canvases') },
  returns: canvasPreview,
  handler: async (ctx, { canvasId }) => {
    const { canvas } = await requireCanvas(ctx, canvasId);
    return readPreview(ctx, canvas);
  },
});

const canvasShape = {
  canvas: v.object({ _id: v.id('canvases'), title: v.string(), parentCanvasId: v.union(v.id('canvases'), v.null()), parentCardId: v.union(v.id('cards'), v.null()) }),
  workspace: v.object({ _id: v.id('workspaces'), title: v.string(), color: v.string(), rootCanvasId: v.id('canvases') }),
  cards: v.array(publicCard),
  connectors: v.array(v.object({ _id: v.id('connectors'), fromCardId: v.id('cards'), toCardId: v.id('cards'), color: v.optional(v.string()) })),
  breadcrumbs: v.array(v.object({ _id: v.id('canvases'), title: v.string() })),
};

/** Everything on a canvas except its ink. Call only with what `requireCanvas` returned. */
async function readCards(ctx: QueryCtx, canvas: Doc<'canvases'>, workspace: Doc<'workspaces'>) {
  const canvasId = canvas._id;
  const [cards, connectors] = await Promise.all([
    ctx.db.query('cards').withIndex('by_canvasId_and_deleted', q => q.eq('canvasId', canvasId).eq('deleted', false)).take(MAX_CARDS),
    ctx.db.query('connectors').withIndex('by_canvasId', q => q.eq('canvasId', canvasId)).take(MAX_CONNECTORS),
  ]);
  // A connector to a deleted card is hidden, and returns if the card is restored.
  const live = new Set(cards.map(card => card._id));
  const breadcrumbs = [{ _id: canvas._id, title: canvas.title }];
  // Limit preview fan-out on busy canvases; remaining boards still open normally.
  const previewIds = new Set(cards.filter(card => card.kind === 'canvas').slice(0, 16).map(card => card._id));
  let parentId = canvas.parentCanvasId;
  for (let i = 0; parentId && i < MAX_DEPTH; i += 1) {
    const parent = await ctx.db.get(parentId);
    if (!parent) break;
    breadcrumbs.unshift({ _id: parent._id, title: parent.title });
    parentId = parent.parentCanvasId;
  }
  return {
    canvas: { _id: canvas._id, title: canvas.title, parentCanvasId: canvas.parentCanvasId, parentCardId: canvas.parentCardId },
    workspace: { _id: workspace._id, title: workspace.title, color: workspace.color, rootCanvasId: workspace.rootCanvasId! },
    cards: await Promise.all(cards.map(async card => {
      const child = previewIds.has(card._id) ? await ctx.db.get(card.childCanvasId) : null;
      const preview = child?.workspaceId === workspace._id && child.parentCardId === card._id && child.parentCanvasId === canvasId
        ? await readPreview(ctx, child) : undefined;
      let imageUrl: string | null = null;
      if (card.imageStorageId) {
        const image = await ctx.db.query('images').withIndex('by_storageId', q => q.eq('storageId', card.imageStorageId!)).unique();
        if (image?.workspaceId === workspace._id) imageUrl = await ctx.storage.getUrl(card.imageStorageId);
      }
      return { _id: card._id, canvasId: card.canvasId, childCanvasId: card.childCanvasId, kind: card.kind, title: card.title, body: card.body, color: card.color, x: card.x, y: card.y, width: card.width, height: card.height, imageUrl, ...(card.url ? { url: card.url } : {}), ...(card.linkImage ? { linkImage: card.linkImage } : {}), ...(card.duration === undefined ? {} : { duration: card.duration }), ...(card.latitude === undefined || card.longitude === undefined ? {} : { latitude: card.latitude, longitude: card.longitude }), ...(preview ? { preview } : {}) };
    })),
    connectors: connectors.filter(item => live.has(item.fromCardId) && live.has(item.toCardId)).map(({ _id, fromCardId, toCardId, color }) => ({ _id, fromCardId, toCardId, ...(color ? { color } : {}) })),
    breadcrumbs,
  };
}

/** A canvas's ink. Call only after `requireCanvas` has allowed the canvas. */
async function readStrokes(ctx: QueryCtx, canvasId: Id<'canvases'>) {
  const strokes = await ctx.db.query('strokes').withIndex('by_canvasId_and_deleted', q => q.eq('canvasId', canvasId).eq('deleted', false)).take(MAX_STROKES);
  return strokes.map(stroke => ({ _id: stroke._id, canvasId: stroke.canvasId, path: stroke.path, color: stroke.color, width: stroke.width }));
}

/** The whole canvas in one answer. The app reads `cards` and `strokes` separately; this stays for scripts and older builds. */
export const get = query({
  args: { canvasId: v.id('canvases') },
  returns: v.object({ ...canvasShape, strokes: v.array(publicStroke) }),
  handler: async (ctx, { canvasId }) => {
    const { canvas, workspace } = await requireCanvas(ctx, canvasId);
    const [rest, strokes] = await Promise.all([readCards(ctx, canvas, workspace), readStrokes(ctx, canvasId)]);
    return { ...rest, strokes };
  },
});

/**
 * A canvas without its ink: cards, connectors, and where it sits. Ink can be most of a
 * canvas's size and changes far less often than cards do, so it is read on its own and
 * moving a card does not send every line again.
 */
export const cards = query({
  args: { canvasId: v.id('canvases') },
  returns: v.object(canvasShape),
  handler: async (ctx, { canvasId }) => {
    const { canvas, workspace } = await requireCanvas(ctx, canvasId);
    return readCards(ctx, canvas, workspace);
  },
});

/** The ink on a canvas, behind the same check as its cards. */
export const strokes = query({
  args: { canvasId: v.id('canvases') },
  returns: v.array(publicStroke),
  handler: async (ctx, { canvasId }) => {
    await requireCanvas(ctx, canvasId);
    return readStrokes(ctx, canvasId);
  },
});
