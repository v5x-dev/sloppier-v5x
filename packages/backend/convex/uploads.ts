import { ConvexError, v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { requireProgramMembership } from "./lib/auth"

export const list = query({
  args: { programId: v.id("programs") },
  handler: async (ctx, { programId }) => {
    await requireProgramMembership(ctx, programId)
    return ctx.db
      .query("programUploads")
      .withIndex("by_program", (q) => q.eq("programId", programId))
      .order("desc")
      .take(100)
  },
})

export const record = mutation({
  args: { programId: v.id("programs"), revision: v.string(), slot: v.number() },
  handler: async (ctx, args) => {
    const { identity } = await requireProgramMembership(ctx, args.programId)
    if (!/^[a-f0-9]{40}$/i.test(args.revision))
      throw new ConvexError("Invalid source revision.")
    if (!Number.isInteger(args.slot) || args.slot < 1 || args.slot > 8)
      throw new ConvexError("Invalid Brain slot.")
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .unique()
    return ctx.db.insert("programUploads", {
      ...args,
      userId: identity.subject,
      userName:
        profile?.name || identity.name || identity.email || identity.subject,
      uploadedAt: Date.now(),
    })
  },
})
