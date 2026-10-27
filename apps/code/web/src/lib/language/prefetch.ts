let started = false

/** Warm the HTTP cache with the clangd runtime so opening a program only has to compile it. */
export function prefetchLanguageAssets() {
  if (started || typeof window === "undefined") return
  if (!window.crossOriginIsolated) return
  const connection = (navigator as { connection?: { saveData?: boolean } })
    .connection
  if (connection?.saveData) return
  started = true
  const run = async () => {
    try {
      const base = new URL("/language/", location.origin)
      const manifest = (await (
        await fetch(new URL("runtime.json", base))
      ).json()) as Record<string, { wasm: string; js: string } | undefined>
      const supported =
        "Suspending" in WebAssembly && "promising" in WebAssembly
      const artifact = supported
        ? (manifest.jspi ?? manifest.asyncify)
        : manifest.asyncify
      if (!artifact) return
      for (const name of [artifact.js, artifact.wasm])
        await fetch(new URL(name, base), { cache: "force-cache" }).then((r) =>
          r.arrayBuffer()
        )
    } catch {
      started = false
    }
  }
  const idle = (window as { requestIdleCallback?: typeof requestIdleCallback })
    .requestIdleCallback
  if (idle) idle(() => void run(), { timeout: 5000 })
  else setTimeout(() => void run(), 2000)
}
