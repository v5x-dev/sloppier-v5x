"use node"

import { internal } from "../../_generated/api"
import { action, internalAction } from "../../_generated/server"
import type { Id } from "../../_generated/dataModel"
import { ConvexError, v } from "convex/values"
import { validateRepositoryPath } from "../paths"
import {
  requireAuthorizedProgram,
  storage,
  commitChanges,
  commitAuthor,
  publicErrorMessage,
} from "./repository"

export function liveActions() {
  const openLiveFile = action({
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

  const persistCrdtUpdate = internalAction({
    args: { updateRowId: v.id("crdtUpdates") },
    handler: async (ctx, args) => {
      await ctx.runMutation(internal.backups.enqueueUpdate, args)
    },
  })

  const persistProgramUpdates = internalAction({
    args: { jobId: v.id("crdtBackupJobs"), generation: v.number() },
    handler: async (ctx, args) => {
      const batch = await ctx.runQuery(internal.backups.batch, args)
      if (!batch) return
      const updateIds = batch.updates.map((update) => update._id)
      try {
        if (!batch.updates.length) {
          await ctx.runMutation(internal.backups.complete, {
            ...args,
            updateIds,
          })
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
  return { openLiveFile, persistCrdtUpdate, persistProgramUpdates }
}
