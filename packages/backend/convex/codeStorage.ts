"use node"

import * as Y from "yjs"
import { internal } from "./_generated/api"
import { action, internalAction, type ActionCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import {
  ApiError,
  GitStorage,
  RefUpdateError,
  type Repo,
} from "@pierre/storage"
import { ConvexError, v } from "convex/values"
import { loadTemplateFiles } from "./lib/templates"
import { validateRepositoryPath } from "./lib/paths"

const MAX_COMMIT_BYTES = 512 * 1024
const MAX_READ_BYTES = 512 * 1024
const MAX_COMMIT_ATTEMPTS = 5

const fileChangeValidator = v.union(
  v.object({
    operation: v.literal("put"),
    path: v.string(),
    contents: v.union(v.string(), v.bytes()),
  }),
  v.object({ operation: v.literal("delete"), path: v.string() })
)

export const listFiles = action({
  args: {
    projectId: v.id("projects"),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, cursor }) => {
    const project = await requireAuthorizedProject(ctx, projectId)
    const repo = storage().repo({
      id: project.repositoryId,
      defaultBranch: "main",
    })
    const result = await repo.listFiles({
      ref: "main",
      cursor,
      limit: 500,
    })
    return {
      paths: result.paths,
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      hasMore: result.hasMore,
    }
  },
})

export const fileHistory = action({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, path, cursor }) => {
    const project = await requireAuthorizedProject(ctx, projectId)
    const repo = storage().repo({
      id: project.repositoryId,
      defaultBranch: "main",
    })
    const result = await repo.listCommits({
      branch: "main",
      path: validateRepositoryPath(path),
      cursor,
      limit: 30,
    })
    return {
      commits: result.commits.map((commit) => ({
        sha: commit.sha,
        message: commit.message,
        author: commit.authorName,
        date: commit.date.toISOString(),
      })),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      hasMore: result.hasMore,
    }
  },
})

export const readFile = action({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    ref: v.optional(v.string()),
    offset: v.optional(v.number()),
    length: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const project = await requireAuthorizedProject(ctx, args.projectId)
    const path = validateReadPath(args.path)
    if (args.ref && !/^[a-f0-9]{40,64}$/i.test(args.ref))
      throw new ConvexError("Invalid commit reference.")
    const offset = args.offset ?? 0
    const length = args.length ?? 256 * 1024
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > MAX_READ_BYTES ||
      !Number.isSafeInteger(offset + length - 1)
    ) {
      throw new ConvexError("File reads must use a valid range up to 512 KiB.")
    }

    const repo = storage().repo({
      id: project.repositoryId,
      defaultBranch: "main",
    })
    const response = await repo.getFileStream({
      path,
      ref: args.ref ?? "main",
      headers: { range: `bytes=${offset}-${offset + length - 1}` },
    })
    if (!response.ok) {
      throw new ConvexError(
        `Code Storage could not read this range (${response.status}).`
      )
    }
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength > MAX_READ_BYTES || bytes.byteLength > length) {
      throw new ConvexError("File response exceeded the requested read range.")
    }
    if (offset > 0 && response.status !== 206) {
      throw new ConvexError(
        "Code Storage did not honor the requested byte range."
      )
    }
    return {
      bytes,
      contentType:
        response.headers.get("content-type") ?? "application/octet-stream",
      contentRange: response.headers.get("content-range"),
    }
  },
})

