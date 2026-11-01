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

export async function commitChanges(
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
