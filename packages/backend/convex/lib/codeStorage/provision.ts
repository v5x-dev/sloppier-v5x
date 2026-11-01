"use node"

import { internal } from "../../_generated/api"
import type { Id } from "../../_generated/dataModel"
import { action, internalAction } from "../../_generated/server"
import { ConvexError, v } from "convex/values"
import { loadTemplateFiles } from "../templates"
import { isBuildDependency, isFirmwarePath } from "../buildDependencies"
import {
  storage,
  getOrCreateRepository,
  listAllPaths,
  commitChanges,
  commitAuthor,
  publicErrorMessage,
  requireAuthorizedProgram,
  validateHistorySha,
} from "./repository"

export function provisionActions() {
  const duplicateProgram = action({
    args: {
      programId: v.id("programs"),
      name: v.string(),
      sha: v.optional(v.string()),
    },
    handler: async (ctx, { programId, name, sha }): Promise<Id<"programs">> => {
      const program = await requireAuthorizedProgram(ctx, programId)
      const identity = await ctx.auth.getUserIdentity()
      if (!identity) throw new ConvexError("Authentication required.")
      const repo = storage().repo({
        id: program.repositoryId,
        defaultBranch: "main",
      })
      let cursor: string | undefined
      let selected: string | undefined
      if (sha) validateHistorySha(sha)
      do {
        const page = await repo.listCommits({
          branch: "main",
          cursor,
          limit: 100,
        })
        selected = sha
          ? page.commits.find((commit) => commit.sha === sha)?.sha
          : page.commits[0]?.sha
        if (selected || !page.hasMore) break
        if (!page.nextCursor || page.nextCursor === cursor)
          throw new ConvexError("Could not search Program history.")
        cursor = page.nextCursor
      } while (cursor)
      if (!selected)
        throw new ConvexError("Commit not found in Program history.")
      return ctx.runMutation(internal.programs.createDuplicate, {
        sourceId: programId,
        userId: identity.subject,
        name,
        sha: selected,
      })
    },
  })
  const provisionProgram = internalAction({
    args: { programId: v.id("programs") },
    handler: async (ctx, { programId }) => {
      const program = await ctx.runQuery(internal.programs.getForProvisioning, {
        programId,
      })
      if (!program || program.repositoryStatus === "ready") return

      try {
        if (program.duplicateSource) {
          const store = storage()
          const source = store.repo({
            id: program.duplicateSource.repositoryId,
            defaultBranch: "main",
          })
          const paths = [
            ...(await listAllPaths(source, program.duplicateSource.sha)),
          ].filter(
            (path) =>
              !path.startsWith(".v5x/") &&
              !isFirmwarePath(path) &&
              !isBuildDependency(program.template, path)
          )
          const repo = await getOrCreateRepository(store, program.repositoryId)
          const changes = await Promise.all(
            paths.map(async (path) => {
              const response = await source.getFileStream({
                path,
                ref: program.duplicateSource!.sha,
              })
              if (!response.ok)
                throw new Error(`Could not copy ${path} (${response.status}).`)
              return {
                operation: "put" as const,
                path,
                contents: new Uint8Array(await response.arrayBuffer()),
              }
            })
          )
          const result = await commitChanges(
            repo,
            changes,
            `Duplicate ${program.name}`,
            commitAuthor("v5x", "code@v5x.local")
          )
          await ctx.runMutation(internal.programs.markRepositoryReady, {
            programId,
            headSha: result.commitSha,
            files: paths,
            origin: "user",
          })
          return
        }
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
          await ctx.scheduler.runAfter(
            0,
            internal.programs.cleanupFolderImport,
            {
              importId: program.importId,
            }
          )
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

        const existingPaths = main
          ? await listAllPaths(repo)
          : new Set<string>()
        const missingFiles = files.filter(
          (file) => !existingPaths.has(file.path)
        )

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
  return { provisionProgram, duplicateProgram }
}
