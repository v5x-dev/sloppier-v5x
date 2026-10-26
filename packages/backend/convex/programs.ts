import { internal } from "./_generated/api"
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { ConvexError, v } from "convex/values"
import {
  requireIdentity,
  requireProgramMembership,
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
      .query("programs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect()
  },
})

export const rename = mutation({
  args: { programId: v.id("programs"), name: v.string() },
  handler: async (ctx, { programId, name }) => {
    await requireProgramMembership(ctx, programId)
    name = name.trim()
    if (!name || name.length > 80)
      throw new ConvexError("Program name must contain 1–80 characters.")
    await ctx.db.patch(programId, { name })
  },
})

export const setArchived = mutation({
  args: { programId: v.id("programs"), archived: v.boolean() },
  handler: async (ctx, { programId, archived }) => {
    await requireProgramMembership(ctx, programId)
    await ctx.db.patch(programId, {
      archivedAt: archived ? Date.now() : undefined,
    })
  },
})

export const get = query({
  args: { programId: v.id("programs") },
  handler: async (ctx, { programId }) => {
    await requireProgramMembership(ctx, programId)
    const program = await ctx.db.get(programId)
    if (!program) {
      throw new ConvexError("Program not found.")
    }
    return program
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
      throw new ConvexError("Program name must be at most 80 characters.")
    }

    const programId = await ctx.db.insert("programs", {
      workspaceId: args.workspaceId,
      name,
      template: args.template,
      repositoryId: "pending",
      repositoryStatus: "provisioning",
      createdBy: identity.subject,
      createdAt: Date.now(),
    })

    await ctx.db.patch(programId, {
      repositoryId: `programs/${programId}`,
    })

    await scheduleProvisioning(ctx, programId)

    return programId
  },
})

export const retryProvisioning = mutation({
  args: { programId: v.id("programs") },
  handler: async (ctx, { programId }) => {
    await requireProgramMembership(ctx, programId)
    const program = await ctx.db.get(programId)

    if (!program) {
      throw new ConvexError("Program not found.")
    }
    if (program.repositoryStatus === "ready") {
      return programId
    }

    await ctx.db.patch(programId, {
      repositoryStatus: "provisioning",
      repositoryError: undefined,
    })
    await scheduleProvisioning(ctx, programId)
    return programId
  },
})

export const getRepositoryForMember = internalQuery({
  args: { programId: v.id("programs"), userId: v.string() },
  handler: async (ctx, { programId, userId }) => {
    const program = await ctx.db.get(programId)
    if (!program) {
      throw new ConvexError("Program not found.")
    }

    const membership = await ctx.db
      .query("workspaceMembers")
      .withIndex("by_workspace_user", (q) =>
        q.eq("workspaceId", program.workspaceId).eq("userId", userId)
      )
      .unique()

    if (!membership) {
      throw new ConvexError("You do not have access to this program.")
    }
    if (program.repositoryStatus !== "ready") {
      throw new ConvexError("The program repository is not ready yet.")
    }
    return program
  },
})

export const getForProvisioning = internalQuery({
  args: { programId: v.id("programs") },
  handler: async (ctx, { programId }) => ctx.db.get(programId),
})

export const markRepositoryReady = internalMutation({
  args: {
    programId: v.id("programs"),
    headSha: v.string(),
    files: v.array(v.string()),
    origin: v.optional(v.union(v.literal("template"), v.literal("user"))),
  },
  handler: async (ctx, { programId, headSha, files, origin }) => {
    const program = await ctx.db.get(programId)
    if (!program) {
      return
    }

    const now = Date.now()
    await ctx.db.patch(programId, {
      repositoryStatus: "ready",
      repositoryHeadSha: headSha,
      repositoryError: undefined,
    })

    for (const path of files) {
      const existing = await ctx.db
        .query("files")
        .withIndex("by_program_path", (q) =>
          q.eq("programId", programId).eq("path", path)
        )
        .unique()

      if (existing) {
        await ctx.db.patch(existing._id, { updatedAt: now })
      } else {
        await ctx.db.insert("files", {
          programId,
          path,
          origin: origin ?? "template",
          createdBy: program.createdBy,
          createdAt: now,
          updatedAt: now,
        })
      }
    }
  },
})

