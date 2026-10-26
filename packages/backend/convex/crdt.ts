import * as Y from "yjs"
import { enqueueBackup } from "./lib/crdtBackup"
import { internal } from "./_generated/api"
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server"
import { ConvexError, v } from "convex/values"
import { requireProjectMembership } from "./lib/auth"

const MAX_UPDATE_BYTES = 512 * 1024
const MAX_REPLAY_BYTES = 900 * 1024
const MAX_REPLAY_UPDATES = 100

export const appendUpdate = mutation({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    updateId: v.string(),
    documentId: v.optional(v.id("crdtDocuments")),
    bytes: v.bytes(),
  },
  handler: async (ctx, args) => {
    const { identity, project } = await requireProjectMembership(
      ctx,
      args.projectId
    )
    if (project.repositoryStatus !== "ready") {
      throw new ConvexError("The program repository is not ready yet.")
    }
    if (args.updateId.length < 8 || args.updateId.length > 128) {
      throw new ConvexError("Update ID must be between 8 and 128 characters.")
    }
    if (
      args.bytes.byteLength === 0 ||
      args.bytes.byteLength > MAX_UPDATE_BYTES
    ) {
      throw new ConvexError("CRDT updates must be between 1 byte and 512 KiB.")
    }

    const file = await ctx.db
      .query("files")
      .withIndex("by_project_path", (q) =>
        q.eq("projectId", args.projectId).eq("path", args.path)
      )
      .unique()
    if (!file) {
      throw new ConvexError("File not found.")
    }

    const document = await ctx.db
      .query("crdtDocuments")
      .withIndex("by_project_path", (q) =>
        q.eq("projectId", args.projectId).eq("path", file.path)
      )
      .unique()
    const now = Date.now()
    if (!document) {
      throw new ConvexError("Open the live document before editing.")
    }
    if (args.documentId && args.documentId !== document._id)
      throw new ConvexError("This file was replaced. Reopen it before editing.")
    try {
      Y.decodeUpdate(new Uint8Array(args.bytes))
    } catch {
      throw new ConvexError("Invalid Yjs update.")
    }

    const duplicate = await ctx.db
      .query("crdtUpdates")
      .withIndex("by_document_update", (q) =>
        q.eq("documentId", document._id).eq("updateId", args.updateId)
      )
      .unique()
    if (duplicate) {
      if (!bytesEqual(duplicate.bytes, args.bytes)) {
        throw new ConvexError(
          "Update ID has already been used for different bytes."
        )
      }
      if (duplicate.storageStatus === "failed") {
        await ctx.db.patch(duplicate._id, {
          storageStatus: "pending",
          projectId: args.projectId,
          storageError: undefined,
        })
        await enqueueBackup(ctx, args.projectId)
      }
      return { sequence: duplicate.sequence, duplicate: true }
    }

    const sequence = document.lastSequence + 1
    await ctx.db.patch(document._id, { lastSequence: sequence, updatedAt: now })
    await ctx.db.insert("crdtUpdates", {
      projectId: args.projectId,
      documentId: document._id,
      sequence,
      updateId: args.updateId,
      actorId: identity.subject,
      bytes: args.bytes,
      storageStatus: "pending",
      createdAt: now,
    })

    await enqueueBackup(ctx, args.projectId)

    return { sequence, duplicate: false }
  },
})

export const updatesSince = query({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    afterSequence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireProjectMembership(ctx, args.projectId)
    const document = await ctx.db
      .query("crdtDocuments")
      .withIndex("by_project_path", (q) =>
        q.eq("projectId", args.projectId).eq("path", args.path)
      )
      .unique()

    if (!document) {
      return { documentId: null, lastSequence: 0, updates: [], hasMore: false }
    }

    const afterSequence = args.afterSequence ?? 0
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new ConvexError("Sequence must be a non-negative integer.")
    }
    const candidates = await ctx.db
      .query("crdtUpdates")
      .withIndex("by_document_sequence", (q) =>
        q.eq("documentId", document._id).gt("sequence", afterSequence)
      )
      .order("asc")
      .take(MAX_REPLAY_UPDATES + 1)

    const updates = []
    let responseBytes = 0
    for (const update of candidates) {
      if (
        updates.length >= MAX_REPLAY_UPDATES ||
        responseBytes + update.bytes.byteLength > MAX_REPLAY_BYTES
      ) {
        break
      }
      updates.push(update)
      responseBytes += update.bytes.byteLength
    }

    return {
      documentId: document._id,
      lastSequence: document.lastSequence,
      updates,
      hasMore: candidates.length > updates.length,
    }
  },
})

export const retryPersistence = mutation({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    updateId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProjectMembership(ctx, args.projectId)
    const document = await ctx.db
      .query("crdtDocuments")
      .withIndex("by_project_path", (q) =>
        q.eq("projectId", args.projectId).eq("path", args.path)
      )
      .unique()
    if (!document) {
      throw new ConvexError("Live document not found.")
    }

    const update = await ctx.db
      .query("crdtUpdates")
      .withIndex("by_document_update", (q) =>
        q.eq("documentId", document._id).eq("updateId", args.updateId)
      )
      .unique()
    if (!update) {
      throw new ConvexError("CRDT update not found.")
    }
    if (update.storageStatus === "persisted") {
      return { queued: false }
    }

    await ctx.db.patch(update._id, {
      projectId: args.projectId,
      storageStatus: "pending",
      storageError: undefined,
    })
    await enqueueBackup(ctx, args.projectId)
    return { queued: true }
  },
})

