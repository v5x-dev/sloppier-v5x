"use node"

// Compatibility facade: keep these function names stable for deployed clients
// and scheduled jobs. Capability modules own the implementations and access checks.
import { sourceActions } from "./lib/codeStorage/source"
import { historyActions } from "./lib/codeStorage/history"
import { liveActions } from "./lib/codeStorage/live"
import { provisionActions } from "./lib/codeStorage/provision"
import { searchActions } from "./lib/codeStorage/search"

export const { buildManifest, listFiles, readFile, commitFiles } =
  sourceActions()

export const {
  fileHistory,
  history,
  createCheckpoint,
  historyFiles,
  historyDiff,
  restoreHistoryCommit,
  restoreHistoryFile,
} = historyActions()

export const { openLiveFile, persistCrdtUpdate, persistProgramUpdates } =
  liveActions()

export const { provisionProgram, duplicateProgram } = provisionActions()

export const { searchProgram } = searchActions()
