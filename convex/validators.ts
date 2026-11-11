import { v } from 'convex/values';

/**
 * note: a title and a description. canvas: a space you step into. image, link: media.
 * checklist: tick-box lines in the body. audio: a recorded voice note. place: a pin on a map.
 */
export const cardKind = v.union(v.literal('note'), v.literal('canvas'), v.literal('image'), v.literal('link'), v.literal('checklist'), v.literal('audio'), v.literal('place'));

export const canvasPreview = v.object({
  cardCount: v.number(),
  strokeCount: v.number(),
  cards: v.array(v.object({
    _id: v.id('cards'), kind: cardKind, title: v.string(), body: v.string(), color: v.string(),
    x: v.number(), y: v.number(), width: v.number(), height: v.number(),
    imageUrl: v.optional(v.string()),
  })),
  strokes: v.array(v.object({ path: v.string(), color: v.string(), width: v.number() })),
});

export const workspaceSummary = v.object({
  _id: v.id('workspaces'),
  title: v.string(),
  color: v.string(),
  rootCanvasId: v.id('canvases'),
  updatedAt: v.number(),
  createdAt: v.number(),
  /** Cards and spaces on the space's top canvas. */
  cardCount: v.number(),
  isDemo: v.boolean(),
  pinned: v.boolean(),
  /** owner: yours. member: someone shared it with you. */
  role: v.union(v.literal('owner'), v.literal('member')),
  /** True while the owner has an invite open or anyone has joined. */
  shared: v.boolean(),
  ownerName: v.optional(v.string()),
});

export const publicCard = v.object({
  _id: v.id('cards'),
  canvasId: v.id('canvases'),
  childCanvasId: v.id('canvases'),
  kind: cardKind,
  title: v.string(),
  body: v.string(),
  color: v.string(),
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
  imageUrl: v.union(v.string(), v.null()),
  url: v.optional(v.string()),
  linkImage: v.optional(v.string()),
  duration: v.optional(v.number()),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
  preview: v.optional(canvasPreview),
});

export const publicStroke = v.object({
  _id: v.id('strokes'),
  canvasId: v.id('canvases'),
  path: v.string(),
  color: v.string(),
  width: v.number(),
});
