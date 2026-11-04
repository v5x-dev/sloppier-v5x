/**
 * Holds values that a later navigation adopts, such as a Program's workbench
 * source started on hover. Entries that are never taken expire.
 */
export function createShortLivedCache<T>(
  ttlMs: number,
  now: () => number = Date.now
) {
  const entries = new Map<string, { value: T; createdAt: number }>()
  const expire = () => {
    const cutoff = now() - ttlMs
    for (const [key, entry] of entries)
      if (entry.createdAt <= cutoff) entries.delete(key)
  }
  return {
    /** Stores a value unless a fresh one already exists for the key. */
    put(key: string, create: () => T) {
      expire()
      if (!entries.has(key))
        entries.set(key, { value: create(), createdAt: now() })
    },
    /** Returns and removes the fresh value for the key, if one exists. */
    take(key: string): T | undefined {
      expire()
      const entry = entries.get(key)
      entries.delete(key)
      return entry?.value
    },
  }
}
