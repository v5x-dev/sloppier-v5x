"use node"

import { internal } from "../../_generated/api"
import { internalAction } from "../../_generated/server"
import { v } from "convex/values"
import { loadTemplateFiles } from "../templates"
import { isBuildDependency, isFirmwarePath } from "../buildDependencies"
import {
  storage,
  getOrCreateRepository,
  listAllPaths,
  commitChanges,
  commitAuthor,
  publicErrorMessage,
} from "./repository"

export function provisionActions() {
  const provisionProgram = internalAction({
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
  return { provisionProgram }
}
