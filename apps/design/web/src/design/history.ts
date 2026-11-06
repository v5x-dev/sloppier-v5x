// Undo and redo for one person. Every local action is one step, recorded by the document
// with the values it replaced. Undo writes back the old values, but only for a field that
// still holds what this step left there. If someone else has changed that field since, the
// field stays as they left it: remote changes are never undone, and a later move beats an
// earlier one. Undo and redo each run as one edit, so they sync like any other change.

import type * as Y from "yjs"
import {
  LOCAL_ORIGIN,
  changedKeys,
  listenForActions,
  restore,
  sameValue,
  snapshot,
  type Change,
  type Fields,
} from "./document"

export type History = {
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  /** Called whenever the stacks change, so buttons can update. */
  subscribe: (listener: () => void) => () => void
  destroy: () => void
}

export function createHistory(doc: Y.Doc): History {
  const undoSteps: Change[][] = []
  const redoSteps: Change[][] = []
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const stopListening = listenForActions(doc, (changes) => {
    undoSteps.push(changes)
    redoSteps.length = 0
    notify()
  })

  const replay = (step: Change[], direction: "undo" | "redo") => {
    doc.transact(() => {
      for (const change of step) {
        const from = direction === "undo" ? change.after : change.before
        const to = direction === "undo" ? change.before : change.after
        const keys = changedKeys(change.before, change.after)
        if (!matches(snapshot(doc, change.ref), from, keys)) continue
        restore(doc, change.ref, to, keys)
      }
    }, LOCAL_ORIGIN)
  }

  return {
    undo: () => {
      const step = undoSteps.pop()
      if (!step) return
      replay(step, "undo")
      redoSteps.push(step)
      notify()
    },
    redo: () => {
      const step = redoSteps.pop()
      if (!step) return
      replay(step, "redo")
      undoSteps.push(step)
      notify()
    },
    canUndo: () => undoSteps.length > 0,
    canRedo: () => redoSteps.length > 0,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    destroy: () => {
      stopListening()
      listeners.clear()
    },
  }
}

/** Whether the fields this step touched still hold what the step left there. */
function matches(
  current: Fields | null,
  expected: Fields | null,
  keys: readonly string[]
): boolean {
  if (expected === null) return current === null
  if (current === null) return false
  return keys.every((key) => sameValue(current[key], expected[key]))
}
