import { useSyncExternalStore } from "react"

// Files edited in this app session but not committed yet, per program. Live
// edits are already saved on the server; this only tracks what still needs a
// commit, the same way the web tracks its open drafts. Kept in memory.
const edited = new Map<string, Set<string>>()
const listeners = new Set<() => void>()
const empty: string[] = []
const snapshots = new Map<string, string[]>()

function emit(programId: string) {
  snapshots.delete(programId)
  for (const listener of listeners) listener()
}

export function markEdited(programId: string, path: string) {
  const paths = edited.get(programId) ?? new Set<string>()
  if (paths.has(path)) return
  paths.add(path)
  edited.set(programId, paths)
  emit(programId)
}

export function isEdited(programId: string, path: string) {
  return edited.get(programId)?.has(path) ?? false
}

export function markCommitted(programId: string, paths: readonly string[]) {
  const current = edited.get(programId)
  if (!current) return
  for (const path of paths) current.delete(path)
  emit(programId)
}

function snapshot(programId: string) {
  let value = snapshots.get(programId)
  if (!value) {
    const paths = edited.get(programId)
    value = paths?.size ? [...paths].sort() : empty
    snapshots.set(programId, value)
  }
  return value
}

export function usePendingEdits(programId: string) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => snapshot(programId)
  )
}