export const getUpdateForStorage = internalQuery({
  args: { updateRowId: v.id("crdtUpdates") },
  handler: async (ctx, { updateRowId }) => {
    const update = await ctx.db.get(updateRowId)
    if (!update) return null
    const document = await ctx.db.get(update.documentId)
    if (!document) return null
    const project = await ctx.db.get(document.projectId)
    if (!project) return null
    return { update, document, project }
  },
})

export const markUpdatePersisted = internalMutation({
  args: {
    updateRowId: v.id("crdtUpdates"),
    commitSha: v.string(),
  },
  handler: async (ctx, { updateRowId, commitSha }) => {
    const update = await ctx.db.get(updateRowId)
    if (!update) return
    await ctx.db.patch(updateRowId, {
      storageStatus: "persisted",
      storageCommitSha: commitSha,
      storageError: undefined,
    })
  },
})

export const markUpdatePersistenceFailed = internalMutation({
  args: { updateRowId: v.id("crdtUpdates"), message: v.string() },
  handler: async (ctx, { updateRowId, message }) => {
    const update = await ctx.db.get(updateRowId)
    if (!update) return
    await ctx.db.patch(updateRowId, {
      storageStatus: "failed",
      storageError: message.slice(0, 500),
    })
  },
})

function bytesEqual(left: ArrayBuffer, right: ArrayBuffer) {
  if (left.byteLength !== right.byteLength) return false
  const leftBytes = new Uint8Array(left)
  const rightBytes = new Uint8Array(right)
  return leftBytes.every((byte, index) => byte === rightBytes[index])
}

// Only the storage action can seed a document. Concurrent opens share the
// winner's Yjs identifiers, so the original source is inserted exactly once.
export const initializeDocument = internalMutation({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    bytes: v.optional(v.bytes()),
    contents: v.optional(v.string()),
    actorId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("crdtDocuments")
      .withIndex("by_project_path", (q) =>
        q.eq("projectId", args.projectId).eq("path", args.path)
      )
      .unique()
    if (existing) return existing._id
    let bytes = args.bytes
    if (!bytes) {
      if (args.contents === undefined) throw new ConvexError("Missing source.")
      const seed = new Y.Doc()
      try {
        seed.getText("source").insert(0, args.contents)
        bytes = Y.encodeStateAsUpdate(seed).buffer as ArrayBuffer
      } finally {
        seed.destroy()
      }
    }
    if (bytes.byteLength > MAX_UPDATE_BYTES) {
      throw new ConvexError("This file is too large for live editing.")
    }
    const file = await ctx.db
      .query("files")
      .withIndex("by_project_path", (q) =>
        q.eq("projectId", args.projectId).eq("path", args.path)
      )
      .unique()
    if (!file) throw new ConvexError("File not found.")
    const now = Date.now()
    const documentId = await ctx.db.insert("crdtDocuments", {
      projectId: args.projectId,
      path: args.path,
      lastSequence: 1,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert("crdtUpdates", {
      projectId: args.projectId,
      documentId,
      sequence: 1,
      updateId: "initial-source",
      actorId: args.actorId,
      bytes,
      storageStatus: "pending",
      createdAt: now,
    })
    await enqueueBackup(ctx, args.projectId)
    return documentId
  },
})

export const documentExists = internalQuery({
  args: { projectId: v.id("projects"), path: v.string() },
  handler: async (ctx, args) =>
    (
      await ctx.db
        .query("crdtDocuments")
        .withIndex("by_project_path", (q) =>
          q.eq("projectId", args.projectId).eq("path", args.path)
        )
        .unique()
    )?._id ?? null,
})

export const storageStatus = query({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    updateIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await requireProjectMembership(ctx, args.projectId)
    if (args.updateIds.length > 100)
      throw new ConvexError("Too many update IDs.")
    const document = await ctx.db
      .query("crdtDocuments")
      .withIndex("by_project_path", (q) =>
        q.eq("projectId", args.projectId).eq("path", args.path)
      )
      .unique()
    if (!document) return []
    return Promise.all(
      args.updateIds.map(async (updateId) => {
        const update = await ctx.db
          .query("crdtUpdates")
          .withIndex("by_document_update", (q) =>
            q.eq("documentId", document._id).eq("updateId", updateId)
          )
          .unique()
        return { updateId, status: update?.storageStatus ?? "pending" }
      })
    )
  },
})

export const deleteOrphanUpdates = internalMutation({
  args: { documentId: v.id("crdtDocuments") },
  handler: async (ctx, { documentId }) => {
    if (await ctx.db.get(documentId)) return
    const updates = await ctx.db
      .query("crdtUpdates")
      .withIndex("by_document_sequence", (q) => q.eq("documentId", documentId))
      .take(100)
    for (const update of updates) await ctx.db.delete(update._id)
    if (updates.length === 100)
      await ctx.scheduler.runAfter(0, internal.crdt.deleteOrphanUpdates, {
        documentId,
      })
  },
})
