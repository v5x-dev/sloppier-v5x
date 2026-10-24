import { internal } from "./_generated/api"
import { internalMutation, query } from "./_generated/server"
import { v } from "convex/values"
import { requireProjectMembership } from "./lib/auth"
import { validateRepositoryPath } from "./lib/paths"

const fileChangeValidator = v.union(
  v.object({ operation: v.literal("put"), path: v.string() }),
  v.object({ operation: v.literal("delete"), path: v.string() })
)

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectMembership(ctx, args.projectId)

    return ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()
  },
})

export const applyRepositoryChanges = internalMutation({
  args: {
    projectId: v.id("projects"),
    actorId: v.string(),
    changes: v.array(fileChangeValidator),
    moves: v.optional(v.array(v.object({ from: v.string(), to: v.string() }))),
  },
  handler: async (ctx, { projectId, actorId, changes, moves }) => {
    const now = Date.now()

    // Keep the live document identity and its pending edits when a file moves.
    // The subsequent source deletion then removes only the file metadata.
    for (const move of moves ?? []) {
      validateRepositoryPath(move.from)
      validateRepositoryPath(move.to)
      const live = await ctx.db
        .query("crdtDocuments")
        .withIndex("by_project_path", (q) =>
          q.eq("projectId", projectId).eq("path", move.from)
        )
        .unique()
      const target = await ctx.db
        .query("crdtDocuments")
        .withIndex("by_project_path", (q) =>
          q.eq("projectId", projectId).eq("path", move.to)
        )
        .unique()
      // Destination repository paths are checked for collisions before commit.
      // An orphan live document must not replace the source's live state.
      if (target) {
        await ctx.db.delete(target._id)
        await ctx.scheduler.runAfter(0, internal.crdt.deleteOrphanUpdates, {
          documentId: target._id,
        })
      }
      if (live) await ctx.db.patch(live._id, { path: move.to, updatedAt: now })
    }

    for (const change of changes) {
      validateRepositoryPath(change.path)

      const existing = await ctx.db
        .query("files")
        .withIndex("by_project_path", (q) =>
          q.eq("projectId", projectId).eq("path", change.path)
        )
        .unique()

      if (change.operation === "delete") {
        if (existing) {
          await ctx.db.delete(existing._id)
          const live = await ctx.db
            .query("crdtDocuments")
            .withIndex("by_project_path", (q) =>
              q.eq("projectId", projectId).eq("path", change.path)
            )
            .unique()
          if (live) {
            await ctx.db.delete(live._id)
            await ctx.scheduler.runAfter(0, internal.crdt.deleteOrphanUpdates, {
              documentId: live._id,
            })
          }
        }
        continue
      }

      if (existing) {
        await ctx.db.patch(existing._id, {
          origin: "user",
          updatedAt: now,
        })
      } else {
        await ctx.db.insert("files", {
          projectId,
          path: change.path,
          origin: "user",
          createdBy: actorId,
          createdAt: now,
          updatedAt: now,
        })
      }
    }
  },
})
