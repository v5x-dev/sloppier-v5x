import type { ConvexReactClient } from "convex/react"
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server"
import { api } from "@workspace/backend/api"
import type { Id } from "@workspace/backend/dataModel"
import * as Y from "yjs"
import { retryOnReconnect } from "./retry"

// Joins the same Yjs update log as the web live editor
// (apps/code/web/src/lib/live-file-session.ts). Presence and offline caching
// are web-only, so they are left out here.
const REMOTE = "remote"
const MAX_UPDATE_BYTES = 512 * 1024
const SEND_DELAY_MS = 250
const RETRY_DELAY_MS = 2000

type Client = Pick<ConvexReactClient, "watchQuery" | "action" | "mutation">

type LiveFileCallbacks = {
  onText: (text: string) => void
  onSync: (synced: boolean) => void
  onError: (error: string | null) => void
}

export type LiveFileSession = {
  edit: (next: string) => void
  dispose: () => void
}

// Returns the span that differs between two strings, widened so it never
// splits a UTF-16 surrogate pair. Yjs stores UTF-16 units, and a split pair
// would be encoded as a replacement character.
export function diffRange(previous: string, next: string) {
  const limit = Math.min(previous.length, next.length)
  let start = 0
  while (start < limit && previous.charCodeAt(start) === next.charCodeAt(start))
    start++
  let oldEnd = previous.length
  let newEnd = next.length
  while (
    oldEnd > start &&
    newEnd > start &&
    previous.charCodeAt(oldEnd - 1) === next.charCodeAt(newEnd - 1)
  ) {
    oldEnd--
    newEnd--
  }
  if (start > 0 && isHighSurrogate(previous.charCodeAt(start - 1))) start--
  if (
    oldEnd < previous.length &&
    newEnd < next.length &&
    isLowSurrogate(previous.charCodeAt(oldEnd)) &&
    previous.charCodeAt(oldEnd) === next.charCodeAt(newEnd)
  ) {
    oldEnd++
    newEnd++
  }
  return { start, oldEnd, newEnd }
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number) {
  return code >= 0xdc00 && code <= 0xdfff
}

// Mirrors web live-document.ts: `server` holds only acknowledged updates, so
// anything in `doc` beyond it is still waiting to be sent.
function pendingUpdate(doc: Y.Doc, server: Y.Doc) {
  return Y.encodeStateAsUpdate(doc, Y.encodeStateVector(server))
}

function hasChanges(doc: Y.Doc, server: Y.Doc) {
  const local = Y.decodeUpdate(pendingUpdate(doc, server))
  if (local.structs.length) return true
  // State vectors track inserts, not deletes, so compare acknowledged ranges.
  const acknowledged = Y.decodeUpdate(Y.encodeStateAsUpdate(server)).ds.clients
  for (const [client, ranges] of local.ds.clients) {
    const known = acknowledged.get(client) ?? []
    for (const range of ranges) {
      if (
        !known.some(
          (item) =>
            item.clock <= range.clock &&
            item.clock + item.len >= range.clock + range.len
        )
      )
        return true
    }
  }
  return false
}

