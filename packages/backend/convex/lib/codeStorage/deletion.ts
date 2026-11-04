"use node"

import { internal } from "../../_generated/api"
import { action } from "../../_generated/server"
import { ConvexError, v } from "convex/values"
import { cloud } from "../../buildWorker"
import { storage } from "./repository"

export function deletionActions() {
  // Removes the repository and Builder machine before the Convex rows. A failure
  // here throws before any row changes, so the Program stays visible and retryable.
  const deleteProgram = action({
    args: { programId: v.id("programs") },
    handler: async (ctx, { programId }) => {
      const identity = await ctx.auth.getUserIdentity()
      if (!identity) throw new ConvexError("Authentication required.")
      const { program, machineId } = await ctx.runQuery(
        internal.programs.getForDeletion,
        { programId, userId: identity.subject }
      )

      if (machineId) {
        await cloud(
          `/machines/${encodeURIComponent(machineId)}`,
          undefined,
          "DELETE"
        )
      }

      const store = storage()
      if (await store.findOne({ id: program.repositoryId })) {
        await store.deleteRepo({ id: program.repositoryId })
      }

      let batch = await ctx.runMutation(internal.programs.purgeBatch, {
        programId,
      })
      while (!batch.done) {
        batch = await ctx.runMutation(internal.programs.purgeBatch, {
          programId,
        })
      }
    },
  })

  return { deleteProgram }
}
