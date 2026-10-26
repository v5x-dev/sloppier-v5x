import { useEditorNavigation } from "./editor-navigation"
import type { DiagnosticTarget } from "@/lib/build-diagnostics"
import { editorThemeOptions } from "@/lib/editor-theme"
import { useEffect, useRef, useState } from "react"
import { useAuth } from "@/lib/auth"
import { useConvex, useConvexConnectionState } from "convex/react"
import { api } from "@workspace/backend/api"
import type { Id } from "@workspace/backend/dataModel"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import type {
  FunctionReference,
  FunctionArgs,
  FunctionReturnType,
} from "convex/server"
import { Editor, type EditorFactory } from "@pierre/diffs/edit"
import { EditProvider, File } from "@pierre/diffs/react"
import { PierreCollaboration } from "@/lib/pierre-collaboration"
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
} from "@/lib/live-document"
import { errorMessage } from "@/lib/errors"
import { useEditorCompletion } from "./editor-completion"
import { useLanguageClient } from "./language-session"

const createEditor: EditorFactory<undefined, { name: string }> = (
  type,
  options,
  key
) => new Editor(type, options, key)

export type LivePerson = {
  id: string
  name: string
  color: string
  imageUrl?: string
}

type Props = {
  projectId: Id<"projects">
  path: string
  active: boolean
  diagnosticTarget?: DiagnosticTarget
  onChange: (text: string) => void
  onPeopleChange: (people: LivePerson[]) => void
  onSyncChange: (synced: boolean) => void
}

export function LiveFileEditor({
  projectId,
  path,
  active,
  diagnosticTarget,
  onChange,
  onSyncChange,
  onPeopleChange,
}: Props) {
  const client = useConvex()
  const connection = useConvexConnectionState()
  const { user } = useAuth()
  const language = useLanguageClient()
  const languageRef = useRef(language)
  languageRef.current = language
  const host = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onChange, onSyncChange, onPeopleChange })
  callbacks.current = { onChange, onSyncChange, onPeopleChange }
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState("Opening live document…")
  const [error, setError] = useState<string | null>(null)
  const retry = useRef(() => {})
  const awarenessRef = useRef<Awareness | null>(null)
  const [binding, setBinding] = useState<PierreCollaboration | null>(null)
  const bindingRef = useRef<PierreCollaboration | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    if (!user || !host.current) return
    const userId = user.id
    const doc = new Y.Doc()
    const server = new Y.Doc()
    const awareness = new Awareness(doc)
    awarenessRef.current = awareness
    const sessionId = crypto.randomUUID()
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
    const args = { projectId, path }
    const presenceArgs = { ...args, sessionId }
    let cache: IndexeddbPersistence | undefined
    let disposed = false
    const isDisposed = () => disposed
    let collaboration: PierreCollaboration | undefined
    let stopUpdates: (() => void) | undefined
    let stopStorage: (() => void) | undefined
    let stopPresence: (() => void) | undefined
    let stopLanguage: (() => void) | undefined
    let sequence = 0
    let documentId: Id<"crdtDocuments"> | undefined
    let replaced = false
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
      if (!isDisposed()) setError(errorMessage(failure))
    }
    const report = () => {
      if (isDisposed()) return
      const dirty = !caughtUp || sending || hasChanges(doc, server)
      callbacks.current.onSyncChange(!dirty)
      setStatus(
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
              setError(
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
        Y.applyUpdate(server, new Uint8Array(sent.bytes), REMOTE)
        storagePending.add(sent.updateId)
        inFlight = undefined
        if (!isDisposed()) setError(null)
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
      callbacks.current.onChange(source(doc).toString())
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
        if (
          typeof person?.name !== "string" ||
          typeof person.color !== "string"
        )
          continue
        const id = typeof person.id === "string" ? person.id : String(clientId)
        people.set(id, {
          id,
          name: person.name,
          color: person.color,
          imageUrl:
            typeof person.imageUrl === "string" ? person.imageUrl : undefined,
        })
      }
      callbacks.current.onPeopleChange([...people.values()])
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
          void client.mutation(api.presence.disconnect, {
            sessionToken: tokens.sessionToken,
          })
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
            host.current?.setAttribute("inert", "")
            callbacks.current.onSyncChange(false)
            setError(
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
      collaboration = new PierreCollaboration(doc, awareness, path, () =>
        setError(
          "Live files can contain up to 256 KiB of text. This edit exceeds that limit."
        )
      )
      bindingRef.current = collaboration
      stopLanguage = languageRef.current?.openDocument(path, source(doc))
      setBinding(collaboration)
      setReady(true)
      changed()
    }
    let starting = false
    async function start() {
      if (starting || isDisposed()) return
      starting = true
      try {
        documentId = await client.action(api.codeStorage.openLiveFile, args)
        if (isDisposed()) return
        cache ??= new IndexeddbPersistence(`v5x:${userId}:${documentId}`, doc)
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
                const ids = remoteClients.get(session.sessionId) ?? []
                for (const id of awareness.getStates().keys())
                  if (
                    !before.has(id) &&
                    id !== doc.clientID &&
                    !ids.includes(id)
                  )
                    ids.push(id)
                remoteClients.set(session.sessionId, ids)
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
    retry.current = () => {
      setError(null)
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
      collaboration?.publishSelection(
        activeRef.current &&
          Boolean(host.current?.contains(document.activeElement))
      )
    }, 120)
    const timer = setInterval(() => {
      void heartbeat()
      void flush()
    }, 10_000)
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!caughtUp || hasChanges(doc, server)) {
        event.preventDefault()
        event.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => {
      disposed = true
      callbacks.current.onPeopleChange([])
      clearInterval(timer)
      clearInterval(selectionTimer)
      clearTimeout(sendTimer)
      clearTimeout(awarenessTimer)
      window.removeEventListener("beforeunload", beforeUnload)
      stopUpdates?.()
      stopStorage?.()
      stopPresence?.()
      stopLanguage?.()
      collaboration?.destroy()
      bindingRef.current = null
      awareness.destroy()
      awarenessRef.current = null
      if (sessionToken)
        void client
          .mutation(api.presence.disconnect, { sessionToken })
          .catch(() => {})
      doc.off("update", changed)
      void cache?.destroy()
      doc.destroy()
      server.destroy()
    }
  }, [client, path, projectId, user?.id])

  useEffect(() => {
    if (!active) awarenessRef.current?.setLocalStateField("cursor", null)
  }, [active])

  return (
    <div className="flex min-h-full flex-col">
      <span className="sr-only" role="status" aria-live="polite">
        {!connection.isWebSocketConnected
          ? "Offline · changes kept on this device"
          : status}
      </span>
      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 border-b px-3 py-2 text-xs text-destructive"
        >
          <span className="flex-1">{error}</span>
          <Button size="xs" variant="outline" onClick={() => retry.current()}>
            Retry
          </Button>
        </div>
      )}
      {!ready && (
        <div className="flex flex-1 items-center justify-center py-12">
          <Spinner />
        </div>
      )}
      <div ref={host} className="min-h-0 flex-1">
        {binding && (
          <PierreFile
            key={binding.shared.clientID}
            binding={binding}
            diagnosticTarget={active ? diagnosticTarget : undefined}
            path={path}
            projectId={projectId}
          />
        )}
      </div>
    </div>
  )
}

