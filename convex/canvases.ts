import { v } from 'convex/values';
import { query } from './_generated/server';
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

export const get = query({
  args: { canvasId: v.id('canvases') },
  returns: v.object({
    canvas: v.object({ _id: v.id('canvases'), title: v.string(), parentCanvasId: v.union(v.id('canvases'), v.null()), parentCardId: v.union(v.id('cards'), v.null()) }),
    workspace: v.object({ _id: v.id('workspaces'), title: v.string(), color: v.string(), rootCanvasId: v.id('canvases') }),
    cards: v.array(publicCard), strokes: v.array(publicStroke),
    connectors: v.array(v.object({ _id: v.id('connectors'), fromCardId: v.id('cards'), toCardId: v.id('cards'), color: v.optional(v.string()) })),
    breadcrumbs: v.array(v.object({ _id: v.id('canvases'), title: v.string() })),
  }),
  handler: async (ctx, { canvasId }) => {
    const { canvas, workspace, identity } = await requireCanvas(ctx, canvasId);
    const [cards, strokes, connectors] = await Promise.all([
      ctx.db.query('cards').withIndex('by_canvasId_and_deleted', q => q.eq('canvasId', canvasId).eq('deleted', false)).take(MAX_CARDS),
      ctx.db.query('strokes').withIndex('by_canvasId_and_deleted', q => q.eq('canvasId', canvasId).eq('deleted', false)).take(MAX_STROKES),
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
      strokes: strokes.map(stroke => ({ _id: stroke._id, canvasId: stroke.canvasId, path: stroke.path, color: stroke.color, width: stroke.width })),
      connectors: connectors.filter(item => live.has(item.fromCardId) && live.has(item.toCardId)).map(({ _id, fromCardId, toCardId, color }) => ({ _id, fromCardId, toCardId, ...(color ? { color } : {}) })),
      breadcrumbs,
    };
  },
});
