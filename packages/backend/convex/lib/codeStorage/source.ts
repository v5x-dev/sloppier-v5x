"use node"

import { internal } from "../../_generated/api"
import { action } from "../../_generated/server"
import { ConvexError, v } from "convex/values"
import { isBuildDependency, isFirmwarePath } from "../buildDependencies"
import { validateRepositoryPath } from "../paths"
import {
  requireAuthorizedProgram,
  storage,
  commitChanges,
  commitAuthor,
  validateReadPath,
} from "./repository"

const MAX_COMMIT_BYTES = 512 * 1024
const MAX_READ_BYTES = 512 * 1024
const fileChangeValidator = v.union(
  v.object({
    operation: v.literal("put"),
    path: v.string(),
    contents: v.union(v.string(), v.bytes()),
  }),
  v.object({ operation: v.literal("delete"), path: v.string() })
)

export function sourceActions() {
  const buildManifest = action({
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

  const listFiles = action({
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

  const readFile = action({
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
        throw new ConvexError(
          "File reads must use a valid range up to 512 KiB."
        )
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
        throw new ConvexError(
          "File response exceeded the requested read range."
        )
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

  const commitFiles = action({
    args: {
      programId: v.id("programs"),
      message: v.string(),
      changes: v.array(fileChangeValidator),
      requireAbsentPaths: v.optional(v.array(v.string())),
      moves: v.optional(
        v.array(v.object({ from: v.string(), to: v.string() }))
      ),
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
            (change) =>
              change.path === move.from && change.operation === "delete"
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
  return { buildManifest, listFiles, readFile, commitFiles }
}
