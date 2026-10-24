import type { Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { ConvexError } from "convex/values"

type DbCtx = QueryCtx | MutationCtx

export async function requireIdentity(ctx: DbCtx) {
  const identity = await ctx.auth.getUserIdentity()

  if (!identity) {
    throw new ConvexError("Authentication required.")
  }

  return identity
}

export async function requireWorkspaceMembership(
  ctx: DbCtx,
  workspaceId: Id<"workspaces">
) {
  const identity = await requireIdentity(ctx)
  const membership = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace_user", (q) =>
      q.eq("workspaceId", workspaceId).eq("userId", identity.subject)
    )
    .unique()

  if (!membership) {
    throw new ConvexError("You do not have access to this workspace.")
  }

  return { identity, membership }
}

export async function requireProjectMembership(
  ctx: DbCtx,
  projectId: Id<"projects">
) {
  const project = await ctx.db.get(projectId)

  if (!project) {
    throw new ConvexError("Project not found.")
  }

  const access = await requireWorkspaceMembership(ctx, project.workspaceId)
  return { ...access, project }
}
