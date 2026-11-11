import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { requireWorkspace } from './model/auth';

export const authorizeUpload = internalQuery({
  args: { workspaceId: v.id('workspaces') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return null;
  },
});

export const registerUpload = internalMutation({
  args: { workspaceId: v.id('workspaces'), storageId: v.id('_storage'), contentType: v.string(), size: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { identity } = await requireWorkspace(ctx, args.workspaceId);
    await ctx.db.insert('images', {
      ...args, ownerId: identity.subject, createdAt: Date.now(),
    });
    return null;
  },
});
