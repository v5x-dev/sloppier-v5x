import { useEffect, useState } from "react"
import { useProgramConnection } from "@/components/program/program-connection"
import { readBuildBinaries } from "@/lib/build-binaries"
import { errorMessage } from "@/lib/errors"

// This map belongs to the client explorer, never to repository drafts or commits.
export function useProgramBinaries() {
  const { status, request } = useProgramConnection()
  const [files, setFiles] = useState<Partial<Record<string, Uint8Array>>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const artifactId = status?.artifactId
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
        const response = await request(
          "/artifact",
          undefined,
          controller.signal
        )
        const entries = readBuildBinaries(
          new Uint8Array(await response.arrayBuffer())
        )
        if (controller.signal.aborted) return
        setFiles(
          Object.fromEntries(
            Object.entries(entries).map(([path, bytes]) => [
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
  }, [artifactId, request])
  return { files, error, loading }
}
