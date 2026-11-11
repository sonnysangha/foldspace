import { v } from 'convex/values';
import { mutation } from './_generated/server';
import { colorValue, fail, requireCanvas, requireCard } from './model/auth';

/** How many connectors one canvas may hold. */
export const MAX_CONNECTORS = 400;

/**
 * Connects two cards on the same canvas, or removes the connector if they are already
 * joined in either direction. Calling it again undoes it, which is what the app's Undo does.
 */
export const toggle = mutation({
  args: { canvasId: v.id('canvases'), fromCardId: v.id('cards'), toCardId: v.id('cards'), color: v.optional(v.string()) },
  returns: v.union(v.literal('added'), v.literal('removed')),
  handler: async (ctx, args) => {
    const { canvas, workspace } = await requireCanvas(ctx, args.canvasId);
    if (args.fromCardId === args.toCardId) fail('INVALID_INPUT', 'Choose two different cards to connect.');
    const [from, to] = await Promise.all([requireCard(ctx, args.fromCardId), requireCard(ctx, args.toCardId)]);
    if (from.card.canvasId !== canvas._id || to.card.canvasId !== canvas._id) fail('INVALID_INPUT', 'Both cards must be on this canvas.');
    const existing = await ctx.db.query('connectors').withIndex('by_canvasId', q => q.eq('canvasId', canvas._id)).take(MAX_CONNECTORS);
    const match = existing.find(item => (item.fromCardId === args.fromCardId && item.toCardId === args.toCardId) || (item.fromCardId === args.toCardId && item.toCardId === args.fromCardId));
    if (match) {
      await ctx.db.delete(match._id);
      return 'removed' as const;
    }
    if (existing.length >= MAX_CONNECTORS) fail('LIMIT_REACHED', 'This canvas has reached its connector limit.');
    await ctx.db.insert('connectors', {
      workspaceId: workspace._id, canvasId: canvas._id, fromCardId: args.fromCardId, toCardId: args.toCardId,
      ...(args.color ? { color: colorValue(args.color) } : {}), createdAt: Date.now(),
    });
    await ctx.db.patch(workspace._id, { updatedAt: Date.now() });
    return 'added' as const;
  },
});
