import { v, ConvexError } from "convex/values"
import { query, mutation, internalMutation } from "./_generated/server"
import { requireProgramMembership } from "./lib/auth"

export const list = query({
  args: { programId: v.id("programs") },
  handler: async (ctx, { programId }) => {
    await requireProgramMembership(ctx, programId)
    return ctx.db
      .query("programCheckpoints")
      .withIndex("by_program", (q) => q.eq("programId", programId))
      .order("desc")
      .collect()
  },
})

export const save = internalMutation({
  args: {
    programId: v.id("programs"),
    sha: v.string(),
    name: v.string(),
    message: v.string(),
    author: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProgramMembership(ctx, args.programId)
    const name = args.name.trim()
    if (!name || name.length > 80)
      throw new ConvexError(
        "Checkpoint name must be between 1 and 80 characters."
      )
    const existing = await ctx.db
      .query("programCheckpoints")
      .withIndex("by_program", (q) => q.eq("programId", args.programId))
      .collect()
    if (existing.length >= 100)
      throw new ConvexError("A Program can have up to 100 checkpoints.")
    return ctx.db.insert("programCheckpoints", { ...args, name })
  },
})

export const remove = mutation({
  args: { checkpointId: v.id("programCheckpoints") },
  handler: async (ctx, { checkpointId }) => {
    const checkpoint = await ctx.db.get(checkpointId)
    if (!checkpoint) throw new ConvexError("Checkpoint not found.")
    await requireProgramMembership(ctx, checkpoint.programId)
    await ctx.db.delete(checkpointId)
  },
})
