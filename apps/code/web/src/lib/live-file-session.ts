import type { ConvexReactClient } from "convex/react"
import { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
import type {
  FunctionReference,
  FunctionArgs,
  FunctionReturnType,
} from "convex/server"
import { IndexeddbPersistence } from "y-indexeddb"
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness"
import * as Y from "yjs"
import {
  applyRemote,
  hasChanges,
  pendingUpdate,
  REMOTE,
  source,
} from "./live-document"
import { errorMessage } from "./errors"

export type LivePerson = {
  id: string
  name: string
  color: string
  imageUrl?: string
  active: boolean
}

type LiveEditor = {
  renderCarets: () => void
  publishSelection: (active: boolean) => void
  destroy: () => void
}

type SessionOptions = {
  client: Pick<ConvexReactClient, "watchQuery" | "action" | "mutation">
  programId: Id<"programs">
  path: string
  user: {
    id: string
    firstName?: string | null
    lastName?: string | null
    email?: string
    profilePictureUrl?: string | null
  }
  callbacks: {
    onChange: (text: string) => void
    onSyncChange: (synced: boolean) => void
    onPeopleChange: (people: LivePerson[]) => void
    onStatus: (status: string) => void
    onError: (error: string | null) => void
    onReplaced: () => void
    isFocused: () => boolean
    mount: (doc: Y.Doc, awareness: Awareness) => LiveEditor
  }
  createCache?: (
    name: string,
    doc: Y.Doc
  ) => { whenSynced: Promise<unknown>; destroy: () => Promise<unknown> }
}

// Presence is kept per tab, user and file. A reload reuses the id, so the new
// page replaces its previous session and never shows that page's caret.
function presenceSessionId(userId: string, programId: string, path: string) {
  const key = `v5x:presence:${userId}:${programId}:${path}`
  try {
    const saved = sessionStorage.getItem(key)
    if (saved && saved.length >= 8 && saved.length <= 128) return saved
    const created = crypto.randomUUID()
    sessionStorage.setItem(key, created)
    return created
  } catch {
    // Storage can be unavailable, for example in private or sandboxed contexts.
    return crypto.randomUUID()
  }
}

/** Owns one document's replay, local recovery, synchronization and presence. */
export function createLiveFileSession({
  client,
  programId,
  path,
  user,
  callbacks,
  createCache = (name, doc) => new IndexeddbPersistence(name, doc),
}: SessionOptions) {
  const userId = user.id
  const doc = new Y.Doc()
  const server = new Y.Doc()
  const awareness = new Awareness(doc)
  const sessionId = presenceSessionId(userId, programId, path)
  function subscribe<TQuery extends FunctionReference<"query">>(
    query: TQuery,
    queryArgs: FunctionArgs<TQuery>,
    listener: (value: FunctionReturnType<TQuery>) => void,
    onError: (error: unknown) => void
  ) {
    const watch = client.watchQuery(query, queryArgs)
    let subscribed = true
    const update = () => {
      if (!subscribed) return
      try {
        const value = watch.localQueryResult()
        if (value !== undefined) listener(value)
      } catch (failure) {
        onError(failure)
      }
    }
    const stop = watch.onUpdate(update)
    queueMicrotask(update)
    return () => {
      if (!subscribed) return
      subscribed = false
      stop()
    }
  }
  const args = { programId, path }
  const presenceArgs = { ...args, sessionId }
  let cache: ReturnType<NonNullable<SessionOptions["createCache"]>> | undefined
  let disposed = false
  const isDisposed = () => disposed
  let collaboration: LiveEditor | undefined
  let stopUpdates: (() => void) | undefined
  let stopStorage: (() => void) | undefined
  let stopPresence: (() => void) | undefined
  let sequence = 0
  let documentId: Id<"crdtDocuments"> | undefined
  let replaced = false
  const isStopped = () => disposed || replaced
  let caughtUp = false
  let sending = false
  let inFlight: { updateId: string; bytes: ArrayBuffer } | undefined
  let sessionToken: string | undefined
  let joining = false
  let awarenessTimer: ReturnType<typeof setTimeout> | undefined
  let sendTimer: ReturnType<typeof setTimeout> | undefined
  const storagePending = new Set<string>()
  const failedStorage = new Set<string>()
  const remoteClients = new Map<string, number[]>()

  const showError = (failure: unknown) => {
    if (!isDisposed()) callbacks.onError(errorMessage(failure))
  }
  const report = () => {
    if (isDisposed()) return
    const dirty = replaced || !caughtUp || sending || hasChanges(doc, server)
    callbacks.onSyncChange(!dirty)
    callbacks.onStatus(
      dirty
        ? "Saving…"
        : storagePending.size
          ? "Saved live · backing up…"
          : "All changes saved"
    )
  }
  function watchStorage() {
    stopStorage?.()
    if (!storagePending.size) return
    stopStorage = subscribe(
      api.crdt.storageStatus,
      {
        ...args,
        updateIds: [...storagePending].slice(0, 100),
      },
      (rows) => {
        for (const row of rows) {
          if (row.status === "persisted") {
            storagePending.delete(row.updateId)
            failedStorage.delete(row.updateId)
          } else if (row.status === "failed") {
            failedStorage.add(row.updateId)
            callbacks.onError(
              "Live changes are saved, but the repository backup failed. Retry to back them up."
            )
          }
        }
        report()
        if (rows.some((row) => row.status === "persisted")) watchStorage()
      },
      showError
    )
  }
  async function flush() {
    if (
      disposed ||
      replaced ||
      !caughtUp ||
      sending ||
      (!inFlight && !hasChanges(doc, server))
    )
      return
    sending = true
    report()
    try {
      inFlight ??= {
        updateId: crypto.randomUUID(),
        bytes: pendingUpdate(doc, server).buffer as ArrayBuffer,
      }
      if (inFlight.bytes.byteLength > 512 * 1024)
        throw new Error(
          "The offline edit is too large to sync. Keep this tab open and copy your changes before reloading."
        )
      const sent = inFlight
      await client.mutation(api.crdt.appendUpdate, {
        ...args,
        ...sent,
        documentId,
      })
      if (isStopped()) return
      Y.applyUpdate(server, new Uint8Array(sent.bytes), REMOTE)
      storagePending.add(sent.updateId)
      inFlight = undefined
      if (!isDisposed()) callbacks.onError(null)
      watchStorage()
    } catch (failure) {
      showError(failure)
    } finally {
      sending = false
      report()
      if (!isDisposed() && !inFlight && hasChanges(doc, server))
        sendTimer = setTimeout(() => void flush(), 250)
    }
  }
  function changed() {
    if (isDisposed()) return
    callbacks.onChange(source(doc).toString())
    report()
    clearTimeout(sendTimer)
    sendTimer = setTimeout(() => void flush(), 250)
  }
  doc.on("update", changed)

  function publish() {
    if (!sessionToken || isDisposed()) return
    const bytes = encodeAwarenessUpdate(awareness, [doc.clientID])
      .buffer as ArrayBuffer
    void client
      .mutation(api.presence.publishAwareness, { ...presenceArgs, bytes })
      .catch(showError)
  }
  const awarenessChanged = (_: unknown, origin: unknown) => {
    if (isDisposed()) return
    collaboration?.renderCarets()
    const people = new Map<string, LivePerson>()
    for (const [clientId, state] of awareness.getStates()) {
      const person = state.user
      if (typeof person?.name !== "string" || typeof person.color !== "string")
        continue
      const id = typeof person.id === "string" ? person.id : String(clientId)
      people.set(id, {
        id,
        name: person.name,
        color: person.color,
        active: state.active === true || people.get(id)?.active === true,
        imageUrl:
          typeof person.imageUrl === "string" ? person.imageUrl : undefined,
      })
    }
    callbacks.onPeopleChange([...people.values()])
    if (origin !== REMOTE) {
      clearTimeout(awarenessTimer)
      awarenessTimer = setTimeout(publish, 80)
    }
  }
  awareness.on("update", awarenessChanged)
  const name =
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.email ||
    "Collaborator"
  const color = [
    "#e879f9",
    "#22d3ee",
    "#fb923c",
    "#4ade80",
    "#a5b4fc",
    "#facc15",
    "#f87171",
    "#2dd4bf",
  ][
    (Array.from(userId).reduce(
      (hash, c) => Math.imul(hash ^ c.charCodeAt(0), 16777619),
      2166136261
    ) >>>
      0) %
      8
  ]
  awareness.setLocalStateField("user", {
    id: userId,
    imageUrl: user.profilePictureUrl,
    name,
    color,
    colorLight: `${color}33`,
  })

  async function heartbeat() {
    if (isDisposed() || joining) return
    joining = true
    try {
      const tokens = await client.mutation(
        api.presence.heartbeatFile,
        presenceArgs
      )
      if (isDisposed()) {
        void client
          .mutation(api.presence.disconnect, {
            sessionToken: tokens.sessionToken,
          })
          .catch(() => {})
        return
      }
      sessionToken = tokens.sessionToken
      publish()
    } catch (failure) {
      showError(failure)
    } finally {
      joining = false
    }
  }
  function watchUpdates() {
    stopUpdates?.()
    stopUpdates = subscribe(
      api.crdt.updatesSince,
      { ...args, afterSequence: sequence },
      (batch) => {
        if (isDisposed()) return
        if (batch.documentId !== documentId) {
          replaced = true
          callbacks.onReplaced()
          callbacks.onSyncChange(false)
          callbacks.onError(
            "This file was deleted or replaced. Copy any pending changes, then reopen the program."
          )
          stopUpdates?.()
          return
        }
        for (const update of batch.updates) {
          applyRemote(doc, server, update.bytes)
          sequence = update.sequence
        }
        if (batch.hasMore || sequence < batch.lastSequence) {
          watchUpdates()
          return
        }
        if (!caughtUp) {
          caughtUp = true
          mountEditor()
        }
        report()
        void flush()
        // Advance the subscription cursor so long sessions never replay the
        // entire log on every keypress, including across replay page boundaries.
        if (batch.updates.length) watchUpdates()
      },
      showError
    )
  }
  function mountEditor() {
    if (isDisposed() || collaboration) return
    collaboration = callbacks.mount(doc, awareness)
    changed()
  }
  let starting = false
  async function start() {
    if (starting || isDisposed()) return
    starting = true
    try {
      documentId = await client.action(api.codeStorage.openLiveFile, args)
      if (isDisposed()) return
      cache ??= createCache(`v5x:${userId}:${documentId}`, doc)
      await cache.whenSynced
      if (isDisposed()) return
      storagePending.add("initial-source")
      watchStorage()
      watchUpdates()
      void heartbeat()
      stopPresence = subscribe(
        api.presence.listAwareness,
        args,
        (sessions) => {
          if (isDisposed()) return
          const present = new Set(sessions.map((s) => s.sessionId))
          for (const [session, ids] of remoteClients) {
            if (!present.has(session)) {
              removeAwarenessStates(awareness, ids, REMOTE)
              remoteClients.delete(session)
            }
          }
          for (const session of sessions) {
            if (session.sessionId === sessionId) continue
            try {
              const before = new Set(awareness.getStates().keys())
              applyAwarenessUpdate(
                awareness,
                new Uint8Array(session.bytes),
                REMOTE
              )
              const previous = remoteClients.get(session.sessionId) ?? []
              const added = [...awareness.getStates().keys()].filter(
                (id) => !before.has(id) && id !== doc.clientID
              )
              // A reload preserves the tab's session ID but creates a new Y.Doc.
              // Its new client replaces the previous client's selection immediately.
              if (added.length) {
                removeAwarenessStates(
                  awareness,
                  previous.filter((id) => !added.includes(id)),
                  REMOTE
                )
              }
              remoteClients.set(
                session.sessionId,
                added.length ? added : previous
              )
            } catch {
              /* Ignore malformed or incompatible presence messages. */
            }
          }
        },
        showError
      )
    } catch (failure) {
      showError(failure)
    } finally {
      starting = false
    }
  }
  const retry = () => {
    if (isDisposed() || replaced) return
    callbacks.onError(null)
    if (!caughtUp) {
      void start()
      return
    }
    for (const updateId of failedStorage) {
      void client
        .mutation(api.crdt.retryPersistence, { ...args, updateId })
        .catch(showError)
    }
    failedStorage.clear()
    void flush()
    void heartbeat()
  }
  void start()
  const selectionTimer = setInterval(() => {
    collaboration?.publishSelection(callbacks.isFocused())
  }, 120)
  const timer = setInterval(() => {
    void heartbeat()
    void flush()
  }, 10_000)
  return {
    retry,
    hasPendingChanges: () => replaced || !caughtUp || hasChanges(doc, server),
    setBrowserActive(active: boolean) {
      if (awareness.getLocalState()?.active !== active)
        awareness.setLocalStateField("active", active)
    },
    setActive(active: boolean) {
      if (!active) awareness.setLocalStateField("cursor", null)
    },
    dispose() {
      if (disposed) return
      disposed = true
      callbacks.onPeopleChange([])
      clearInterval(timer)
      clearInterval(selectionTimer)
      clearTimeout(sendTimer)
      clearTimeout(awarenessTimer)
      stopUpdates?.()
      stopStorage?.()
      stopPresence?.()
      collaboration?.destroy()
      awareness.destroy()
      if (sessionToken)
        void client
          .mutation(api.presence.disconnect, { sessionToken })
          .catch(() => {})
      doc.off("update", changed)
      void cache?.destroy()
      doc.destroy()
      server.destroy()
    },
  }
}
