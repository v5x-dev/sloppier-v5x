import { internal } from "./_generated/api"
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server"
import { ConvexError, v } from "convex/values"
import {
  requireProjectMembership,
  requireWorkspaceMembership,
} from "./lib/auth"
import { programTemplates } from "./lib/templateCatalog"
import generateBoringName from "boring-name-generator"

const templateValidator = v.union(
  v.literal("vexcode"),
  v.literal("jar"),
  v.literal("pros"),
  v.literal("ez-template")
)

export const listTemplates = query({
  args: {},
  handler: async () => programTemplates,
})

export const listByWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspaceMembership(ctx, args.workspaceId)

    return ctx.db
      .query("projects")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect()
  },
})

export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProjectMembership(ctx, projectId)
    const project = await ctx.db.get(projectId)
    if (!project) {
      throw new ConvexError("Program not found.")
    }
    return project
  },
})

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.optional(v.string()),
    template: templateValidator,
  },
  handler: async (ctx, args) => {
    const { identity } = await requireWorkspaceMembership(ctx, args.workspaceId)
    const name =
      args.name?.trim() || generateBoringName({ number: true }).dashed

    if (name.length > 80) {
      throw new ConvexError("Project name must be at most 80 characters.")
    }

    const projectId = await ctx.db.insert("projects", {
      workspaceId: args.workspaceId,
      name,
      template: args.template,
      repositoryId: "pending",
      repositoryStatus: "provisioning",
      createdBy: identity.subject,
      createdAt: Date.now(),
    })

    await ctx.db.patch(projectId, {
      repositoryId: `programs/${projectId}`,
    })

    await ctx.scheduler.runAfter(0, internal.codeStorage.provisionProject, {
      projectId,
    })

    return projectId
  },
})

export const retryProvisioning = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProjectMembership(ctx, projectId)
    const project = await ctx.db.get(projectId)

    if (!project) {
      throw new ConvexError("Program not found.")
    }
    if (project.repositoryStatus === "ready") {
      return projectId
    }

    await ctx.db.patch(projectId, {
      repositoryStatus: "provisioning",
      repositoryError: undefined,
    })
    await ctx.scheduler.runAfter(0, internal.codeStorage.provisionProject, {
      projectId,
    })
    return projectId
  },
})

export const getRepositoryForMember = internalQuery({
  args: { projectId: v.id("projects"), userId: v.string() },
  handler: async (ctx, { projectId, userId }) => {
    const project = await ctx.db.get(projectId)
    if (!project) {
      throw new ConvexError("Program not found.")
    }

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", project.workspaceId).eq("userId", userId)
      )
      .unique()

    if (!membership) {
      throw new ConvexError("You do not have access to this program.")
    }
    if (project.repositoryStatus !== "ready") {
      throw new ConvexError("The program repository is not ready yet.")
    }
    return project
  },
})

export const getForProvisioning = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => ctx.db.get(projectId),
})

export const markRepositoryReady = internalMutation({
  args: {
    projectId: v.id("projects"),
    headSha: v.string(),
    files: v.array(v.string()),
  },
  handler: async (ctx, { projectId, headSha, files }) => {
    const project = await ctx.db.get(projectId)
    if (!project) {
      return
    }

    const now = Date.now()
    await ctx.db.patch(projectId, {
      repositoryStatus: "ready",
      repositoryHeadSha: headSha,
      repositoryError: undefined,
    })

    for (const path of files) {
      const existing = await ctx.db
        .query("files")
        .withIndex("by_project_path", (q) =>
          q.eq("projectId", projectId).eq("path", path)
        )
        .unique()

      if (existing) {
        await ctx.db.patch(existing._id, { updatedAt: now })
      } else {
        await ctx.db.insert("files", {
          projectId,
          path,
          origin: "template",
          createdBy: project.createdBy,
          createdAt: now,
          updatedAt: now,
        })
      }
    }
  },
})

export const markRepositoryFailed = internalMutation({
  args: { projectId: v.id("projects"), message: v.string() },
  handler: async (ctx, { projectId, message }) => {
    const project = await ctx.db.get(projectId)
    if (!project || project.repositoryStatus === "ready") {
      return
    }
    await ctx.db.patch(projectId, {
      repositoryStatus: "failed",
      repositoryError: message.slice(0, 500),
    })
  },
})

export const recordRepositoryHead = internalMutation({
  args: { projectId: v.id("projects"), headSha: v.string() },
  handler: async (ctx, { projectId, headSha }) => {
    const project = await ctx.db.get(projectId)
    if (project?.repositoryStatus === "ready") {
      await ctx.db.patch(projectId, { repositoryHeadSha: headSha })
    }
  },
})
