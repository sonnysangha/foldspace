import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { cardKind } from './validators';

export default defineSchema({
  users: defineTable({ subject: v.string(), createdAt: v.number() })
    .index('by_subject', ['subject']),
  workspaces: defineTable({
    ownerId: v.string(),
    title: v.string(),
    color: v.string(),
    rootCanvasId: v.optional(v.id('canvases')),
    isDemo: v.boolean(),
    pinned: v.optional(v.boolean()),
    /** Set while the owner is sharing. Anyone signed in who has it can join. */
    shareCode: v.optional(v.string()),
    ownerName: v.optional(v.string()),
    /**
     * How many people have joined. Kept in step by every change to `members`, so listing
     * spaces need not look there. Absent on spaces made before it existed; those are
     * still answered from `members`.
     */
    memberCount: v.optional(v.number()),
    deleted: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_ownerId_and_deleted', ['ownerId', 'deleted'])
    .index('by_ownerId_and_deleted_and_isDemo', ['ownerId', 'deleted', 'isDemo'])
    .index('by_shareCode', ['shareCode']),
  /** People the owner has let into a space. They can read and edit its canvases, not manage the space. */
  members: defineTable({
    workspaceId: v.id('workspaces'),
    userId: v.string(),
    name: v.string(),
    joinedAt: v.number(),
  }).index('by_userId', ['userId'])
    .index('by_workspaceId_and_userId', ['workspaceId', 'userId']),
  /** Wrong invite codes a person has tried lately, so codes cannot be guessed at speed. */
  joinAttempts: defineTable({ userId: v.string(), windowStart: v.number(), count: v.number() })
    .index('by_userId', ['userId']),
  canvases: defineTable({
    workspaceId: v.id('workspaces'),
    title: v.string(),
    parentCanvasId: v.union(v.id('canvases'), v.null()),
    parentCardId: v.union(v.id('cards'), v.null()),
    depth: v.number(),
    cardCount: v.number(),
    strokeCount: v.number(),
    createdAt: v.number(),
  }).index('by_workspaceId', ['workspaceId']),
  cards: defineTable({
    workspaceId: v.id('workspaces'),
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
    imageStorageId: v.optional(v.id('_storage')),
    url: v.optional(v.string()),
    linkImage: v.optional(v.string()),
    duration: v.optional(v.number()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    deleted: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_canvasId_and_deleted', ['canvasId', 'deleted'])
    .searchIndex('search_title', { searchField: 'title', filterFields: ['workspaceId', 'deleted'] })
    .searchIndex('search_body', { searchField: 'body', filterFields: ['workspaceId', 'deleted'] }),
  strokes: defineTable({
    workspaceId: v.id('workspaces'),
    canvasId: v.id('canvases'),
    path: v.string(),
    color: v.string(),
    width: v.number(),
    deleted: v.boolean(),
    createdAt: v.number(),
  }).index('by_canvasId_and_deleted', ['canvasId', 'deleted']),
  connectors: defineTable({
    workspaceId: v.id('workspaces'),
    canvasId: v.id('canvases'),
    fromCardId: v.id('cards'),
    toCardId: v.id('cards'),
    color: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_canvasId', ['canvasId']),
  images: defineTable({
    ownerId: v.string(),
    workspaceId: v.id('workspaces'),
    storageId: v.id('_storage'),
    contentType: v.string(),
    size: v.number(),
    createdAt: v.number(),
  }).index('by_storageId', ['storageId']),
});
