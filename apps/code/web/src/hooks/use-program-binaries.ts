import { useEffect, useState } from "react"
import { useProgramConnection } from "@/components/program/program-connection"
import { errorMessage } from "@/lib/errors"
import type { ArtifactEntries } from "@/lib/build-binaries"

// This map belongs to the client explorer, never to repository drafts or commits.
export function useProgramBinaries() {
  const { status, request } = useProgramConnection()
  const [files, setFiles] = useState<Partial<Record<string, Uint8Array>>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const artifactId = status?.artifactId
  // Status arrives on every poll with a new object, so depend on the index's contents, not its identity.
  const entriesKey = JSON.stringify(status?.artifactEntries ?? null)
  useEffect(() => {
    if (!artifactId) {
      setFiles({})
      setError(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const { loadArtifactFiles } = await import("@/lib/build-binaries")
        const entries = JSON.parse(entriesKey) as ArtifactEntries | null
        const loaded = await loadArtifactFiles(
          request,
          { artifactId, entries },
          controller.signal
        )
        if (controller.signal.aborted) return
        setFiles(
          Object.fromEntries(
            Object.entries(loaded).map(([path, bytes]) => [
              path.startsWith("bin/") ? path : `bin/${path}`,
              bytes,
            ])
          )
        )
      } catch (err) {
        if (!controller.signal.aborted) setError(errorMessage(err))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [artifactId, entriesKey, request])
  return { files, error, loading }
}
