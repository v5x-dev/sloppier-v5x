import { internal } from "./_generated/api"
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server"
import { ConvexError, v } from "convex/values"
import {
  requireIdentity,
  requireProjectMembership,
  requireWorkspaceMembership,
} from "./lib/auth"
import { programTemplates } from "./lib/templateCatalog"
import {
  excludedImportPath,
  validateImportPaths,
  IMPORT_MAX_FILES,
  IMPORT_MAX_BYTES,
  IMPORT_BATCH_BYTES,
  IMPORT_BATCH_FILES,
} from "./lib/folderImport"
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

export const generateName = mutation({
  args: {},
  handler: async (ctx) => {
    await requireIdentity(ctx)
    return generateBoringName({ number: true }).dashed
  },
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
    origin: v.optional(v.union(v.literal("template"), v.literal("user"))),
  },
  handler: async (ctx, { projectId, headSha, files, origin }) => {
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
          origin: origin ?? "template",
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

export const beginFolderImport = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    name: v.string(),
    template: templateValidator,
    expectedFiles: v.number(),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireWorkspaceMembership(ctx, args.workspaceId)
    const name = args.name.trim()
    if (!name || name.length > 80)
      throw new ConvexError("Program name must be between 1 and 80 characters.")
    if (
      !Number.isInteger(args.expectedFiles) ||
      args.expectedFiles < 1 ||
      args.expectedFiles > IMPORT_MAX_FILES
    )
      throw new ConvexError(`Import between 1 and ${IMPORT_MAX_FILES} files.`)
    const importId = await ctx.db.insert("programImports", {
      ...args,
      name,
      userId: identity.subject,
      paths: [],
      totalBytes: 0,
      batches: 0,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    })
    await ctx.scheduler.runAfter(
      24 * 60 * 60 * 1000,
      internal.projects.cleanupFolderImport,
      { importId }
    )
    return importId
  },
})

export const appendFolderImport = mutation({
  args: {
    importId: v.id("programImports"),
    sequence: v.number(),
    files: v.array(v.object({ path: v.string(), contents: v.bytes() })),
  },
  handler: async (ctx, { importId, sequence, files }) => {
    const session = await ctx.db.get(importId)
    if (!session) throw new ConvexError("Folder import not found.")
    const { identity } = await requireWorkspaceMembership(
      ctx,
      session.workspaceId
    )
    if (session.userId !== identity.subject)
      throw new ConvexError("This folder import belongs to another user.")
    if (session.projectId || session.expiresAt <= Date.now())
      throw new ConvexError(
        "This folder import is closed. Choose the folder again."
      )
    if (
      !Number.isInteger(sequence) ||
      sequence < 0 ||
      sequence > session.batches
    )
      throw new ConvexError("Upload folder batches in order.")
    if (!files.length || files.length > IMPORT_BATCH_FILES)
      throw new ConvexError("Invalid folder batch size.")
    const bytes = files.reduce((sum, file) => sum + file.contents.byteLength, 0)
    if (bytes > IMPORT_BATCH_BYTES)
      throw new ConvexError("Folder batch exceeds 384 KiB.")
    if (sequence < session.batches) {
      const previous = await ctx.db
        .query("programImportBatches")
        .withIndex("by_import_sequence", (q) =>
          q.eq("importId", importId).eq("sequence", sequence)
        )
        .unique()
      const same =
        previous &&
        previous.files.length === files.length &&
        previous.files.every((file, i) => {
          const incoming = files[i]!
          const left = new Uint8Array(file.contents)
          const right = new Uint8Array(incoming.contents)
          return (
            file.path === incoming.path &&
            left.length === right.length &&
            left.every((byte, j) => byte === right[j])
          )
        })
      if (!same)
        throw new ConvexError(
          "A retried folder batch must contain the same files."
        )
      return
    }
    if (session.totalBytes + bytes > IMPORT_MAX_BYTES)
      throw new ConvexError("Folder exceeds 16 MiB of imported files.")
    const paths = [...session.paths, ...files.map((file) => file.path)]
    if (paths.length > session.expectedFiles)
      throw new ConvexError("Folder contains more files than expected.")
    try {
      validateImportPaths(paths)
      for (const file of files) {
        if (excludedImportPath(session.template, file.path))
          throw new Error(`${file.path} is excluded from folder imports.`)
      }
    } catch (error) {
      throw new ConvexError(
        error instanceof Error ? error.message : "Invalid folder paths."
      )
    }
    await ctx.db.insert("programImportBatches", { importId, sequence, files })
    await ctx.db.patch(importId, {
      paths,
      totalBytes: session.totalBytes + bytes,
      batches: session.batches + 1,
    })
  },
})

export const finishFolderImport = mutation({
  args: { importId: v.id("programImports") },
  handler: async (ctx, { importId }) => {
    const session = await ctx.db.get(importId)
    if (!session) throw new ConvexError("Folder import not found.")
    const { identity } = await requireWorkspaceMembership(
      ctx,
      session.workspaceId
    )
    if (session.userId !== identity.subject)
      throw new ConvexError("This folder import belongs to another user.")
    if (session.projectId) return session.projectId
    if (session.expiresAt <= Date.now())
      throw new ConvexError("Folder import expired. Choose the folder again.")
    if (session.paths.length !== session.expectedFiles)
      throw new ConvexError("Finish uploading all folder files first.")
    const projectId = await ctx.db.insert("projects", {
      workspaceId: session.workspaceId,
      name: session.name,
      template: session.template,
      repositoryId: "pending",
      repositoryStatus: "provisioning",
      createdBy: identity.subject,
      createdAt: Date.now(),
      importId,
    })
    await ctx.db.patch(projectId, { repositoryId: `programs/${projectId}` })
    await ctx.db.patch(importId, { projectId })
    await ctx.scheduler.runAfter(0, internal.codeStorage.provisionProject, {
      projectId,
    })
    return projectId
  },
})

export const folderImportSource = internalQuery({
  args: { importId: v.id("programImports") },
  handler: async (ctx, { importId }) => ctx.db.get(importId),
})

export const folderImportBatch = internalQuery({
  args: { importId: v.id("programImports"), sequence: v.number() },
  handler: async (ctx, { importId, sequence }) =>
    ctx.db
      .query("programImportBatches")
      .withIndex("by_import_sequence", (q) =>
        q.eq("importId", importId).eq("sequence", sequence)
      )
      .unique(),
})

export const cleanupFolderImport = internalMutation({
  args: { importId: v.id("programImports") },
  handler: async (ctx, { importId }) => {
    const session = await ctx.db.get(importId)
    if (!session) return
    const project = session.projectId
      ? await ctx.db.get(session.projectId)
      : null
    // Retain failed imports so the existing repository retry can use their files.
    if (project && project.repositoryStatus !== "ready") return
    if (!project && session.expiresAt > Date.now()) return
    const batches = await ctx.db
      .query("programImportBatches")
      .withIndex("by_import_sequence", (q) => q.eq("importId", importId))
      .take(10)
    for (const batch of batches) await ctx.db.delete(batch._id)
    if (batches.length === 10)
      await ctx.scheduler.runAfter(0, internal.projects.cleanupFolderImport, {
        importId,
      })
    else {
      if (project) await ctx.db.patch(project._id, { importId: undefined })
      await ctx.db.delete(importId)
    }
  },
})
