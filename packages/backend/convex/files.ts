import { internal } from "./_generated/api"
import { internalMutation, query } from "./_generated/server"
import { v } from "convex/values"
import { requireProgramMembership } from "./lib/auth"
import { validateRepositoryPath } from "./lib/paths"

const fileChangeValidator = v.union(
  v.object({ operation: v.literal("put"), path: v.string() }),
  v.object({ operation: v.literal("delete"), path: v.string() })
)

export const listByProgram = query({
  args: { programId: v.id("programs") },
  handler: async (ctx, args) => {
    await requireProgramMembership(ctx, args.programId)

    return ctx.db
      .query("files")
      .withIndex("by_program", (q) => q.eq("programId", args.programId))
      .collect()
  },
})

export const applyRepositoryChanges = internalMutation({
  args: {
    programId: v.id("programs"),
    actorId: v.string(),
    changes: v.array(fileChangeValidator),
    moves: v.optional(v.array(v.object({ from: v.string(), to: v.string() }))),
  },
  handler: async (ctx, { programId, actorId, changes, moves }) => {
    const now = Date.now()
    for (const move of moves ?? []) {
      validateRepositoryPath(move.from)
      validateRepositoryPath(move.to)
    }
    for (const change of changes) validateRepositoryPath(change.path)

    // Moves only touch live documents, and each change path appears once, so
    // the file rows can be read together before any writes below.
    const fileIds = new Map(
      await Promise.all(
        changes.map(async (change) => {
          const file = await ctx.db
            .query("files")
            .withIndex("by_program_path", (q) =>
              q.eq("programId", programId).eq("path", change.path)
            )
            .unique()
          return [change.path, file?._id ?? null] as const
        })
      )
    )

    // Keep the live document identity and its pending edits when a file moves.
    // The subsequent source deletion then removes only the file metadata.
    for (const move of moves ?? []) {
      const live = await ctx.db
        .query("crdtDocuments")
        .withIndex("by_program_path", (q) =>
          q.eq("programId", programId).eq("path", move.from)
        )
        .unique()
      const target = await ctx.db
        .query("crdtDocuments")
        .withIndex("by_program_path", (q) =>
          q.eq("programId", programId).eq("path", move.to)
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
      const existing = fileIds.get(change.path) ?? null

      if (change.operation === "delete") {
        if (existing) {
          await ctx.db.delete(existing)
          fileIds.set(change.path, null)
          const live = await ctx.db
            .query("crdtDocuments")
            .withIndex("by_program_path", (q) =>
              q.eq("programId", programId).eq("path", change.path)
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
        await ctx.db.patch(existing, {
          origin: "user",
          updatedAt: now,
        })
      } else {
        fileIds.set(
          change.path,
          await ctx.db.insert("files", {
            programId,
            path: change.path,
            origin: "user",
            createdBy: actorId,
            createdAt: now,
            updatedAt: now,
          })
        )
      }
    }
  },
})

// A restored tree starts new live documents, preventing old local Yjs caches
// and delayed updates from merging post-commit text back into restored files.
export const applyCommitRestore = internalMutation({
  args: {
    programId: v.id("programs"),
    actorId: v.string(),
    headSha: v.string(),
    paths: v.array(v.string()),
  },
  handler: async (ctx, { programId, actorId, headSha, paths }) => {
    const now = Date.now()
    const documents = await ctx.db
      .query("crdtDocuments")
      .withIndex("by_program_path", (q) => q.eq("programId", programId))
      .collect()
    await Promise.all(
      documents.map(async (document) => {
        await ctx.db.delete(document._id)
        await ctx.scheduler.runAfter(0, internal.crdt.deleteOrphanUpdates, {
          documentId: document._id,
        })
      })
    )
    const files = await ctx.db
      .query("files")
      .withIndex("by_program", (q) => q.eq("programId", programId))
      .collect()
    const wanted = new Set(paths)
    // Each callback claims its path synchronously, before any write is awaited.
    await Promise.all(
      files.map((file) =>
        wanted.delete(file.path)
          ? ctx.db.patch(file._id, { updatedAt: now })
          : ctx.db.delete(file._id)
      )
    )
    const inserted = [...wanted]
    for (const path of inserted) validateRepositoryPath(path)
    await Promise.all(
      inserted.map((path) =>
        ctx.db.insert("files", {
          programId,
          path,
          origin: "user",
          createdBy: actorId,
          createdAt: now,
          updatedAt: now,
        })
      )
    )
    await ctx.db.patch(programId, {
      repositoryHeadSha: headSha,
      lastActivityAt: now,
    })
  },
})
