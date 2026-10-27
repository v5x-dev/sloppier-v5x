"use node"

import { replayLiveDocument, LiveReplayError } from "./lib/liveReplay"

import {
  literalPattern,
  matchesSearchPath,
  searchPathGlob,
  SEARCH_SOURCE_EXCLUDES,
  overlaySearch,
  searchText,
  SEARCH_LIMIT,
  type SearchFile,
} from "./lib/programSearch"
import { api, internal } from "./_generated/api"
import { restoreUpdate, visibleHistoryPath } from "./lib/history"
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
import { isBuildDependency, isFirmwarePath } from "./lib/buildDependencies"
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

// Pin one committed source snapshot for direct browser-to-machine builds.
export const buildManifest = action({
  args: { programId: v.id("programs") },
  handler: async (
    ctx,
    { programId }
  ): Promise<{ sha: string; paths: string[] }> => {
    const program = await requireAuthorizedProgram(ctx, programId)
    const repo = storage().repo({
      id: program.repositoryId,
      defaultBranch: "main",
    })
    // Live-edit backups also commit to main, but only under .v5x/. Pin the
    // recorded source head so builds, stale-diagnostic checks, and upload
    // reuse all compare the same SHA that users' commits record.
    const sha =
      program.repositoryHeadSha ??
      (await repo.listCommits({ branch: "main", limit: 1 })).commits[0]?.sha
    if (!sha) throw new Error("Repository has no committed source.")
    const paths: string[] = []
    let cursor: string | undefined
    do {
      const page = await repo.listFiles({ ref: sha, cursor, limit: 500 })
      paths.push(
        ...page.paths.filter(
          (path) =>
            !path.startsWith(".v5x/") &&
            !isBuildDependency(program.template, path)
        )
      )
      if (paths.length > 3000)
        throw new Error("Source snapshot exceeds 3,000 files.")
      cursor = page.hasMore ? page.nextCursor : undefined
      if (page.hasMore && !cursor)
        throw new Error("Source pagination did not advance.")
    } while (cursor)
    return { sha, paths }
  },
})

export const listFiles = action({
  args: {
    programId: v.id("programs"),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { programId, cursor }) => {
    const program = await requireAuthorizedProgram(ctx, programId)
    const repo = storage().repo({
      id: program.repositoryId,
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
    programId: v.id("programs"),
    path: v.string(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { programId, path, cursor }) => {
    const program = await requireAuthorizedProgram(ctx, programId)
    const repo = storage().repo({
      id: program.repositoryId,
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
    programId: v.id("programs"),
    path: v.string(),
    ref: v.optional(v.string()),
    offset: v.optional(v.number()),
    length: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const program = await requireAuthorizedProgram(ctx, args.programId)
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
      id: program.repositoryId,
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
    programId: v.id("programs"),
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
    const program = await ctx.runQuery(
      internal.programs.getRepositoryForMember,
      { programId: args.programId, userId: identity.subject }
    )
    if (!program) {
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
      if (
        change.operation === "put" &&
        (isFirmwarePath(path) || isBuildDependency(program.template, path))
      ) {
        throw new ConvexError(
          `${path} is firmware or a managed build dependency and cannot be committed.`
        )
      }
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
      id: program.repositoryId,
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
      programId: args.programId,
      actorId: identity.subject,
      changes: changes.map(({ operation, path }) => ({ operation, path })),
      moves,
    })
    await ctx.runMutation(internal.programs.recordRepositoryHead, {
      programId: args.programId,
      headSha: result.commitSha,
    })

    return { commitSha: result.commitSha }
  },
})

export const provisionProgram = internalAction({
  args: { programId: v.id("programs") },
  handler: async (ctx, { programId }) => {
    const program = await ctx.runQuery(internal.programs.getForProvisioning, {
      programId,
    })
    if (!program || program.repositoryStatus === "ready") return

    try {
      if (program.importId) {
        const source = await ctx.runQuery(
          internal.programs.folderImportSource,
          { importId: program.importId }
        )
        if (
          !source ||
          source.programId !== programId ||
          source.paths.length !== source.expectedFiles
        )
          throw new Error("Folder import source is incomplete.")
        const repo = await getOrCreateRepository(
          storage(),
          program.repositoryId
        )
        let headSha = ""
        for (let sequence = 0; sequence < source.batches; sequence++) {
          const batch = await ctx.runQuery(
            internal.programs.folderImportBatch,
            { importId: program.importId, sequence }
          )
          if (!batch) throw new Error("Folder import batch is missing.")
          const result = await commitChanges(
            repo,
            batch.files.map((file) => ({
              operation: "put" as const,
              path: file.path,
              contents: new Uint8Array(file.contents),
            })),
            `Import ${program.name} folder`,
            commitAuthor("V5X Import", "imports@v5x.local")
          )
          headSha = result.commitSha
        }
        await ctx.runMutation(internal.programs.markRepositoryReady, {
          programId,
          headSha,
          files: source.paths,
          origin: "user",
        })
        await ctx.scheduler.runAfter(0, internal.programs.cleanupFolderImport, {
          importId: program.importId,
        })
        return
      }
      const files = (
        await loadTemplateFiles(program.template, program.name)
      ).filter(
        (file) =>
          !isFirmwarePath(file.path) &&
          !isBuildDependency(program.template, file.path)
      )
      const store = storage()
      const repo = await getOrCreateRepository(store, program.repositoryId)

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
          `Create ${program.template} program`,
          commitAuthor("V5X Templates", "templates@v5x.local")
        )
        headSha = result.commitSha
      }

      await ctx.runMutation(internal.programs.markRepositoryReady, {
        programId,
        headSha: headSha ?? "",
        files: files.map((file) => file.path),
      })
    } catch (error) {
      await ctx.runMutation(internal.programs.markRepositoryFailed, {
        programId,
        message: publicErrorMessage(error),
      })
    }
  },
})

// Previously scheduled per-update jobs join the same repository queue.
export const persistCrdtUpdate = internalAction({
  args: { updateRowId: v.id("crdtUpdates") },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.backups.enqueueUpdate, args)
  },
})

