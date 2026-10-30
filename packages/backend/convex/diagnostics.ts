import { ConvexError, v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { requireProgramMembership } from "./lib/auth"

const diagnostic = v.object({
  path: v.string(),
  line: v.number(),
  column: v.optional(v.number()),
  severity: v.union(
    v.literal("error"),
    v.literal("warning"),
    v.literal("note")
  ),
  message: v.string(),
})

export const get = query({
  args: { programId: v.id("programs") },
  handler: async (ctx, { programId }) => {
    await requireProgramMembership(ctx, programId)
    return await ctx.db
      .query("programDiagnostics")
      .withIndex("by_program", (q) => q.eq("programId", programId))
      .unique()
  },
})

export const save = mutation({
  args: {
    programId: v.id("programs"),
    revision: v.string(),
    startedAt: v.number(),
    diagnostics: v.array(diagnostic),
  },
  handler: async (ctx, args) => {
    await requireProgramMembership(ctx, args.programId)
    if (
      !/^[a-f0-9]{40}$/i.test(args.revision) ||
      !Number.isSafeInteger(args.startedAt) ||
      args.startedAt < 0 ||
      args.startedAt > Date.now() + 60_000 ||
      args.diagnostics.length > 2000 ||
      args.diagnostics.some(
        (d) =>
          !d.path ||
          d.path.length > 4096 ||
          !d.message ||
          d.message.length > 8192 ||
          !Number.isSafeInteger(d.line) ||
          d.line < 1 ||
          (d.column !== undefined &&
            (!Number.isSafeInteger(d.column) || d.column < 1))
      )
    )
      throw new ConvexError("Invalid compiler diagnostics.")
    const existing = await ctx.db
      .query("programDiagnostics")
      .withIndex("by_program", (q) => q.eq("programId", args.programId))
      .unique()
    if (existing && existing.startedAt >= args.startedAt) return
    if (existing) await ctx.db.patch(existing._id, args)
    else await ctx.db.insert("programDiagnostics", args)
  },
})