function PierreFile({
  diagnosticTarget,
  binding,
  path,
  projectId,
}: {
  binding: PierreCollaboration
  diagnosticTarget?: DiagnosticTarget
  path: string
  projectId: Id<"projects">
}) {
  const appliedTarget = useRef<number | undefined>(undefined)
  const targetRef = useRef(diagnosticTarget)
  targetRef.current = diagnosticTarget
  useEffect(() => {
    if (
      diagnosticTarget &&
      binding.editor &&
      appliedTarget.current !== diagnosticTarget.request
    ) {
      appliedTarget.current = diagnosticTarget.request
      binding.editor.focus({
        lineNumber: diagnosticTarget.line,
        character: Math.max(0, (diagnosticTarget.column ?? 1) - 1),
      })
    }
  }, [binding, diagnosticTarget])
  const completion = useEditorCompletion(binding, path)
  const navigation = useEditorNavigation(binding, path, completion.wrapper)
  const file = useRef({
    name: path,
    contents: binding.document.getText(),
    cacheKey: `${projectId}:${path}:${binding.shared.clientID}`,
  }).current
  return (
    <div ref={completion.wrapper} className="contents">
      <EditProvider createEditor={createEditor}>
        <File<undefined, { name: string }>
          file={file}
          edit
          options={editorThemeOptions}
          editorOptions={{
            initialState: { type: "file", document: binding.document },
            onAttach: (editor) => {
              binding.attach(editor)
              const target = targetRef.current
              if (target && appliedTarget.current !== target.request) {
                appliedTarget.current = target.request
                editor.focus({
                  lineNumber: target.line,
                  character: Math.max(0, (target.column ?? 1) - 1),
                })
              }
            },
            renderCaret: (caret) => {
              const marker = document.createElement("span")
              marker.setAttribute(
                "aria-label",
                `${caret.metadata.name}'s cursor`
              )
              marker.style.cssText = `display:block;position:relative;width:2px;height:100%;background:${caret.metadata.color}`
              const label = document.createElement("span")
              label.textContent = caret.metadata.name
              label.style.cssText = `position:absolute;bottom:100%;left:0;white-space:nowrap;padding:2px 4px;border-radius:3px 3px 3px 0;font:11px var(--font-serif);color:#111;background:${caret.metadata.color}`
              marker.append(label)
              return marker
            },
          }}
          onEditChange={(event) => {
            binding.localChange(event)
            completion.onLocalChange(event)
          }}
          onEditComplete={() => "accept"}
        />
      </EditProvider>
      {completion.popup}
      {navigation}
    </div>
  )
}