export function createLiveFileSession({
  client,
  programId,
  path,
  createId,
  callbacks,
}: {
  client: Client
  programId: Id<"programs">
  path: string
  createId: () => string
  callbacks: LiveFileCallbacks
}): LiveFileSession {
  const doc = new Y.Doc()
  const server = new Y.Doc()
  const source = doc.getText("source")
  const args = { programId, path }
  let documentId: Id<"crdtDocuments"> | undefined
  let sequence = 0
  let caughtUp = false
  let replaced = false
  let disposed = false
  let sending = false
  let failed = false
  let oversized = false
  let inFlight: { updateId: string; bytes: ArrayBuffer } | undefined
  let sendTimer: ReturnType<typeof setTimeout> | undefined
  let stopUpdates: (() => void) | undefined

  const synced = () =>
    caughtUp && !replaced && !sending && !inFlight && !hasChanges(doc, server)

  function report() {
    if (!disposed) callbacks.onSync(synced())
  }

  function scheduleFlush(delay: number) {
    clearTimeout(sendTimer)
    sendTimer = setTimeout(() => void flush(), delay)
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
    oversized = false
    report()
    try {
      inFlight ??= {
        updateId: createId(),
        bytes: new Uint8Array(pendingUpdate(doc, server)).buffer,
      }
      if (inFlight.bytes.byteLength > MAX_UPDATE_BYTES) {
        // Nothing was sent, so drop it. Retrying now would fail the same way;
        // the next edit recomputes the diff.
        inFlight = undefined
        oversized = true
        throw new Error(
          "This edit is too large to sync. Remove some of it, then try again."
        )
      }
      const sent = inFlight
      await client.mutation(api.crdt.appendUpdate, {
        ...args,
        documentId,
        updateId: sent.updateId,
        bytes: sent.bytes,
      })
      if (disposed) return
      Y.applyUpdate(server, new Uint8Array(sent.bytes), REMOTE)
      inFlight = undefined
      failed = false
      callbacks.onError(null)
    } catch (failure) {
      failed = true
      if (!disposed) callbacks.onError(errorMessage(failure))
    } finally {
      sending = false
      report()
      if (!disposed && !oversized && (inFlight || hasChanges(doc, server)))
        scheduleFlush(failed ? RETRY_DELAY_MS : SEND_DELAY_MS)
    }
  }

  const changed = () => {
    if (disposed) return
    // Replay is applied in pages; publish only once the whole log is in.
    if (caughtUp) callbacks.onText(source.toString())
    report()
    scheduleFlush(SEND_DELAY_MS)
  }
  doc.on("update", changed)

  // Resolves to a stop function. Subscriptions are queued so the first value
  // arrives asynchronously, like the web session.
  function subscribe<TQuery extends FunctionReference<"query">>(
    query: TQuery,
    queryArgs: FunctionArgs<TQuery>,
    listener: (value: FunctionReturnType<TQuery>) => void
  ) {
    const watch = client.watchQuery(query, queryArgs)
    let subscribed = true
    const update = () => {
      if (!subscribed) return
      try {
        const value = watch.localQueryResult()
        if (value !== undefined) listener(value)
      } catch (failure) {
        if (!disposed) callbacks.onError(errorMessage(failure))
      }
    }
    const stop = watch.onUpdate(update)
    void Promise.resolve().then(update)
    return () => {
      if (!subscribed) return
      subscribed = false
      stop()
    }
  }

  function watchUpdates() {
    stopUpdates?.()
    stopUpdates = subscribe(
      api.crdt.updatesSince,
      { ...args, afterSequence: sequence },
      (batch) => {
        if (disposed) return
        if (batch.documentId !== documentId) {
          replaced = true
          stopUpdates?.()
          callbacks.onSync(false)
          callbacks.onError(
            "This file was deleted or replaced. Reopen it to keep editing."
          )
          return
        }
        for (const update of batch.updates) {
          const bytes = new Uint8Array(update.bytes)
          Y.applyUpdate(server, bytes, REMOTE)
          Y.applyUpdate(doc, bytes, REMOTE)
          sequence = update.sequence
        }
        // Re-subscribe past the applied batch so long sessions never replay
        // the whole log on every change.
        if (
          batch.updates.length &&
          (batch.hasMore || sequence < batch.lastSequence)
        ) {
          watchUpdates()
          return
        }
        if (!caughtUp) {
          caughtUp = true
          callbacks.onText(source.toString())
        }
        report()
        void flush()
        if (batch.updates.length) watchUpdates()
      }
    )
  }

  async function start() {
    try {
      documentId = await retryOnReconnect(() =>
        client.action(api.codeStorage.openLiveFile, args)
      )
      if (disposed) return
      watchUpdates()
    } catch (failure) {
      if (!disposed) callbacks.onError(errorMessage(failure))
    }
  }
  void start()

  return {
    edit(next) {
      if (disposed || replaced) return
      const previous = source.toString()
      if (previous === next) return
      const { start, oldEnd, newEnd } = diffRange(previous, next)
      doc.transact(() => {
        if (oldEnd > start) source.delete(start, oldEnd - start)
        if (newEnd > start) source.insert(start, next.slice(start, newEnd))
      })
    },
    dispose() {
      if (disposed) return
      // Best-effort: push edits made in the last few hundred milliseconds
      // before the screen goes away. The same update ID makes a retry safe.
      if (caughtUp && !replaced && (inFlight || hasChanges(doc, server))) {
        const sent = inFlight ?? {
          updateId: createId(),
          bytes: new Uint8Array(pendingUpdate(doc, server)).buffer,
        }
        void client
          .mutation(api.crdt.appendUpdate, {
            ...args,
            documentId,
            updateId: sent.updateId,
            bytes: sent.bytes,
          })
          .catch(() => {})
      }
      disposed = true
      clearTimeout(sendTimer)
      stopUpdates?.()
      doc.off("update", changed)
      doc.destroy()
      server.destroy()
    },
  }
}

function errorMessage(failure: unknown) {
  return failure instanceof Error ? failure.message : "Live editing failed."
}
