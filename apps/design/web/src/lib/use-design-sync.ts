import { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
import { useConvex, useMutation, useQuery } from "convex/react"
import { useEffect, useState, useSyncExternalStore } from "react"
import { IndexeddbPersistence } from "y-indexeddb"
import { DesignSync, type SyncStatus } from "@/lib/design-sync"

export type DesignSyncState = SyncStatus | { kind: "offline" }

/** The live document for a Design, plus what to tell the user about saving it. */
export function useDesignSync(designId: Id<"designs">, userId: string) {
  const appendUpdate = useMutation(api.designSync.appendUpdate)
  const [sync, setSync] = useState<DesignSync>()
  const [afterSequence, setAfterSequence] = useState(0)

  useEffect(() => {
    const next = new DesignSync((updateId, bytes) =>
      appendUpdate({ designId, updateId, bytes })
    )
    // Per user, so a shared school computer never mixes two people's edits.
    const local = new IndexeddbPersistence(
      `v5x:design:${userId}:${designId}`,
      next.doc
    )
    let active = true
    void local.whenSynced.then(() => {
      if (active) next.markLocalReady()
    })
    setSync(next)
    setAfterSequence(0)
    return () => {
      active = false
      setSync(undefined)
      void local.destroy()
      next.destroy()
    }
  }, [appendUpdate, designId, userId])

  const page = useQuery(api.designSync.updatesSince, {
    designId,
    afterSequence,
  })

  useEffect(() => {
    if (!sync || !page) return
    sync.applyRemote(page.updates)
    const last = page.updates.at(-1)
    if (last) setAfterSequence(last.sequence)
    if (!page.hasMore && !page.copying) sync.markReplayed()
  }, [page, sync])

  const status = useSyncExternalStore(
    sync?.subscribe ?? noSubscription,
    sync?.getStatus ?? loading
  )
  const connected = useConnected()

  const state: DesignSyncState =
    status.kind === "saving" && !connected ? { kind: "offline" } : status
  return { doc: sync?.doc, state }
}

const noSubscription = () => () => {}
const loadingStatus: SyncStatus = { kind: "loading" }
const loading = () => loadingStatus

function useConnected() {
  const convex = useConvex()
  return useSyncExternalStore(
    (listener) => convex.subscribeToConnectionState(listener),
    () => convex.connectionState().isWebSocketConnected
  )
}
