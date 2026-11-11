import { v } from 'convex/values';
import { mutation } from './_generated/server';
import { colorValue, fail, MAX_STROKES, numberValue, requireCanvas, requireIdentity } from './model/auth';

export const create = mutation({
  args: { canvasId: v.id('canvases'), path: v.string(), color: v.string(), width: v.number() },
  returns: v.id('strokes'),
  handler: async (ctx, args) => {
    const { canvas, workspace } = await requireCanvas(ctx, args.canvasId);
    if (canvas.strokeCount >= MAX_STROKES) fail('LIMIT_REACHED', 'This canvas has reached its drawing limit.');
    if (!/^[Mm]/.test(args.path.trim()) || args.path.length > 8_000 || !/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/.test(args.path)) fail('INVALID_INPUT', 'This drawing path is invalid or too long.');
    const coordinates = args.path.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? [];
    if (!coordinates.length || coordinates.some(value => !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 100_000)) fail('INVALID_INPUT', 'Drawing coordinates are outside the canvas.');
    const id = await ctx.db.insert('strokes', {
      canvasId: canvas._id, workspaceId: workspace._id, path: args.path,
      color: colorValue(args.color), width: numberValue(args.width, 'Stroke width', 1, 64), deleted: false, createdAt: Date.now(),
    });
    await ctx.db.patch(canvas._id, { strokeCount: canvas.strokeCount + 1 });
    await ctx.db.patch(workspace._id, { updatedAt: Date.now() });
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id('strokes') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireIdentity(ctx);
    const stroke = await ctx.db.get(args.id);
    if (!stroke) fail('NOT_FOUND', 'This drawing is unavailable.');
    const { canvas, workspace } = await requireCanvas(ctx, stroke.canvasId);
    if (stroke.workspaceId !== workspace._id) fail('NOT_FOUND', 'This drawing is unavailable.');
    if (stroke.deleted) return null;
    await ctx.db.patch(stroke._id, { deleted: true });
    await ctx.db.patch(canvas._id, { strokeCount: Math.max(0, canvas.strokeCount - 1) });
    await ctx.db.patch(workspace._id, { updatedAt: Date.now() });
    return null;
  },
});

export const restore = mutation({
  args: { id: v.id('strokes') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireIdentity(ctx);
    const stroke = await ctx.db.get(args.id);
    if (!stroke) fail('NOT_FOUND', 'This drawing is unavailable.');
    const { canvas, workspace } = await requireCanvas(ctx, stroke.canvasId);
    if (stroke.workspaceId !== workspace._id) fail('NOT_FOUND', 'This drawing is unavailable.');
    if (!stroke.deleted) return null;
    if (canvas.strokeCount >= MAX_STROKES) fail('LIMIT_REACHED', 'This canvas has reached its drawing limit.');
    await ctx.db.patch(stroke._id, { deleted: false });
    await ctx.db.patch(canvas._id, { strokeCount: canvas.strokeCount + 1 });
    await ctx.db.patch(workspace._id, { updatedAt: Date.now() });
    return null;
  },
});

/** An eraser gesture is one transaction and one undo action. */
export const setDeleted = mutation({
  args: { canvasId: v.id('canvases'), ids: v.array(v.id('strokes')), deleted: v.boolean() },
  returns: v.array(v.id('strokes')),
  handler: async (ctx, { canvasId, ids, deleted }) => {
    const { canvas, workspace } = await requireCanvas(ctx, canvasId);
    if (ids.length > MAX_STROKES) fail('INVALID_INPUT', 'Too many strokes in one change.');
    const rows = await Promise.all([...new Set(ids)].map(id => ctx.db.get(id)));
    for (const row of rows) {
      if (!row || row.canvasId !== canvasId || row.workspaceId !== workspace._id) fail('NOT_FOUND', 'This drawing is unavailable.');
    }
    const changes = rows.filter(row => row && row.deleted !== deleted);
    const count = canvas.strokeCount + changes.length * (deleted ? -1 : 1);
    if (count > MAX_STROKES) fail('LIMIT_REACHED', 'This canvas has reached its drawing limit.');
    for (const row of changes) await ctx.db.patch(row!._id, { deleted });
    await ctx.db.patch(canvasId, { strokeCount: Math.max(0, count) });
    if (changes.length) await ctx.db.patch(workspace._id, { updatedAt: Date.now() });
    return changes.map(row => row!._id);
  },
});
