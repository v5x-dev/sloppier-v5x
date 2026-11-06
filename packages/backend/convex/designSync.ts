import * as Y from "yjs"
import { internal } from "./_generated/api"
import { internalMutation, mutation, query } from "./_generated/server"
import type { Doc } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { ConvexError, v } from "convex/values"
import { requireDesignMembership } from "./lib/auth"

const MAX_UPDATE_BYTES = 900 * 1024
const MAX_REPLAY_BYTES = 900 * 1024
const MAX_REPLAY_UPDATES = 100
const COMPACT_EVERY_UPDATES = 200
const COMPACT_MAX_MERGED_BYTES = 512 * 1024
const COMPACT_MAX_SCAN_ROWS = 400
const COMPACT_MAX_SCAN_BYTES = 8 * 1024 * 1024
const ACTIVITY_INTERVAL_MS = 60_000

async function lastSequence(ctx: MutationCtx, design: Doc<"designs">) {
  const last = await ctx.db
    .query("designUpdates")
    .withIndex("by_design_sequence", (q) => q.eq("designId", design._id))
    .order("desc")
    .first()
  return last?.sequence ?? 0
}

export const appendUpdate = mutation({
  args: { designId: v.id("designs"), updateId: v.string(), bytes: v.bytes() },
  handler: async (ctx, { designId, updateId, bytes }) => {
    const { identity, design } = await requireDesignMembership(ctx, designId)
    if (design.copyingFrom) {
      throw new ConvexError("This Design is still being copied.")
    }
    if (updateId.length < 8 || updateId.length > 128) {
      throw new ConvexError("Update ID must be between 8 and 128 characters.")
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPDATE_BYTES) {
      throw new ConvexError(
        "Design updates must be between 1 byte and 900 KiB."
      )
    }
    try {
      Y.decodeUpdate(new Uint8Array(bytes))
    } catch {
      throw new ConvexError("Invalid Yjs update.")
    }

    // A retry after a lost response. If compaction has since removed the row,
    // the update lands again, which is harmless because Yjs ignores repeats.
    const duplicate = await ctx.db
      .query("designUpdates")
      .withIndex("by_design_update", (q) =>
        q.eq("designId", designId).eq("updateId", updateId)
      )
      .unique()
    if (duplicate) return { sequence: duplicate.sequence, duplicate: true }

    const now = Date.now()
    const sequence = (await lastSequence(ctx, design)) + 1
    await ctx.db.insert("designUpdates", {
      designId,
      sequence,
      updateId,
      actorId: identity.subject,
      bytes,
      createdAt: now,
    })
    if (now - (design.lastActivityAt ?? 0) >= ACTIVITY_INTERVAL_MS) {
      await ctx.db.patch(designId, { lastActivityAt: now })
    }
    if (sequence % COMPACT_EVERY_UPDATES === 0) {
      await ctx.scheduler.runAfter(0, internal.designSync.compact, { designId })
    }
    return { sequence, duplicate: false }
  },
})

export const updatesSince = query({
  args: { designId: v.id("designs"), afterSequence: v.number() },
  handler: async (ctx, { designId, afterSequence }) => {
    const { design } = await requireDesignMembership(ctx, designId)
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new ConvexError("Sequence must be a non-negative integer.")
    }
    const candidates = await ctx.db
      .query("designUpdates")
      .withIndex("by_design_sequence", (q) =>
        q.eq("designId", designId).gt("sequence", afterSequence)
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
      updates.push({ sequence: update.sequence, bytes: update.bytes })
      responseBytes += update.bytes.byteLength
    }

    return {
      copying: Boolean(design.copyingFrom),
      updates,
      hasMore: candidates.length > updates.length,
    }
  },
})

// Merges the oldest run of small updates into one row at the run's last
// sequence, so a client partway through still reaches the same end state.
export const compact = internalMutation({
  args: { designId: v.id("designs") },
  handler: async (ctx, { designId }) => {
    const design = await ctx.db.get(designId)
    if (!design || design.deletionStartedAt) return
    const start = design.compactedThrough ?? 0

    const rows = await ctx.db
      .query("designUpdates")
      .withIndex("by_design_sequence", (q) =>
        q.eq("designId", designId).gt("sequence", start)
      )
      .order("asc")
      .take(COMPACT_MAX_SCAN_ROWS)

    let run: Doc<"designUpdates">[] = []
    let runBytes = 0
    let scannedBytes = 0
    let compactedThrough = start
    for (const row of rows) {
      scannedBytes += row.bytes.byteLength
      if (scannedBytes > COMPACT_MAX_SCAN_BYTES) break
      if (runBytes + row.bytes.byteLength > COMPACT_MAX_MERGED_BYTES) {
        if (run.length >= 2) break
        // A row that fills a merged row by itself is as compact as it can get.
        compactedThrough = run.at(-1)?.sequence ?? compactedThrough
        run = []
        runBytes = 0
      }
      run.push(row)
      runBytes += row.bytes.byteLength
    }

    if (run.length >= 2) {
      const last = run[run.length - 1]
      const merged = Y.mergeUpdates(run.map((row) => new Uint8Array(row.bytes)))
      for (const row of run.slice(0, -1)) await ctx.db.delete(row._id)
      await ctx.db.patch(last._id, {
        bytes: merged.slice().buffer as ArrayBuffer,
        updateId: `compact:${last.sequence}`,
      })
      compactedThrough = last.sequence
    }
    if (compactedThrough !== start) {
      await ctx.db.patch(designId, { compactedThrough })
    }
    // More rows remain beyond this scan, and this pass made progress.
    if (rows.length === COMPACT_MAX_SCAN_ROWS && compactedThrough !== start) {
      await ctx.scheduler.runAfter(0, internal.designSync.compact, { designId })
    }
  },
})