export const commitFiles = action({
  args: {
    projectId: v.id("projects"),
    message: v.string(),
    changes: v.array(fileChangeValidator),
    requireAbsentPaths: v.optional(v.array(v.string())),
    moves: v.optional(v.array(v.object({ from: v.string(), to: v.string() }))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new ConvexError("Authentication required.")
    }
    const project = await ctx.runQuery(
      internal.projects.getRepositoryForMember,
      { projectId: args.projectId, userId: identity.subject }
    )
    if (!project) {
      throw new ConvexError("Program not found.")
    }

    const message = args.message.trim()
    if (message.length === 0 || message.length > 200) {
      throw new ConvexError(
        "Commit message must be between 1 and 200 characters."
      )
    }
    if (args.changes.length === 0 || args.changes.length > 100) {
      throw new ConvexError(
        "A commit must contain between 1 and 100 file changes."
      )
    }

    let totalBytes = 0
    const paths = new Set<string>()
    const changes = args.changes.map((change) => {
      const path = validateRepositoryPath(change.path)
      if (paths.has(path)) {
        throw new ConvexError(`A commit can change ${path} only once.`)
      }
      paths.add(path)
      if (change.operation === "put") {
        totalBytes +=
          typeof change.contents === "string"
            ? new TextEncoder().encode(change.contents).byteLength
            : change.contents.byteLength
        if (totalBytes > MAX_COMMIT_BYTES) {
          throw new ConvexError(
            "A source commit may contain at most 512 KiB of file contents."
          )
        }
        return { ...change, path }
      }
      return { ...change, path }
    })

    const moves = (args.moves ?? []).map(({ from, to }) => ({
      from: validateRepositoryPath(from),
      to: validateRepositoryPath(to),
    }))
    const moveSources = new Set<string>()
    const moveTargets = new Set<string>()
    for (const move of moves) {
      if (
        moveSources.has(move.from) ||
        moveTargets.has(move.to) ||
        !changes.some(
          (change) => change.path === move.from && change.operation === "delete"
        ) ||
        !changes.some(
          (change) => change.path === move.to && change.operation === "put"
        )
      ) {
        throw new ConvexError(
          "Each moved file requires one source deletion and one destination write."
        )
      }
      moveSources.add(move.from)
      moveTargets.add(move.to)
    }
    const repo = storage().repo({
      id: project.repositoryId,
      defaultBranch: "main",
    })
    const result = await commitChanges(
      repo,
      changes.map((change) =>
        change.operation === "put"
          ? {
              operation: "put" as const,
              path: change.path,
              contents:
                typeof change.contents === "string"
                  ? change.contents
                  : new Uint8Array(change.contents),
            }
          : { operation: "delete" as const, path: change.path }
      ),
      message,
      commitAuthor(
        identity.name ?? "V5X User",
        identity.email ?? "user@v5x.local"
      ),
      [
        ...(args.requireAbsentPaths ?? []).map((path) =>
          validateRepositoryPath(path)
        ),
        ...moves.map(({ to }) => to),
      ]
    )

    await ctx.runMutation(internal.files.applyRepositoryChanges, {
      projectId: args.projectId,
      actorId: identity.subject,
      changes: changes.map(({ operation, path }) => ({ operation, path })),
      moves,
    })
    await ctx.runMutation(internal.projects.recordRepositoryHead, {
      projectId: args.projectId,
      headSha: result.commitSha,
    })

    return { commitSha: result.commitSha }
  },
})

export const provisionProject = internalAction({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.runQuery(internal.projects.getForProvisioning, {
      projectId,
    })
    if (!project || project.repositoryStatus === "ready") return

    try {
      const files = await loadTemplateFiles(project.template, project.name)
      const store = storage()
      const repo = await getOrCreateRepository(store, project.repositoryId)

      const branches = await repo.listBranches({ limit: 100 })
      const main = branches.branches.find((branch) => branch.name === "main")
      let headSha = main?.headSha

      const existingPaths = main ? await listAllPaths(repo) : new Set<string>()
      const missingFiles = files.filter((file) => !existingPaths.has(file.path))

      if (missingFiles.length > 0) {
        const result = await commitChanges(
          repo,
          missingFiles.map((file) => ({
            operation: "put" as const,
            path: file.path,
            contents: file.contents,
          })),
          `Create ${project.template} program`,
          commitAuthor("V5X Templates", "templates@v5x.local")
        )
        headSha = result.commitSha
      }

      await ctx.runMutation(internal.projects.markRepositoryReady, {
        projectId,
        headSha: headSha ?? "",
        files: files.map((file) => file.path),
      })
    } catch (error) {
      await ctx.runMutation(internal.projects.markRepositoryFailed, {
        projectId,
        message: publicErrorMessage(error),
      })
    }
  },
})

export const persistCrdtUpdate = internalAction({
  args: { updateRowId: v.id("crdtUpdates") },
  handler: async (ctx, { updateRowId }) => {
    const record = await ctx.runQuery(internal.crdt.getUpdateForStorage, {
      updateRowId,
    })
    if (!record || record.update.storageStatus === "persisted") return

    try {
      const { update, document, project } = record
      if (project.repositoryStatus !== "ready") {
        throw new Error("Program repository is not ready.")
      }
      const fileName = `${document._id}-${String(update.sequence).padStart(12, "0")}.bin`
      const path = `.v5x/${fileName}`
      const repo = storage().repo({
        id: project.repositoryId,
        defaultBranch: "main",
      })
      const result = await commitChanges(
        repo,
        [{ operation: "put", path, contents: new Uint8Array(update.bytes) }],
        `Persist live edit ${document.path} (${update.sequence})`,
        commitAuthor("V5X Collaborator", `${update.actorId}@users.v5x.local`)
      )
      await ctx.runMutation(internal.crdt.markUpdatePersisted, {
        updateRowId,
        commitSha: result.commitSha,
      })
      await ctx.runMutation(internal.projects.recordRepositoryHead, {
        projectId: project._id,
        headSha: result.commitSha,
      })
    } catch (error) {
      await ctx.runMutation(internal.crdt.markUpdatePersistenceFailed, {
        updateRowId,
        message: publicErrorMessage(error),
      })
    }
  },
})

async function requireAuthorizedProject(
  ctx: ActionCtx,
  projectId: Id<"projects">
) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) {
    throw new ConvexError("Authentication required.")
  }
  return ctx.runQuery(internal.projects.getRepositoryForMember, {
    projectId,
    userId: identity.subject,
  })
}

