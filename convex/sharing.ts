import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { fail, MAX_MEMBERS, requireIdentity, requireOwner, requireWorkspace, textValue } from './model/auth';

// No 0/O or 1/I/L, so a code survives being read aloud or typed from a screenshot.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;
const MAX_WRONG_CODES = 8;
const WRONG_CODE_WINDOW = 15 * 60 * 1000;

/** About 59 bits. Bytes that would favour the start of the alphabet are thrown away, so every letter is equally likely. */
function newCode() {
  const fair = 256 - (256 % ALPHABET.length);
  let code = '';
  while (code.length < CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(CODE_LENGTH * 2))) {
      if (byte < fair && code.length < CODE_LENGTH) code += ALPHABET[byte % ALPHABET.length];
    }
  }
  return code;
}

/** Codes are shown in three groups of four. Accept them with or without the dashes, in any case. */
function normalise(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * What the others in a space see you as. The token's name wins when the Clerk JWT carries one;
 * otherwise it is the name the app passes from the signed-in Clerk user. It labels a person and grants nothing.
 */
function displayName(identity: { name?: string; givenName?: string }, given?: string) {
  return (identity.name || identity.givenName || given?.trim() || 'Someone').slice(0, 80);
}

export const status = query({
  args: { workspaceId: v.id('workspaces') },
  returns: v.object({
    role: v.union(v.literal('owner'), v.literal('member')),
    title: v.string(),
    /** Only the owner sees the invite code. */
    code: v.union(v.string(), v.null()),
    ownerName: v.union(v.string(), v.null()),
    members: v.array(v.object({ userId: v.string(), name: v.string(), isYou: v.boolean() })),
  }),
  handler: async (ctx, { workspaceId }) => {
    const { workspace, identity, role } = await requireWorkspace(ctx, workspaceId);
    const members = await ctx.db.query('members')
      .withIndex('by_workspaceId_and_userId', q => q.eq('workspaceId', workspaceId))
      .take(MAX_MEMBERS);
    return {
      role,
      title: workspace.title,
      code: role === 'owner' ? workspace.shareCode ?? null : null,
      ownerName: workspace.ownerName ?? null,
      members: members.map(member => ({ userId: member.userId, name: member.name, isYou: member.userId === identity.subject })),
    };
  },
});

/** Opens an invite. Calling it again returns the same code, so a link already sent keeps working. */
export const enable = mutation({
  args: { workspaceId: v.id('workspaces'), name: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, { workspaceId, name }) => {
    const { workspace, identity } = await requireOwner(ctx, workspaceId);
    if (workspace.shareCode) return workspace.shareCode;
    const code = newCode();
    await ctx.db.patch(workspace._id, { shareCode: code, ownerName: displayName(identity, name) });
    return code;
  },
});

/** Closes the invite and removes everyone who joined. */
export const disable = mutation({
  args: { workspaceId: v.id('workspaces') },
  returns: v.null(),
  handler: async (ctx, { workspaceId }) => {
    const { workspace } = await requireOwner(ctx, workspaceId);
    const members = await ctx.db.query('members')
      .withIndex('by_workspaceId_and_userId', q => q.eq('workspaceId', workspaceId))
      .take(MAX_MEMBERS);
    for (const member of members) await ctx.db.delete(member._id);
    await ctx.db.patch(workspace._id, { shareCode: undefined });
    return null;
  },
});

export const join = mutation({
  args: { code: v.string(), name: v.optional(v.string()) },
  // null means no space has that code. It is a result, not an error, so the wrong guess is still counted.
  returns: v.union(v.object({ _id: v.id('workspaces'), title: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const code = normalise(textValue(args.code, 'Code', 40));
    if (code.length !== CODE_LENGTH) fail('INVALID_INPUT', 'That code is not complete. It has twelve letters and numbers.');
    const now = Date.now();
    const attempts = await ctx.db.query('joinAttempts').withIndex('by_userId', q => q.eq('userId', identity.subject)).unique();
    const recent = attempts && now - attempts.windowStart < WRONG_CODE_WINDOW ? attempts.count : 0;
    if (recent >= MAX_WRONG_CODES) fail('LIMIT_REACHED', 'Too many wrong codes. Wait a few minutes and try again.');
    const workspace = await ctx.db.query('workspaces').withIndex('by_shareCode', q => q.eq('shareCode', code)).unique();
    if (!workspace || workspace.deleted || !workspace.rootCanvasId) {
      if (attempts) await ctx.db.patch(attempts._id, recent ? { count: recent + 1 } : { windowStart: now, count: 1 });
      else await ctx.db.insert('joinAttempts', { userId: identity.subject, windowStart: now, count: 1 });
      return null;
    }
    const result = { _id: workspace._id, title: workspace.title };
    if (workspace.ownerId === identity.subject) return result;
    const members = await ctx.db.query('members')
      .withIndex('by_workspaceId_and_userId', q => q.eq('workspaceId', workspace._id))
      .take(MAX_MEMBERS);
    if (members.some(member => member.userId === identity.subject)) return result;
    if (members.length >= MAX_MEMBERS) fail('LIMIT_REACHED', 'This space is full.');
    await ctx.db.insert('members', { workspaceId: workspace._id, userId: identity.subject, name: displayName(identity, args.name), joinedAt: Date.now() });
    return result;
  },
});

export const leave = mutation({
  args: { workspaceId: v.id('workspaces') },
  returns: v.null(),
  handler: async (ctx, { workspaceId }) => {
    const identity = await requireIdentity(ctx);
    const member = await ctx.db.query('members')
      .withIndex('by_workspaceId_and_userId', q => q.eq('workspaceId', workspaceId).eq('userId', identity.subject))
      .unique();
    if (member) await ctx.db.delete(member._id);
    return null;
  },
});

export const removeMember = mutation({
  args: { workspaceId: v.id('workspaces'), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { workspaceId, userId }) => {
    await requireOwner(ctx, workspaceId);
    const member = await ctx.db.query('members')
      .withIndex('by_workspaceId_and_userId', q => q.eq('workspaceId', workspaceId).eq('userId', userId))
      .unique();
    if (member) await ctx.db.delete(member._id);
    return null;
  },
});
