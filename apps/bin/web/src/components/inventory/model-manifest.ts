import { useEffect, useState } from "react"

// Maps each catalog SKU to its 3D model and thumbnail. The file is the same for
// every part, so it is fetched once and shared by the list and the viewer.
export type ModelEntry = { file: string; approximate: boolean }
export type Manifest = Record<string, ModelEntry>

let manifestPromise: Promise<Manifest> | undefined
export function loadManifest(): Promise<Manifest> {
  manifestPromise ??= fetch("/models/manifest.json")
    .then((response) => {
      if (!response.ok) throw new Error("manifest unavailable")
      return response.json() as Promise<Manifest>
    })
    .catch((error: unknown) => {
      manifestPromise = undefined
      throw error
    })
  return manifestPromise
}

// Each model has a flat, single-color icon made by scripts/generate-icons.mjs.
export function iconUrl(entry: ModelEntry) {
  return `/models/icons/${entry.file.replace(/\.glb$/, ".svg")}`
}

// The manifest once it has loaded, or null while it is still on its way. A
// failed load leaves every part without a model, which is the safe default.
// SKU -> protobot icon path, from scripts/map-part-icons.mjs. Parts without one
// fall back to their generated icon.
let partIconsPromise: Promise<Record<string, string>> | undefined
function loadPartIcons() {
  partIconsPromise ??= fetch("/icons/part-icons.json")
    .then((response) => {
      if (!response.ok) throw new Error("part icons unavailable")
      return response.json() as Promise<Record<string, string>>
    })
    .catch(() => {
      partIconsPromise = undefined
      return {}
    })
  return partIconsPromise
}

export function usePartIcons(): Record<string, string> | null {
  const [icons, setIcons] = useState<Record<string, string> | null>(null)
  useEffect(() => {
    let disposed = false
    void loadPartIcons().then((loaded) => {
      if (!disposed) setIcons(loaded)
    })
    return () => {
      disposed = true
    }
  }, [])
  return icons
}

export function useManifest(): Manifest | null {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  useEffect(() => {
    let disposed = false
    loadManifest()
      .then((loaded) => {
        if (!disposed) setManifest(loaded)
      })
      .catch(() => undefined)
    return () => {
      disposed = true
    }
  }, [])
  return manifest
}
