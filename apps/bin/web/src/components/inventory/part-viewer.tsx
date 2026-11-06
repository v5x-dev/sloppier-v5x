import { CubeIcon } from "@phosphor-icons/react"
import { Spinner } from "@v5x/ui/components/spinner"
import { lazy, Suspense, useCallback, useEffect, useState } from "react"
import {
  loadManifest,
  type ModelEntry,
} from "@/components/inventory/model-manifest"

// three.js and react-three-fiber are large and only needed once a part with a
// model is open, so the scene loads on demand.
const PartScene = lazy(() => import("@/components/inventory/part-scene"))

type Status = "loading" | "ready" | "none" | "error"

// A fixed-size square, so loading and empty states never move the page.
export function PartViewer({
  sku,
  name,
}: {
  sku: string | null
  name: string
}) {
  const [status, setStatus] = useState<Status>(
    sku === null ? "none" : "loading"
  )
  const [entry, setEntry] = useState<ModelEntry | null>(null)
  const onReady = useCallback(() => setStatus("ready"), [])
  const onError = useCallback(() => setStatus("error"), [])

  useEffect(() => {
    if (sku === null) return
    let disposed = false
    loadManifest()
      .then((manifest) => {
        if (disposed) return
        const found = manifest[sku] as ModelEntry | undefined
        if (found === undefined) setStatus("none")
        else setEntry(found)
      })
      .catch(() => {
        if (!disposed) setStatus("error")
      })
    return () => {
      disposed = true
    }
  }, [sku])

  return (
    <div className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={`3D model of ${name}`}
        className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border bg-muted/70 @3xl:aspect-square"
      >
        {entry !== null && status !== "error" ? (
          <Suspense fallback={null}>
            <PartScene
              url={`/models/${entry.file}`}
              onReady={onReady}
              onError={onError}
            />
          </Suspense>
        ) : null}
        {status === "loading" ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        ) : null}
        {status === "none" || status === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <CubeIcon className="size-8" />
            {status === "error"
              ? "The 3D model could not be loaded."
              : sku === null
                ? "Custom parts have no 3D model."
                : "No 3D model for this part yet."}
          </div>
        ) : null}
      </div>
      <p className="min-h-5 text-xs text-muted-foreground">
        {status === "ready"
          ? entry?.approximate
            ? "A related size of this part. Drag to rotate."
            : "Drag to rotate."
          : null}
      </p>
    </div>
  )
}