export const markRepositoryFailed = internalMutation({
  args: { programId: v.id("programs"), message: v.string() },
  handler: async (ctx, { programId, message }) => {
    const program = await ctx.db.get(programId)
    if (!program || program.repositoryStatus === "ready") {
      return
    }
    await ctx.db.patch(programId, {
      repositoryStatus: "failed",
      repositoryError: message.slice(0, 500),
    })
  },
})

export const recordRepositoryHead = internalMutation({
  args: { programId: v.id("programs"), headSha: v.string() },
  handler: async (ctx, { programId, headSha }) => {
    const program = await ctx.db.get(programId)
    if (program?.repositoryStatus === "ready") {
      await ctx.db.patch(programId, { repositoryHeadSha: headSha })
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
      internal.programs.cleanupFolderImport,
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
    if (session.programId || session.expiresAt <= Date.now())
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
    if (session.programId) return session.programId
    if (session.expiresAt <= Date.now())
      throw new ConvexError("Folder import expired. Choose the folder again.")
    if (session.paths.length !== session.expectedFiles)
      throw new ConvexError("Finish uploading all folder files first.")
    const programId = await ctx.db.insert("programs", {
      workspaceId: session.workspaceId,
      name: session.name,
      template: session.template,
      repositoryId: "pending",
      repositoryStatus: "provisioning",
      createdBy: identity.subject,
      createdAt: Date.now(),
      importId,
    })
    await ctx.db.patch(programId, { repositoryId: `programs/${programId}` })
    await ctx.db.patch(importId, { programId })
    await scheduleProvisioning(ctx, programId)
    return programId
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
    const program = session.programId
      ? await ctx.db.get(session.programId)
      : null
    // Retain failed imports so the existing repository retry can use their files.
    if (program && program.repositoryStatus !== "ready") return
    if (!program && session.expiresAt > Date.now()) return
    const batches = await ctx.db
      .query("programImportBatches")
      .withIndex("by_import_sequence", (q) => q.eq("importId", importId))
      .take(10)
    for (const batch of batches) await ctx.db.delete(batch._id)
    if (batches.length === 10)
      await ctx.scheduler.runAfter(0, internal.programs.cleanupFolderImport, {
        importId,
      })
    else {
      if (program) await ctx.db.patch(program._id, { importId: undefined })
      await ctx.db.delete(importId)
    }
  },
})

// Runtime crashes bypass an action's catch block. Check its scheduler result
// separately so a failed setup always exposes the retry button.
async function scheduleProvisioning(
  ctx: MutationCtx,
  programId: Id<"programs">
) {
  const jobId = await ctx.scheduler.runAfter(
    0,
    internal.codeStorage.provisionProgram,
    {
      programId,
    }
  )
  await ctx.db.patch(programId, { repositoryProvisioningJob: jobId })
  await ctx.scheduler.runAfter(10_000, internal.programs.checkProvisioning, {
    programId,
    jobId,
  })
}

export const checkProvisioning = internalMutation({
  args: { programId: v.id("programs"), jobId: v.id("_scheduled_functions") },
  handler: async (ctx, { programId, jobId }) => {
    const program = await ctx.db.get(programId)
    if (
      program?.repositoryStatus !== "provisioning" ||
      program.repositoryProvisioningJob !== jobId
    )
      return
    const job = await ctx.db.system.get(jobId)
    if (job?.state.kind === "pending" || job?.state.kind === "inProgress") {
      await ctx.scheduler.runAfter(
        10_000,
        internal.programs.checkProvisioning,
        { programId, jobId }
      )
      return
    }
    await ctx.db.patch(programId, {
      repositoryStatus: "failed",
      repositoryError:
        "Repository setup stopped unexpectedly. Please retry setup.",
    })
  },
})