export const persistProgramUpdates = internalAction({
  args: { jobId: v.id("crdtBackupJobs"), generation: v.number() },
  handler: async (ctx, args) => {
    const batch = await ctx.runQuery(internal.backups.batch, args)
    if (!batch) return
    const updateIds = batch.updates.map((update) => update._id)
    try {
      if (!batch.updates.length) {
        await ctx.runMutation(internal.backups.complete, { ...args, updateIds })
        return
      }
      const repo = storage().repo({
        id: batch.program.repositoryId,
        defaultBranch: "main",
      })
      const result = await commitChanges(
        repo,
        batch.updates.map((update) => ({
          operation: "put" as const,
          path: `.v5x/${update.documentId}-${String(update.sequence).padStart(12, "0")}.bin`,
          contents: new Uint8Array(update.bytes),
        })),
        `Back up ${batch.updates.length} live edits`,
        commitAuthor("V5X Collaborators", "collaborators@users.v5x.local")
      )
      await ctx.runMutation(internal.backups.complete, {
        ...args,
        updateIds,
        commitSha: result.commitSha,
      })
    } catch (error) {
      await ctx.runMutation(internal.backups.complete, {
        ...args,
        updateIds,
        error: publicErrorMessage(error),
      })
    }
  },
})

async function requireAuthorizedProgram(
  ctx: ActionCtx,
  programId: Id<"programs">
) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) {
    throw new ConvexError("Authentication required.")
  }
  return ctx.runQuery(internal.programs.getRepositoryForMember, {
    programId,
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

async function listAllPaths(repo: Repo, ref = "main") {
  const paths = new Set<string>()
  let cursor: string | undefined

  do {
    const page = await repo.listFiles({ ref, cursor, limit: 500 })
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
  args: { programId: v.id("programs"), path: v.string() },
  handler: async (ctx, args): Promise<Id<"crdtDocuments">> => {
    const program = await requireAuthorizedProgram(ctx, args.programId)
    const path = validateRepositoryPath(args.path)
    const existing = await ctx.runQuery(internal.crdt.documentExists, {
      programId: args.programId,
      path,
    })
    if (existing) return existing
    const repo = storage().repo({
      id: program.repositoryId,
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
    const identity = await ctx.auth.getUserIdentity()
    return ctx.runMutation(internal.crdt.initializeDocument, {
      programId: args.programId,
      path,
      actorId: identity!.subject,
      contents,
    })
  },
})

function validateHistorySha(sha: string) {
  if (!/^[a-f0-9]{40,64}$/i.test(sha))
    throw new ConvexError("Invalid commit reference.")
  return sha
}

export const history = action({
  args: { programId: v.id("programs"), cursor: v.optional(v.string()) },
  handler: async (ctx, { programId, cursor }) => {
    const program = await requireAuthorizedProgram(ctx, programId)
    const repo = storage().repo({
      id: program.repositoryId,
      defaultBranch: "main",
    })
    const page = await repo.listCommits({ branch: "main", cursor, limit: 30 })
    // Backup commits contain only reserved .v5x paths. Inspect paths rather than messages.
    const commits: Array<{
      sha: string
      message: string
      author: string
      date: string
    }> = []
    for (let index = 0; index < page.commits.length; index += 5) {
      const batch = page.commits.slice(index, index + 5)
      const diffs = await Promise.all(
        batch.map((commit) => repo.getCommitDiff({ sha: commit.sha }))
      )
      batch.forEach((commit, offset) => {
        const diff = diffs[offset]
        if (
          [...diff.files, ...diff.filteredFiles].some((file) =>
            visibleHistoryPath(file.path)
          )
        )
          commits.push({
            sha: commit.sha,
            message: commit.message,
            author: commit.authorName,
            date: commit.date.toISOString(),
          })
      })
    }
    return {
      commits,
      hasMore: page.hasMore,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    }
  },
})

export const historyFiles = action({
  args: { programId: v.id("programs"), sha: v.string() },
  handler: async (ctx, { programId, sha }) => {
    const program = await requireAuthorizedProgram(ctx, programId)
    const repo = storage().repo({
      id: program.repositoryId,
      defaultBranch: "main",
    })
    const diff = await repo.getCommitDiff({ sha: validateHistorySha(sha) })
    return [...diff.files, ...diff.filteredFiles]
      .filter((file) => visibleHistoryPath(file.path))
      .map((file) => ({ path: file.path, state: file.state }))
  },
})

export const historyDiff = action({
  args: { programId: v.id("programs"), sha: v.string(), path: v.string() },
  handler: async (ctx, { programId, sha, path }) => {
    const program = await requireAuthorizedProgram(ctx, programId)
    const repo = storage().repo({
      id: program.repositoryId,
      defaultBranch: "main",
    })
    const diff = await repo.getCommitDiff({
      sha: validateHistorySha(sha),
      paths: [validateRepositoryPath(path)],
    })
    const file = diff.files.find((file) => file.path === path)
    if (!file || new TextEncoder().encode(file.raw).length > 512 * 1024)
      return {
        raw: null,
        message: "This file is binary or too large to preview.",
      }
    return { raw: file.raw, message: null }
  },
})

// Restore the complete Git tree, rather than reconstructing a commit from its diff.
export const restoreHistoryCommit = action({
  args: { programId: v.id("programs"), sha: v.string() },
  handler: async (ctx, { programId, sha }): Promise<{ commitSha: string }> => {
    const program = await requireAuthorizedProgram(ctx, programId)
    validateHistorySha(sha)
    const identity = (await ctx.auth.getUserIdentity())!
    const repo = storage().repo({
      id: program.repositoryId,
      defaultBranch: "main",
    })
    const branches = await repo.listBranches({ limit: 100 })
    const headSha = branches.branches.find(
      (branch) => branch.name === "main"
    )?.headSha
    if (!headSha) throw new ConvexError("The program branch was not found.")
    const paths = await listAllPaths(repo, sha)
    const result = await repo.restoreCommit({
      targetBranch: "main",
      targetCommitSha: sha,
      expectedHeadSha: headSha,
      commitMessage: `Restore program to ${sha.slice(0, 8)}`,
      author: commitAuthor(
        identity.name ?? "V5X User",
        identity.email ?? "user@v5x.local"
      ),
    })
    await ctx.runMutation(internal.files.applyCommitRestore, {
      programId,
      actorId: identity.subject,
      headSha: result.commitSha,
      paths: [...paths].filter(visibleHistoryPath),
    })
    return { commitSha: result.commitSha }
  },
})

export const restoreHistoryFile = action({
  args: { programId: v.id("programs"), sha: v.string(), path: v.string() },
  handler: async (
    ctx,
    { programId, sha, path }
  ): Promise<{
    commitSha: string
    contents: string
    warning: string | null
  }> => {
    const program = await requireAuthorizedProgram(ctx, programId)
    validateHistorySha(sha)
    validateRepositoryPath(path)
    const repo = storage().repo({
      id: program.repositoryId,
      defaultBranch: "main",
    })
    const response = await repo.getFileStream({
      path,
      ref: sha,
      headers: { range: "bytes=0-262144" },
    })
    const empty =
      response.status === 416 &&
      response.headers.get("content-range") === "bytes */0"
    if (!response.ok && !empty)
      throw new ConvexError("This file does not exist at the selected commit.")
    const bytes = empty ? new ArrayBuffer(0) : await response.arrayBuffer()
    const total = Number(
      response.headers.get("content-range")?.split("/").at(-1)
    )
    if (bytes.byteLength > 256 * 1024 || total > bytes.byteLength)
      throw new ConvexError(
        "Only text files up to 256 KiB can be restored here."
      )
    let contents: string
    try {
      contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch {
      throw new ConvexError("Only UTF-8 text files can be restored here.")
    }
    if (contents.includes("\0"))
      throw new ConvexError("Binary files cannot be restored here.")
    // Build a normal Yjs replacement so concurrent edits remain mergeable.
    let replay
    try {
      replay = await replayLiveDocument(
        (afterSequence) =>
          ctx.runQuery(api.crdt.updatesSince, {
            programId,
            path,
            afterSequence,
          }),
        { used: 0, limit: 8 * 1024 * 1024 }
      )
    } catch (error) {
      if (error instanceof LiveReplayError) {
        if (error.reason === "limit")
          throw new ConvexError(
            "This live document is too large to restore here."
          )
        throw new ConvexError("The live file changed. Try again.")
      }
      throw error
    }
    const { documentId } = replay
    const update = documentId
      ? restoreUpdate([replay.snapshot], contents)
      : null
    if (update && update.byteLength > 512 * 1024)
      throw new ConvexError("This restore exceeds the live editing limit.")
    const result = await ctx.runAction(api.codeStorage.commitFiles, {
      programId,
      message: `Restore ${path} from ${sha.slice(0, 8)}`.slice(0, 200),
      changes: [{ operation: "put", path, contents }],
    })
    let warning: string | null = null
    if (documentId && update) {
      try {
        await ctx.runMutation(api.crdt.appendUpdate, {
          programId,
          path,
          documentId,
          updateId: `restore-${result.commitSha}`,
          bytes: update,
        })
      } catch {
        warning =
          "The restore commit was saved, but the live editor changed during restore. Reopen the program to load the saved version."
      }
    }
    return { commitSha: result.commitSha, contents, warning }
  },
})

export const searchProgram = action({
  args: {
    programId: v.id("programs"),
    query: v.string(),
    matchCase: v.boolean(),
    sourceOnly: v.optional(v.boolean()),
    pathFilter: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { programId, query, matchCase, sourceOnly, pathFilter }
  ): Promise<{ files: SearchFile[]; truncated: boolean; skipped: number }> => {
    const program = await requireAuthorizedProgram(ctx, programId)
    if (!query || query.length > 200 || /[\r\n]/.test(query))
      throw new ConvexError(
        "Search requires a single line of up to 200 characters."
      )
    if (pathFilter && (pathFilter.length > 200 || /[\r\n\0]/.test(pathFilter)))
      throw new ConvexError(
        "Path filters must be a single line of up to 200 characters."
      )
    const filters = { sourceOnly, pathFilter }
    const repo = storage().repo({
      id: program.repositoryId,
      defaultBranch: "main",
    })
    const files: SearchFile[] = []
    let cursor: string | undefined
    let hasMore = false
    for (let page = 0; page < 20; page++) {
      const committed = await repo.grep({
        ref: "main",
        query: { pattern: literalPattern(query), caseSensitive: matchCase },
        fileFilters: {
          excludeGlobs: [
            ".v5x/**",
            ...(sourceOnly ? SEARCH_SOURCE_EXCLUDES : []),
          ],
          ...(pathFilter?.trim()
            ? { includeGlobs: [searchPathGlob(pathFilter)] }
            : {}),
        },
        context: { before: 0, after: 0 },
        limits: {
          maxLines: SEARCH_LIMIT + 1,
          maxMatchesPerFile: SEARCH_LIMIT + 1,
        },
        pagination: { limit: SEARCH_LIMIT + 1, cursor },
      })
      files.push(
        ...committed.matches
          .filter((file) => matchesSearchPath(file.path, filters))
          .map((file) => ({
            path: file.path,
            matches: file.lines.flatMap((line) =>
              searchText(line.text, query, matchCase, SEARCH_LIMIT + 1).map(
                (match) => ({ ...match, line: line.lineNumber })
              )
            ),
          }))
      )
      hasMore = committed.hasMore
      if (
        !hasMore ||
        files.reduce((count, file) => count + file.matches.length, 0) >
          SEARCH_LIMIT
      )
        break
      if (!committed.nextCursor || committed.nextCursor === cursor) break
      cursor = committed.nextCursor
    }
    const docs = await ctx.runQuery(api.search.liveDocuments, { programId })
    const drafts = new Map<string, string>()
    let skipped = 0
    const replayBudget = { used: 0, limit: 16 * 1024 * 1024 }
    for (const [index, document] of docs
      .filter((document) => matchesSearchPath(document.path, filters))
      .entries()) {
      // Never show a committed match as current when its live text could not be read.
      drafts.set(document.path, "")
      if (index >= 100 || replayBudget.used >= replayBudget.limit) {
        skipped++
        continue
      }
      try {
        const replay = await replayLiveDocument(
          (afterSequence) =>
            ctx.runQuery(api.crdt.updatesSince, {
              programId,
              path: document.path,
              afterSequence,
            }),
          replayBudget,
          document.id
        )
        drafts.set(document.path, replay.contents)
      } catch {
        skipped++
      }
    }
    const result = overlaySearch(files, drafts, query, matchCase, filters)
    return {
      ...result,
      truncated: result.truncated || hasMore,
      skipped,
    }
  },
})
