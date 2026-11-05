"use node"

import { internal } from "../../_generated/api"
import type { ActionCtx } from "../../_generated/server"
import type { Id } from "../../_generated/dataModel"
import {
  ApiError,
  GitStorage,
  RefUpdateError,
  type Repo,
} from "@pierre/storage"
import { ConvexError } from "convex/values"
import { validateRepositoryPath } from "../paths"

const MAX_COMMIT_ATTEMPTS = 5

export async function requireAuthorizedProgram(
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

export function storage() {
  const name = process.env.PIERRE_ORG
  const key = process.env.PIERRE_PRIVATE_KEY
  if (!name || !key) {
    throw new ConvexError(
      "Code Storage is not configured on this Convex deployment."
    )
  }
  return new GitStorage({ name, key })
}

export async function getOrCreateRepository(
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

export async function listAllPaths(repo: Repo, ref = "main") {
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

/** Live-edit backups commit to the default branch under `.v5x/` and never record a source head. */
export const LIVE_BACKUP_AUTHOR = commitAuthor(
  "V5X Collaborators",
  "collaborators@users.v5x.local"
)

type HistoryCommit = { sha: string; parentShas: string[]; authorEmail: string }

/**
 * The source head a new commit's snapshot builds on, given the branch head and the recorded head.
 *
 * Live-edit backups advance the branch without recording a head, and they touch only `.v5x/`, which source
 * snapshots exclude. When every commit from the branch head down to the recorded head is such a backup, the
 * recorded head's source files are still the branch's source files. Otherwise the branch head is returned, so
 * callers fall back to a full read.
 *
 * `history` lists the branch newest first, starting at the head it was read for.
 */
export function snapshotParentSha(
  history: { commits: HistoryCommit[] },
  headSha: string,
  recordedSha: string | null | undefined
): string {
  if (!recordedSha || recordedSha === headSha) return headSha
  if (history.commits[0]?.sha !== headSha) return headSha
  for (let index = 0; index < history.commits.length; index++) {
    const commit = history.commits[index]
    if (commit.sha === recordedSha) return recordedSha
    const parent = history.commits[index + 1]
    if (
      commit.authorEmail !== LIVE_BACKUP_AUTHOR.email ||
      commit.parentShas.length !== 1 ||
      parent?.sha !== commit.parentShas[0]
    ) {
      return headSha
    }
  }
  return headSha
}

export async function commitChanges(
  repo: Repo,
  changes: Array<
    | { operation: "put"; path: string; contents: string | Uint8Array }
    | { operation: "delete"; path: string }
  >,
  message: string,
  author: { name: string; email: string },
  requireAbsentPaths: string[] = [],
  recordedHeadSha?: string | null
) {
  for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
    const [branches, existing, history] = await Promise.all([
      repo.listBranches({ limit: 100 }),
      requireAbsentPaths.length > 0 ? listAllPaths(repo) : undefined,
      recordedHeadSha
        ? repo
            .listCommits({ branch: repo.defaultBranch, limit: 100 })
            .catch(() => undefined)
        : undefined,
    ])
    const headSha = branches.branches.find(
      (branch) => branch.name === repo.defaultBranch
    )?.headSha
    if (existing) {
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
      // expectedHeadSha is the commit's parent. parentSha is the snapshot it builds on, which callers use to reuse
      // cached file contents; it can be the recorded head when only live-edit backups sit above it.
      const commit = await builder.send()
      const parentSha =
        headSha && history
          ? snapshotParentSha(history, headSha, recordedHeadSha)
          : (headSha ?? null)
      return { ...commit, parentSha }
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

export function commitAuthor(name: string, email: string) {
  return { name, email }
}

export function validateReadPath(path: string) {
  return validateRepositoryPath(path, true)
}

export function publicErrorMessage(error: unknown) {
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

export function validateHistorySha(sha: string) {
  if (!/^[a-f0-9]{40,64}$/i.test(sha))
    throw new ConvexError("Invalid commit reference.")
  return sha
}
