import { internal } from "./_generated/api"
import { internalMutation, mutation, query } from "./_generated/server"
import { ConvexError, v } from "convex/values"
import {
  requireDesignMembership,
  requireIdentity,
  requireWorkspaceMembership,
} from "./lib/auth"
import generateBoringName from "boring-name-generator"

const COPY_BATCH_ROWS = 20
const COPY_BATCH_BYTES = 8 * 1024 * 1024
const PURGE_BATCH_ROWS = 100

function validName(name: string) {
  name = name.trim()
  if (!name || name.length > 80)
    throw new ConvexError("Design name must contain 1–80 characters.")
  return name
}

export const listByWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMembership(ctx, workspaceId)
    const designs = await ctx.db
      .query("designs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect()
    return designs.filter((design) => !design.deletionStartedAt)
  },
})

export const get = query({
  args: { designId: v.id("designs") },
  handler: async (ctx, { designId }) => {
    const { design } = await requireDesignMembership(ctx, designId)
    return design
  },
})

export const generateName = mutation({
  args: {},
  handler: async (ctx) => {
    await requireIdentity(ctx)
    return generateBoringName({ number: true }).dashed
  },
})

export const create = mutation({
  args: { workspaceId: v.id("workspaces"), name: v.optional(v.string()) },
  handler: async (ctx, { workspaceId, name }) => {
    const { identity } = await requireWorkspaceMembership(ctx, workspaceId)
    return ctx.db.insert("designs", {
      workspaceId,
      name: validName(
        name?.trim() || generateBoringName({ number: true }).dashed
      ),
      createdBy: identity.subject,
      createdAt: Date.now(),
    })
  },
})

export const rename = mutation({
  args: { designId: v.id("designs"), name: v.string() },
  handler: async (ctx, { designId, name }) => {
    await requireDesignMembership(ctx, designId)
    await ctx.db.patch(designId, { name: validName(name) })
  },
})

export const setArchived = mutation({
  args: { designId: v.id("designs"), archived: v.boolean() },
  handler: async (ctx, { designId, archived }) => {
    await requireDesignMembership(ctx, designId)
    await ctx.db.patch(designId, {
      archivedAt: archived ? Date.now() : undefined,
    })
  },
})

// The copy runs in batches because a Design's updates can exceed one
// transaction's limits. The duplicate is usable once `copyingFrom` clears.
export const duplicate = mutation({
  args: { designId: v.id("designs"), name: v.string() },
  handler: async (ctx, { designId, name }) => {
    const { identity, design } = await requireDesignMembership(ctx, designId)
    const copyId = await ctx.db.insert("designs", {
      workspaceId: design.workspaceId,
      name: validName(name),
      createdBy: identity.subject,
      createdAt: Date.now(),
      copyingFrom: designId,
    })
    await ctx.scheduler.runAfter(0, internal.designs.copyBatch, {
      copyId,
      afterSequence: 0,
    })
    return copyId
  },
})

export const copyBatch = internalMutation({
  args: { copyId: v.id("designs"), afterSequence: v.number() },
  handler: async (ctx, { copyId, afterSequence }) => {
    const copy = await ctx.db.get(copyId)
    if (!copy?.copyingFrom || copy.deletionStartedAt) return
    const sourceId = copy.copyingFrom

    let last = afterSequence
    let copiedBytes = 0
    let copiedRows = 0
    // Compaction may merge source rows during the copy. Yjs ignores updates it
    // has already applied, so an overlap between copied rows is harmless.
    for await (const update of ctx.db
      .query("designUpdates")
      .withIndex("by_design_sequence", (q) =>
        q.eq("designId", sourceId).gt("sequence", afterSequence)
      )
      .order("asc")) {
      copiedBytes += update.bytes.byteLength
      if (
        copiedRows > 0 &&
        (copiedRows >= COPY_BATCH_ROWS || copiedBytes > COPY_BATCH_BYTES)
      ) {
        await ctx.scheduler.runAfter(0, internal.designs.copyBatch, {
          copyId,
          afterSequence: last,
        })
        return
      }
      await ctx.db.insert("designUpdates", {
        designId: copyId,
        sequence: update.sequence,
        updateId: update.updateId,
        actorId: update.actorId,
        bytes: update.bytes,
        createdAt: update.createdAt,
      })
      last = update.sequence
      copiedRows += 1
    }
    await ctx.db.patch(copyId, { copyingFrom: undefined })
  },
})

export const remove = mutation({
  args: { designId: v.id("designs") },
  handler: async (ctx, { designId }) => {
    await requireDesignMembership(ctx, designId)
    await ctx.db.patch(designId, { deletionStartedAt: Date.now() })
    await ctx.scheduler.runAfter(0, internal.designs.purgeBatch, { designId })
  },
})

export const purgeBatch = internalMutation({
  args: { designId: v.id("designs") },
  handler: async (ctx, { designId }) => {
    const updates = await ctx.db
      .query("designUpdates")
      .withIndex("by_design_sequence", (q) => q.eq("designId", designId))
      .take(PURGE_BATCH_ROWS)
    for (const update of updates) await ctx.db.delete(update._id)
    if (updates.length === PURGE_BATCH_ROWS) {
      await ctx.scheduler.runAfter(0, internal.designs.purgeBatch, { designId })
      return
    }
    await ctx.db.delete(designId)
  },
})
