import { query } from "./_generated/server"
import { v } from "convex/values"
import { requireProjectMembership } from "./lib/auth"

export const liveDocuments = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProjectMembership(ctx, projectId)
    const docs = await ctx.db
      .query("crdtDocuments")
      .withIndex("by_project_path", (q) => q.eq("projectId", projectId))
      .collect()
    return docs.map((doc) => ({
      id: doc._id,
      path: doc.path,
      sequence: doc.lastSequence,
    }))
  },
})
