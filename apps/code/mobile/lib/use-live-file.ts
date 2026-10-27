import { useCallback, useEffect, useRef, useState } from "react"
import { useConvex } from "convex/react"
import { randomUUID } from "expo-crypto"
import type { Id } from "@workspace/backend/dataModel"
import { createLiveFileSession, type LiveFileSession } from "@/lib/live-file"
import {
  isEdited,
  markCommitted as clearPending,
  markEdited,
} from "@/lib/pending-edits"

type LiveFileState = {
  // Editor text with CRLF normalized to LF. Null until the document loads.
  text: string | null
  synced: boolean
  // Local edits that have not been committed to the repository yet.
  edited: boolean
  error: string | null
}

export function useLiveFile(
  programId: Id<"programs">,
  path: string | undefined
) {
  const client = useConvex()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<LiveFileState>({
    text: null,
    synced: false,
    edited: false,
    error: null,
  })
  const session = useRef<LiveFileSession | null>(null)

  useEffect(() => {
    if (!path) return
    setState({
      text: null,
      synced: false,
      edited: isEdited(programId, path),
      error: null,
    })
    session.current = createLiveFileSession({
      client,
      programId,
      path,
      createId: randomUUID,
      callbacks: {
        onText: (raw) =>
          setState((prev) => ({
            ...prev,
            text: raw.replace(/\r\n?/g, "\n"),
          })),
        onSync: (synced) =>
          setState((prev) =>
            prev.synced === synced ? prev : { ...prev, synced }
          ),
        onError: (error) =>
          setState((prev) =>
            prev.error === error ? prev : { ...prev, error }
          ),
      },
    })
    return () => {
      session.current?.dispose()
      session.current = null
    }
  }, [client, programId, path, attempt])

  const edit = useCallback(
    (next: string) => {
      session.current?.edit(next)
      if (path) markEdited(programId, path)
      setState((prev) => (prev.edited ? prev : { ...prev, edited: true }))
    },
    [programId, path]
  )

  // Only the text that was committed is acknowledged. Typing that happened
  // while the commit was in flight stays uncommitted.
  const markCommitted = useCallback(
    (committed: string) => {
      setState((prev) => {
        const edited = prev.text !== committed
        if (!edited && path) clearPending(programId, [path])
        return { ...prev, edited }
      })
    },
    [programId, path]
  )

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  return { ...state, edit, markCommitted, retry }
}
