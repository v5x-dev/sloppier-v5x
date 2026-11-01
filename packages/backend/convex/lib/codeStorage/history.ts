"use node"

import { api, internal } from "../../_generated/api"
import { action } from "../../_generated/server"
import { ConvexError, v } from "convex/values"
import { restoreUpdate, visibleHistoryPath } from "../history"
import { replayLiveDocument, LiveReplayError } from "../liveReplay"
import { validateRepositoryPath } from "../paths"
import {
  requireAuthorizedProgram,
  storage,
  listAllPaths,
  commitAuthor,
  validateHistorySha,
} from "./repository"

export function historyActions() {
  const fileHistory = action({
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

  const history = action({
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

  const createCheckpoint = action({
    args: { programId: v.id("programs"), sha: v.string(), name: v.string() },
    handler: async (ctx, { programId, sha, name }): Promise<void> => {
      const program = await requireAuthorizedProgram(ctx, programId)
      validateHistorySha(sha)
      const repo = storage().repo({
        id: program.repositoryId,
        defaultBranch: "main",
      })
      // Resolve metadata from the Program's history, never from the client.
      let cursor: string | undefined
      do {
        const page = await repo.listCommits({
          branch: "main",
          cursor,
          limit: 100,
        })
        const commit = page.commits.find((item) => item.sha === sha)
        if (commit) {
          const diff = await repo.getCommitDiff({ sha })
          if (
            ![...diff.files, ...diff.filteredFiles].some((file) =>
              visibleHistoryPath(file.path)
            )
          )
            throw new ConvexError("Choose a source commit for this checkpoint.")
          await ctx.runMutation(internal.checkpoints.save, {
            programId,
            sha,
            name,
            message: commit.message,
            author: commit.authorName,
            date: commit.date.toISOString(),
          })
          return
        }
        if (!page.hasMore) break
        if (!page.nextCursor || page.nextCursor === cursor)
          throw new ConvexError("Could not search Program history.")
        cursor = page.nextCursor
      } while (cursor)
      throw new ConvexError("Commit not found in Program history.")
    },
  })

  const historyFiles = action({
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

  const historyDiff = action({
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

  const restoreHistoryCommit = action({
    args: { programId: v.id("programs"), sha: v.string() },
    handler: async (
      ctx,
      { programId, sha }
    ): Promise<{ commitSha: string }> => {
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

  const restoreHistoryFile = action({
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
        throw new ConvexError(
          "This file does not exist at the selected commit."
        )
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
  return {
    fileHistory,
    history,
    createCheckpoint,
    historyFiles,
    historyDiff,
    restoreHistoryCommit,
    restoreHistoryFile,
  }
}
