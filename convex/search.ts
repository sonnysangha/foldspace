import { ConvexError, v } from 'convex/values';
import { query, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { MAX_WORKSPACES, requireCanvas, requireIdentity, requireWorkspace } from './model/auth';
import { cardKind } from './validators';

const match = {
  _id: v.id('cards'), canvasId: v.id('canvases'), title: v.string(), body: v.string(),
  kind: cardKind, color: v.string(), canvasTitle: v.string(),
};

/** Cards in one space whose title or note matches, leaving out any inside a deleted card. */
async function matches(ctx: QueryCtx, workspaceId: Id<'workspaces'>, term: string, limit: number) {
  const [titles, notes] = await Promise.all([
    ctx.db.query('cards').withSearchIndex('search_title', q => q.search('title', term).eq('workspaceId', workspaceId).eq('deleted', false)).take(limit),
    ctx.db.query('cards').withSearchIndex('search_body', q => q.search('body', term).eq('workspaceId', workspaceId).eq('deleted', false)).take(limit),
  ]);
  const unique = [...new Map([...titles, ...notes].map(card => [card._id, card])).values()];
  const visible = await Promise.all(unique.map(async card => {
    try {
      const { canvas } = await requireCanvas(ctx, card.canvasId);
      return { _id: card._id, canvasId: card.canvasId, title: card.title, body: card.body.slice(0, 240), kind: card.kind, color: card.color, canvasTitle: canvas.title };
    } catch (error) {
      if (error instanceof ConvexError && typeof error.data === 'object' && error.data?.code === 'NOT_FOUND') return null;
      throw error;
    }
  }));
  return visible.filter(card => card !== null).slice(0, limit);
}

export const cards = query({
  args: { workspaceId: v.id('workspaces'), text: v.string() },
  returns: v.array(v.object(match)),
  handler: async (ctx, { workspaceId, text }) => {
    await requireWorkspace(ctx, workspaceId);
    const term = text.trim().slice(0, 120);
    if (term.length < 2) return [];
    return await matches(ctx, workspaceId, term, 24);
  },
});

/** Search from the library: a few matches from each of the signed-in person's recent spaces. */
const SPACES_SEARCHED = 24;
const PER_SPACE = 4;

export const everywhere = query({
  args: { text: v.string() },
  returns: v.array(v.object({ ...match, workspaceId: v.id('workspaces'), workspaceTitle: v.string(), workspaceColor: v.string() })),
  handler: async (ctx, { text }) => {
    const identity = await requireIdentity(ctx);
    const term = text.trim().slice(0, 120);
    if (term.length < 2) return [];
    const spaces = (await ctx.db.query('workspaces')
      .withIndex('by_ownerId_and_deleted', q => q.eq('ownerId', identity.subject).eq('deleted', false))
      .take(MAX_WORKSPACES))
      .filter(space => space.rootCanvasId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, SPACES_SEARCHED);
    const found = await Promise.all(spaces.map(async space =>
      (await matches(ctx, space._id, term, PER_SPACE)).map(card => ({ ...card, workspaceId: space._id, workspaceTitle: space.title, workspaceColor: space.color }))));
    return found.flat();
  },
});
