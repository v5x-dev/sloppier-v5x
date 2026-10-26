import { query } from "./_generated/server"
import { v } from "convex/values"
import { requireProgramMembership } from "./lib/auth"

export const liveDocuments = query({
  args: { programId: v.id("programs") },
  handler: async (ctx, { programId }) => {
    await requireProgramMembership(ctx, programId)
    const docs = await ctx.db
      .query("crdtDocuments")
      .withIndex("by_program_path", (q) => q.eq("programId", programId))
      .collect()
    return docs.map((doc) => ({
      id: doc._id,
      path: doc.path,
      sequence: doc.lastSequence,
    }))
  },
})
