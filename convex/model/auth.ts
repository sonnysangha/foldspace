import { ConvexError } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

type DbCtx = QueryCtx | MutationCtx;
export const MAX_DEPTH = 12;
export const MAX_CARDS = 200;
export const MAX_STROKES = 500;
export const MAX_WORKSPACES = 100;
export const MAX_MEMBERS = 20;

export function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

export async function requireIdentity(ctx: Pick<QueryCtx, 'auth'>) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) fail('UNAUTHENTICATED', 'Sign in to use your canvases.');
  return identity;
}

export async function ensureUser(ctx: MutationCtx) {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db.query('users').withIndex('by_subject', q => q.eq('subject', identity.subject)).unique();
  if (!user) await ctx.db.insert('users', { subject: identity.subject, createdAt: Date.now() });
  return identity;
}

export async function requireWorkspace(ctx: DbCtx, id: Id<'workspaces'>) {
  const identity = await requireIdentity(ctx);
  const workspace = await ctx.db.get(id);
  if (!workspace || workspace.deleted || !workspace.rootCanvasId) fail('NOT_FOUND', 'This workspace is unavailable.');
  if (workspace.ownerId === identity.subject) return { workspace, identity, role: 'owner' as const };
  const member = await ctx.db.query('members')
    .withIndex('by_workspaceId_and_userId', q => q.eq('workspaceId', id).eq('userId', identity.subject))
    .unique();
  if (!member) fail('NOT_FOUND', 'This workspace is unavailable.');
  return { workspace, identity, role: 'member' as const };
}

/** For managing the space itself: its name, colour, pin and who it is shared with. */
export async function requireOwner(ctx: DbCtx, id: Id<'workspaces'>) {
  const result = await requireWorkspace(ctx, id);
  if (result.role !== 'owner') fail('FORBIDDEN', 'Only the owner can change this space.');
  return result;
}

export async function requireCanvas(ctx: DbCtx, id: Id<'canvases'>) {
  await requireIdentity(ctx);
  const canvas = await ctx.db.get(id);
  if (!canvas) fail('NOT_FOUND', 'This canvas is unavailable.');
  const { workspace, identity } = await requireWorkspace(ctx, canvas.workspaceId);
  let ancestor = canvas;
  const seen = new Set<string>();
  for (let i = 0; i <= MAX_DEPTH; i += 1) {
    if (seen.has(ancestor._id) || ancestor.workspaceId !== workspace._id) fail('NOT_FOUND', 'This canvas is unavailable.');
    seen.add(ancestor._id);
    if (ancestor.parentCanvasId === null) {
      if (ancestor._id !== workspace.rootCanvasId || ancestor.parentCardId !== null) fail('NOT_FOUND', 'This canvas is unavailable.');
      return { canvas, workspace, identity };
    }
    if (!ancestor.parentCardId) fail('NOT_FOUND', 'This canvas is unavailable.');
    const parentCard = await ctx.db.get(ancestor.parentCardId);
    if (!parentCard || parentCard.deleted || parentCard.workspaceId !== workspace._id ||
      parentCard.canvasId !== ancestor.parentCanvasId || parentCard.childCanvasId !== ancestor._id) {
      fail('NOT_FOUND', 'This canvas is unavailable.');
    }
    const parent = await ctx.db.get(ancestor.parentCanvasId);
    if (!parent) fail('NOT_FOUND', 'This canvas is unavailable.');
    ancestor = parent;
  }
  fail('NOT_FOUND', 'This canvas is unavailable.');
}

export async function requireCard(ctx: DbCtx, id: Id<'cards'>) {
  await requireIdentity(ctx);
  const card = await ctx.db.get(id);
  if (!card || card.deleted) fail('NOT_FOUND', 'This card is unavailable.');
  const result = await requireCanvas(ctx, card.canvasId);
  if (card.workspaceId !== result.workspace._id) fail('NOT_FOUND', 'This card is unavailable.');
  return { ...result, card };
}

export function textValue(value: string, label: string, max: number, allowEmpty = false) {
  const result = value.trim();
  if ((!allowEmpty && !result) || result.length > max) fail('INVALID_INPUT', `${label} must be ${allowEmpty ? 'at most' : 'between 1 and'} ${max} characters.`);
  return result;
}

export function colorValue(value: string) {
  if (!/^#[\da-fA-F]{6}$/.test(value)) fail('INVALID_INPUT', 'Choose a valid six-digit color.');
  return value.toUpperCase();
}

export function numberValue(value: number, label: string, min: number, max: number) {
  if (!Number.isFinite(value) || value < min || value > max) fail('INVALID_INPUT', `${label} is outside the supported range.`);
  return value;
}
