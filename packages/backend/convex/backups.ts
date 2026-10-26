import { v } from "convex/values"
import { internalMutation, internalQuery } from "./_generated/server"
import { enqueueBackup, scheduleBackup } from "./lib/crdtBackup"

const jobArgs = { jobId: v.id("crdtBackupJobs"), generation: v.number() }

export const batch = internalQuery({
  args: jobArgs,
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job || job.generation !== args.generation) return null
    const program = await ctx.db.get(job.programId)
    if (!program || program.repositoryStatus !== "ready") return null
    const candidates = await ctx.db
      .query("crdtUpdates")
      .withIndex("by_program_storage", (q) =>
        q.eq("programId", job.programId).eq("storageStatus", "pending")
      )
      .take(50)
    const updates = []
    let bytes = 0
    for (const update of candidates) {
      if (bytes + update.bytes.byteLength > 512 * 1024) break
      updates.push(update)
      bytes += update.bytes.byteLength
    }
    return { program, updates }
  },
})

export const complete = internalMutation({
  args: {
    ...jobArgs,
    updateIds: v.array(v.id("crdtUpdates")),
    commitSha: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job || job.generation !== args.generation) return
    if (args.error && job.attempts < 5) {
      await ctx.db.patch(job._id, {
        attempts: job.attempts + 1,
        generation: job.generation + 1,
      })
      await scheduleBackup(
        ctx,
        job._id,
        job.generation + 1,
        1000 * 2 ** job.attempts
      )
      return
    }
    for (const id of args.updateIds) {
      const update = await ctx.db.get(id)
      if (!update || update.storageStatus === "persisted") continue
      await ctx.db.patch(
        id,
        args.error
          ? { storageStatus: "failed", storageError: args.error.slice(0, 500) }
          : {
              storageStatus: "persisted",
              storageCommitSha: args.commitSha,
              storageError: undefined,
            }
      )
    }
    const next = await ctx.db
      .query("crdtUpdates")
      .withIndex("by_program_storage", (q) =>
        q.eq("programId", job.programId).eq("storageStatus", "pending")
      )
      .first()
    if (!next) {
      await ctx.db.delete(job._id)
      return
    }
    await ctx.db.patch(job._id, { generation: job.generation + 1, attempts: 0 })
    await scheduleBackup(ctx, job._id, job.generation + 1, 500)
  },
})

export const recover = internalMutation({
  args: jobArgs,
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job || job.generation !== args.generation) return
    const program = await ctx.db.get(job.programId)
    if (!program || program.repositoryStatus !== "ready") {
      await ctx.db.delete(job._id)
      return
    }
    await ctx.db.patch(job._id, { generation: job.generation + 1 })
    await scheduleBackup(ctx, job._id, job.generation + 1, 0)
  },
})

// Compatibility for updates queued before repository batching was introduced.
export const enqueueUpdate = internalMutation({
  args: { updateRowId: v.id("crdtUpdates") },
  handler: async (ctx, { updateRowId }) => {
    const update = await ctx.db.get(updateRowId)
    if (!update || update.storageStatus === "persisted") return
    const document = await ctx.db.get(update.documentId)
    if (!document) return
    await ctx.db.patch(update._id, {
      programId: document.programId,
      storageStatus: "pending",
      storageError: undefined,
    })
    await enqueueBackup(ctx, document.programId)
  },
})
