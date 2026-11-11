import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { colorValue, fail, MAX_CARDS, MAX_DEPTH, numberValue, requireCanvas, textValue } from './auth';

export type NewCard = {
  canvasId: Id<'canvases'>;
  kind: 'note' | 'canvas' | 'image' | 'link' | 'checklist' | 'audio' | 'place';
  title: string;
  body: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  imageStorageId?: Id<'_storage'>;
  url?: string;
  /** Length of a voice note, in seconds. */
  duration?: number;
  latitude?: number;
  longitude?: number;
};

/** Only web addresses, so opening a link card can never launch another app's scheme. */
export function linkValue(value: string) {
  const result = value.trim();
  if (result.length > 2_000 || !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(result)) fail('INVALID_INPUT', 'Enter a web address that starts with http:// or https://.');
  return result;
}

export async function insertCard(ctx: MutationCtx, args: NewCard) {
  const { canvas, workspace, identity } = await requireCanvas(ctx, args.canvasId);
  if (canvas.cardCount >= MAX_CARDS) fail('LIMIT_REACHED', 'This canvas has reached its card limit.');
  if (canvas.depth >= MAX_DEPTH) fail('LIMIT_REACHED', 'This canvas has reached its nesting limit.');
  const title = textValue(args.title, 'Title', 160);
  const body = textValue(args.body, 'Note', 8_000, true);
  const color = colorValue(args.color);
  const x = numberValue(args.x, 'X position', -100_000, 100_000);
  const y = numberValue(args.y, 'Y position', -100_000, 100_000);
  const width = numberValue(args.width, 'Width', 80, 2_000);
  const height = numberValue(args.height, 'Height', 60, 2_000);
  if (args.imageStorageId) {
    const image = await ctx.db.query('images').withIndex('by_storageId', q => q.eq('storageId', args.imageStorageId!)).unique();
    if (!image || image.workspaceId !== workspace._id) fail('NOT_FOUND', 'This image is unavailable.');
  }
  if (args.kind === 'image' && !args.imageStorageId) fail('INVALID_INPUT', 'Upload an image before adding it.');
  if (args.kind === 'audio' && !args.imageStorageId) fail('INVALID_INPUT', 'Upload a recording before adding it.');
  const duration = args.kind === 'audio' ? numberValue(args.duration ?? 0, 'Duration', 0, 3_600) : undefined;
  if (args.kind === 'place' && (args.latitude === undefined || args.longitude === undefined)) fail('INVALID_INPUT', 'Choose a place on the map.');
  const place = args.kind === 'place'
    ? { latitude: numberValue(args.latitude!, 'Latitude', -90, 90), longitude: numberValue(args.longitude!, 'Longitude', -180, 180) } : {};
  if (args.kind === 'link' && !args.url) fail('INVALID_INPUT', 'Add a web address for this link.');
  const url = args.kind === 'link' && args.url ? linkValue(args.url) : undefined;
  const now = Date.now();
  const childCanvasId = await ctx.db.insert('canvases', {
    workspaceId: workspace._id, title, parentCanvasId: canvas._id, parentCardId: null,
    depth: canvas.depth + 1, cardCount: 0, strokeCount: 0, createdAt: now,
  });
  const id = await ctx.db.insert('cards', {
    workspaceId: workspace._id, canvasId: canvas._id, childCanvasId, kind: args.kind,
    title, body, color, x, y, width, height,
    ...(args.imageStorageId ? { imageStorageId: args.imageStorageId } : {}),
    ...(url ? { url } : {}),
    ...(duration === undefined ? {} : { duration }),
    ...place,
    deleted: false, createdAt: now, updatedAt: now,
  });
  await ctx.db.patch(childCanvasId, { parentCardId: id });
  await ctx.db.patch(canvas._id, { cardCount: canvas.cardCount + 1 });
  await ctx.db.patch(workspace._id, { updatedAt: now });
  return { _id: id, childCanvasId };
}
