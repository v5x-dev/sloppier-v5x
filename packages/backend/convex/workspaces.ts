import { mutation, query, type MutationCtx } from "./_generated/server"
import { ConvexError, v } from "convex/values"
import { requireIdentity, requireWorkspaceMembership } from "./lib/auth"

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx)
    const memberships = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect()

    return Promise.all(
      memberships.map(async (membership) => ({
        workspace: await ctx.db.get(membership.workspaceId),
        role: membership.role,
      }))
    )
  },
})

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx)
    const name = args.name.trim()

    if (name.length === 0 || name.length > 80) {
      throw new ConvexError(
        "Workspace name must be between 1 and 80 characters."
      )
    }

    return insertWorkspace(ctx, identity.subject, name)
  },
})

// Gives a new user somewhere to put programs. Safe to call repeatedly:
// it does nothing once the user belongs to any workspace.
export const ensurePersonal = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx)
    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .first()
    if (membership) {
      return membership.workspaceId
    }

    return insertWorkspace(ctx, identity.subject, "Personal")
  },
})

export const listMembers = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const { membership } = await requireWorkspaceMembership(ctx, workspaceId)
    if (membership.role !== "admin") {
      throw new ConvexError("Only workspace admins can list members.")
    }
    return ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect()
  },
})

export const addMember = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    role: v.optional(v.union(v.literal("admin"), v.literal("member"))),
  },
  handler: async (ctx, args) => {
    const { membership } = await requireWorkspaceMembership(
      ctx,
      args.workspaceId
    )
    if (membership.role !== "admin") {
      throw new ConvexError("Only workspace admins can add members.")
    }
    const userId = args.userId.trim()
    if (userId.length === 0 || userId.length > 256) {
      throw new ConvexError("A valid WorkOS user ID is required.")
    }

    const existing = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("userId", userId)
      )
      .unique()
    if (existing) {
      return existing._id
    }

    return ctx.db.insert("workspaceMembers", {
      workspaceId: args.workspaceId,
      userId,
      role: args.role ?? "member",
      joinedAt: Date.now(),
    })
  },
})

async function insertWorkspace(ctx: MutationCtx, userId: string, name: string) {
  const now = Date.now()
  const workspaceId = await ctx.db.insert("workspaces", {
    name,
    ownerId: userId,
    createdAt: now,
  })

  await ctx.db.insert("workspaceMembers", {
    workspaceId,
    userId,
    role: "admin",
    joinedAt: now,
  })

  return workspaceId
}
