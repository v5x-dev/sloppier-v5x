// A person's keyboard shortcuts, kept in their browser. Only the changes are stored, so an
// action with its default keys is never written. Storage can be missing, full, or blocked
// (private windows, disabled site data), so every read and write is wrapped and the editor
// keeps working on the defaults when it fails.

import {
  defaultBindings,
  overridesFrom,
  rebind,
  resolveOverrides,
  serializeOverrides,
  type ActionId,
  type Bindings,
  type RebindResult,
} from "./keys"

export const KEYS_STORAGE_KEY = "v5x:design-keys"

export type KeyStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export type KeyStore = {
  get: () => Bindings
  subscribe: (listener: () => void) => () => void
  /** Gives an action new keys, or explains why it cannot. Saves on success. */
  set: (id: ActionId, combos: readonly string[]) => RebindResult
  /** Puts one action back to its default keys. */
  reset: (id: ActionId) => void
  /** Puts every action back to its default keys. */
  resetAll: () => void
  /** Action ids whose saved keys were dropped on load, because they were unreadable or clashed. */
  droppedOnLoad: readonly string[]
}

export function createKeyStore(storage: KeyStorage | undefined): KeyStore {
  const loaded = resolveOverrides(readSaved(storage))
  let bindings: Bindings = loaded.bindings
  const droppedOnLoad = loaded.dropped
  const listeners = new Set<() => void>()

  const commit = (next: Bindings) => {
    bindings = next
    writeSaved(storage, overridesFrom(next))
    for (const listener of listeners) listener()
  }

  return {
    get: () => bindings,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(id, combos) {
      const result = rebind(bindings, id, combos)
      if (result.ok) commit(result.bindings)
      return result
    },
    reset(id) {
      // If another action has since taken this one's default keys, that action goes back to
      // its own defaults, so no two actions ever share a key.
      const others: Record<string, readonly string[]> = {
        ...overridesFrom(bindings),
      }
      delete others[id]
      commit(resolveOverrides({ bindings: others }).bindings)
    },
    resetAll() {
      commit(defaultBindings())
    },
    droppedOnLoad,
  }
}

function readSaved(storage: KeyStorage | undefined): unknown {
  try {
    const text = storage?.getItem(KEYS_STORAGE_KEY)
    if (!text) return undefined
    return JSON.parse(text)
  } catch {
    // Unreadable storage means the defaults, not a crash.
    return undefined
  }
}

function writeSaved(
  storage: KeyStorage | undefined,
  overrides: Parameters<typeof serializeOverrides>[0]
): void {
  try {
    if (Object.keys(overrides).length === 0)
      storage?.removeItem(KEYS_STORAGE_KEY)
    else storage?.setItem(KEYS_STORAGE_KEY, serializeOverrides(overrides))
  } catch {
    // The change still applies for this visit; it just will not survive a reload.
  }
}

/** The browser's storage, or nothing when the page cannot reach it. */
function browserStorage(): KeyStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

/** The one store the editor uses. */
export const keyStore: KeyStore = createKeyStore(browserStorage())