function storage() {
  const name = process.env.PIERRE_ORG
  const key = process.env.PIERRE_PRIVATE_KEY
  if (!name || !key) {
    throw new ConvexError(
      "Code Storage is not configured on this Convex deployment."
    )
  }
  return new GitStorage({ name, key })
}

async function getOrCreateRepository(
  store: GitStorage,
  repositoryId: string
): Promise<Repo> {
  const existing = await store.findOne({ id: repositoryId })
  if (existing) return existing

  try {
    return await store.createRepo({ id: repositoryId, defaultBranch: "main" })
  } catch (error) {
    // Provision retries can race with a previous action that created the repo.
    const createdByAnotherAttempt = await store.findOne({ id: repositoryId })
    if (createdByAnotherAttempt) return createdByAnotherAttempt
    throw error
  }
}

async function listAllPaths(repo: Repo) {
  const paths = new Set<string>()
  let cursor: string | undefined

  do {
    const page = await repo.listFiles({ ref: "main", cursor, limit: 500 })
    for (const path of page.paths) paths.add(path)
    cursor = page.nextCursor
    if (!page.hasMore) break
    if (!cursor) {
      throw new Error("Code Storage returned an incomplete file listing.")
    }
  } while (true)

  return paths
}

async function commitChanges(
  repo: Repo,
  changes: Array<
    | { operation: "put"; path: string; contents: string | Uint8Array }
    | { operation: "delete"; path: string }
  >,
  message: string,
  author: { name: string; email: string },
  requireAbsentPaths: string[] = []
) {
  for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
    const branches = await repo.listBranches({ limit: 100 })
    const headSha = branches.branches.find(
      (branch) => branch.name === repo.defaultBranch
    )?.headSha
    if (requireAbsentPaths.length > 0) {
      const existing = await listAllPaths(repo)
      for (const path of requireAbsentPaths) {
        if (
          [...existing].some(
            (entry) =>
              entry === path ||
              entry.startsWith(`${path}/`) ||
              path.startsWith(`${entry}/`)
          )
        ) {
          throw new ConvexError(`${path} already exists.`)
        }
      }
    }
    const builder = repo.createCommit({
      targetBranch: repo.defaultBranch,
      expectedHeadSha: headSha,
      commitMessage: message,
      author,
    })

    for (const change of changes) {
      if (change.operation === "put") {
        builder.addFile(change.path, change.contents)
      } else {
        builder.deletePath(change.path)
      }
    }

    try {
      return await builder.send()
    } catch (error) {
      if (
        !(error instanceof RefUpdateError) ||
        attempt === MAX_COMMIT_ATTEMPTS - 1
      ) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
    }
  }

  throw new Error(
    "Could not update the Code Storage repository after repeated conflicts."
  )
}

function commitAuthor(name: string, email: string) {
  return { name, email }
}

function validateReadPath(path: string) {
  return validateRepositoryPath(path, true)
}

function publicErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return `Code Storage returned HTTP ${error.status} ${error.statusText}.`
  }
  if (error instanceof RefUpdateError) {
    return `Code Storage could not update the branch: ${error.message}`
  }
  if (error instanceof Error) {
    return error.message
  }
  return "Code Storage operation failed."
}

export const openLiveFile = action({
  args: { projectId: v.id("projects"), path: v.string() },
  handler: async (ctx, args): Promise<Id<"crdtDocuments">> => {
    const project = await requireAuthorizedProject(ctx, args.projectId)
    const path = validateRepositoryPath(args.path)
    const existing = await ctx.runQuery(internal.crdt.documentExists, {
      projectId: args.projectId,
      path,
    })
    if (existing) return existing
    const repo = storage().repo({
      id: project.repositoryId,
      defaultBranch: "main",
    })
    const response = await repo.getFileStream({
      path,
      ref: "main",
      headers: { range: "bytes=0-524287" },
    })
    if (!response.ok) throw new ConvexError("Could not load the live file.")
    const bytes = await response.arrayBuffer()
    const total = Number(
      response.headers.get("content-range")?.split("/").at(-1)
    )
    if (bytes.byteLength > 256 * 1024 || total > bytes.byteLength)
      throw new ConvexError("This file is too large for live editing.")
    let contents: string
    try {
      contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch {
      throw new ConvexError("Live editing requires a UTF-8 text file.")
    }
    if (contents.includes("\0"))
      throw new ConvexError("Binary files cannot be edited as text.")
    const doc = new Y.Doc()
    try {
      doc.getText("source").insert(0, contents)
      const identity = await ctx.auth.getUserIdentity()
      return await ctx.runMutation(internal.crdt.initializeDocument, {
        projectId: args.projectId,
        path,
        actorId: identity!.subject,
        bytes: Y.encodeStateAsUpdate(doc).buffer as ArrayBuffer,
      })
    } finally {
      doc.destroy()
    }
  },
})
