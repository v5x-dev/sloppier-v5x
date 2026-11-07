import { isLanguageFile } from "./language-service"
import { waitForSourceSync } from "./build-program"

type FormatActions = Record<string, (() => Promise<void>) | null>
/** The formatting actions the open editors have registered, and a way to hear when that changes. */
export type FormatRegistry = {
  get: () => FormatActions
  subscribe: (listener: () => void) => () => void
}

/** Resolves with a file's format action as soon as its editor registers one, or rejects when the signal ends. */
function whenFormatAction(
  registry: FormatRegistry,
  path: string,
  signal: AbortSignal
) {
  return new Promise<() => Promise<void>>((resolve, reject) => {
    const finish = () => {
      unsubscribe()
      signal.removeEventListener("abort", aborted)
    }
    const aborted = () => {
      finish()
      reject(signal.reason)
    }
    const check = () => {
      const action = registry.get()[path]
      if (!action) return
      finish()
      resolve(action)
    }
    const unsubscribe = registry.subscribe(check)
    signal.addEventListener("abort", aborted)
    check()
  })
}

export async function commitFormattedSource(
  source: {
    isSynced: () => boolean
    subscribe: (listener: () => void) => () => void
    getSnapshot: () => {
      dirtyPaths: string[]
      openPaths: string[]
      activePath: string | null
    }
    getDrafts: () => ReadonlyMap<string, string>
    openFile: (path: string) => void
    commit: (message?: string) => Promise<void>
  },
  registry: FormatRegistry,
  message: string | undefined,
  signal: AbortSignal
) {
  await waitForSourceSync(source.isSynced, signal, source.subscribe)
  const paths = source.getSnapshot().dirtyPaths.filter(isLanguageFile)
  const active = source.getSnapshot().activePath
  for (const path of paths) {
    if (!source.getSnapshot().openPaths.includes(path)) source.openFile(path)
  }
  if (active && source.getSnapshot().activePath !== active)
    source.openFile(active)
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15_000)])
  const formatted = new Map<string, string | undefined>()
  for (const path of paths) {
    // The file's editor opens with the commit; it registers its formatter once it has mounted.
    const action = await whenFormatAction(registry, path, deadline)
    await action()
    formatted.set(path, source.getDrafts().get(path))
  }
  await waitForSourceSync(source.isSynced, signal, source.subscribe)
  const unexpected = source
    .getSnapshot()
    .dirtyPaths.filter((path) => isLanguageFile(path) && !paths.includes(path))
  if (
    unexpected.length ||
    [...formatted].some(([path, text]) => source.getDrafts().get(path) !== text)
  )
    throw new Error("Source changed while formatting. Try committing again.")
  await source.commit(message)
}
