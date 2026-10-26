import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"

export async function enqueueBackup(
  ctx: MutationCtx,
  projectId: Id<"projects">
) {
  const existing = await ctx.db
    .query("crdtBackupJobs")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .unique()
  if (existing) return
  const jobId = await ctx.db.insert("crdtBackupJobs", {
    projectId,
    generation: 0,
    attempts: 0,
  })
  await scheduleBackup(ctx, jobId, 0, 500)
}

export async function scheduleBackup(
  ctx: MutationCtx,
  jobId: Id<"crdtBackupJobs">,
  generation: number,
  delay: number
) {
  await ctx.scheduler.runAfter(
    delay,
    internal.codeStorage.persistProjectUpdates,
    { jobId, generation }
  )
  // Recover a worker lost to an action timeout or process interruption.
  await ctx.scheduler.runAfter(delay + 11 * 60_000, internal.backups.recover, {
    jobId,
    generation,
  })
}
