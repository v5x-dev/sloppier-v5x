import type { ConvexReactClient } from "convex/react"
import { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
import { createShortLivedCache } from "./short-lived-cache"
import { WorkbenchSource } from "./workbench-source"

// Hovering a Program starts its listing, open tabs, and live documents. The
// editor adopts that source when it opens; untaken sources expire.
const EDITOR_PREFETCH_TTL_MS = 30_000
const editorPrefetch = createShortLivedCache<WorkbenchSource>(
  EDITOR_PREFETCH_TTL_MS
)

export function prefetchProgramEditor(
  client: ConvexReactClient,
  programId: Id<"programs">
) {
  editorPrefetch.put(programId, () => {
    const source = new WorkbenchSource(programId, {
      buildManifest: (args) =>
        client.action(api.codeStorage.buildManifest, args),
      listFiles: async (args) => ({
        paths: (
          await client.query(api.files.listByProgram, {
            programId: args.programId,
          })
        ).map((file) => file.path),
        hasMore: false,
      }),
      readFile: (args) => client.action(api.codeStorage.readFile, args),
      openLiveFile: (args) => client.action(api.codeStorage.openLiveFile, args),
      commitFiles: (args) => client.action(api.codeStorage.commitFiles, args),
      restoreHistoryFile: (args) =>
        client.action(api.codeStorage.restoreHistoryFile, args),
      restoreHistoryCommit: (args) =>
        client.action(api.codeStorage.restoreHistoryCommit, args),
    })
    // A hover reads the listing and saved tabs only. Opening a live document
    // records a backup commit, so that waits for navigation.
    source.prefetchPaths({ hover: true })
    return source
  })
}

/** Returns the source a hover started for this Program, if it is still fresh. */
export function takePrefetchedProgramEditor(programId: Id<"programs">) {
  return editorPrefetch.take(programId)
}
