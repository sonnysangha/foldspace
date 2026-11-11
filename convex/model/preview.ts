import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

/** How much of a canvas a thumbnail shows. Enough to recognise it, small enough to stay cheap. */
const PREVIEW_CARDS = 12;
const PREVIEW_STROKES = 12;

/**
 * Call only after authorizing the canvas or its parent card. Photos are included so a
 * thumbnail looks like the canvas it stands for; each one is checked against the
 * canvas's own workspace before its URL is handed out.
 */
export async function readPreview(ctx: QueryCtx, canvas: Doc<'canvases'>) {
  const [cards, strokes] = await Promise.all([
    ctx.db.query('cards').withIndex('by_canvasId_and_deleted', q => q.eq('canvasId', canvas._id).eq('deleted', false)).take(PREVIEW_CARDS),
    ctx.db.query('strokes').withIndex('by_canvasId_and_deleted', q => q.eq('canvasId', canvas._id).eq('deleted', false)).take(PREVIEW_STROKES),
  ]);
  return {
    cardCount: canvas.cardCount, strokeCount: canvas.strokeCount,
    cards: await Promise.all(cards.map(async ({ _id, kind, title, body, color, x, y, width, height, imageStorageId, linkImage }) => {
      let imageUrl: string | null = null;
      if (imageStorageId && kind !== 'audio') {
        const image = await ctx.db.query('images').withIndex('by_storageId', q => q.eq('storageId', imageStorageId)).unique();
        if (image?.workspaceId === canvas.workspaceId) imageUrl = await ctx.storage.getUrl(imageStorageId);
      }
      if (linkImage) imageUrl = linkImage;
      return { _id, kind, title: title.slice(0, 100), body: body.slice(0, 180), color, x, y, width, height, ...(imageUrl ? { imageUrl } : {}) };
    })),
    strokes: strokes.map(({ path, color, width }) => ({ path, color, width })),
  };
}
