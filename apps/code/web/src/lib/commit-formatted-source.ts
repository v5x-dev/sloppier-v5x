import { isLanguageFile } from "./language-service"
import { waitForSourceSync } from "./build-program"

type FormatActions = Record<string, (() => Promise<void>) | null>

export async function commitFormattedSource(
  source: {
    isSynced: () => boolean
    getSnapshot: () => {
      dirtyPaths: string[]
      openPaths: string[]
      activePath: string | null
    }
    getDrafts: () => ReadonlyMap<string, string>
    openFile: (path: string) => void
    commit: (message?: string) => Promise<void>
  },
  actions: () => FormatActions,
  message: string | undefined,
  signal: AbortSignal
) {
  await waitForSourceSync(source.isSynced, signal)
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
    let action = actions()[path]
    while (!action) {
      deadline.throwIfAborted()
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
      action = actions()[path]
    }
    await action()
    formatted.set(path, source.getDrafts().get(path))
  }
  await waitForSourceSync(source.isSynced, signal)
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
