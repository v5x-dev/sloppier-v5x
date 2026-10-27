import {
  readEditorState,
  writeEditorState,
  type FileView,
} from "@/lib/editor-persistence"
import { useEditorFormatting, type FormatChange } from "./editor-formatting"
import { useEditorNavigation } from "./editor-navigation"
import type { DiagnosticTarget } from "@/lib/build-diagnostics"
import { editorThemeOptions } from "@/lib/editor-theme"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import { useAuth } from "@/lib/auth"
import { useConvex, useConvexConnectionState } from "convex/react"
import type { Id } from "@workspace/backend/dataModel"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Editor, type EditorFactory } from "@pierre/diffs/edit"
import { EditProvider, File } from "@pierre/diffs/react"
import { PierreCollaboration } from "@/lib/pierre-collaboration"
import { source } from "@/lib/live-document"
import { createLiveFileSession } from "@/lib/live-file-session"
import type { LivePerson } from "@/lib/live-file-session"
import { useEditorCompletion } from "./editor-completion"
import { useLanguageService } from "./language-session"

export type { LivePerson } from "@/lib/live-file-session"

const createEditor: EditorFactory<undefined, { name: string }> = (
  type,
  options,
  key
) => new Editor(type, options, key)

type Props = {
  programId: Id<"programs">
  path: string
  active: boolean
  onFormatChange: FormatChange
  diagnosticTarget?: DiagnosticTarget
  onChange: (text: string) => void
  onPeopleChange: (people: LivePerson[]) => void
  onSyncChange: (synced: boolean) => void
}

export function LiveFileEditor({
  programId,
  path,
  active,
  diagnosticTarget,
  onFormatChange,
  onChange,
  onSyncChange,
  onPeopleChange,
}: Props) {
  const client = useConvex()
  const connection = useConvexConnectionState()
  const { user } = useAuth()
  const language = useLanguageService()
  const languageRef = useRef(language)
  languageRef.current = language
  const host = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onChange, onSyncChange, onPeopleChange })
  callbacks.current = { onChange, onSyncChange, onPeopleChange }
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState("Opening live document…")
  const [error, setError] = useState<string | null>(null)
  const retry = useRef(() => {})
  const sessionRef = useRef<ReturnType<typeof createLiveFileSession> | null>(
    null
  )
  const [binding, setBinding] = useState<PierreCollaboration | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    if (!user || !host.current) return
    const session = createLiveFileSession({
      client,
      programId,
      path,
      user,
      callbacks: {
        onChange: (text) => callbacks.current.onChange(text),
        onSyncChange: (synced) => callbacks.current.onSyncChange(synced),
        onPeopleChange: (people) => callbacks.current.onPeopleChange(people),
        onStatus: setStatus,
        onError: setError,
        onReplaced: () => host.current?.setAttribute("inert", ""),
        isFocused: () =>
          activeRef.current &&
          Boolean(host.current?.contains(document.activeElement)),
        mount: (doc, awareness) => {
          const collaboration = new PierreCollaboration(
            doc,
            awareness,
            path,
            () =>
              setError(
                "Live files can contain up to 256 KiB of text. This edit exceeds that limit."
              )
          )
          const stopLanguage = languageRef.current?.openDocument(
            path,
            source(doc)
          )
          setBinding(collaboration)
          setReady(true)
          return {
            renderCarets: () => collaboration.renderCarets(),
            publishSelection: (focused) =>
              collaboration.publishSelection(focused),
            destroy: () => {
              stopLanguage?.()
              collaboration.destroy()
            },
          }
        },
      },
    })
    sessionRef.current = session
    session.setActive(activeRef.current)
    retry.current = session.retry
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (session.hasPendingChanges()) {
        event.preventDefault()
        event.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => {
      window.removeEventListener("beforeunload", beforeUnload)
      session.dispose()
      sessionRef.current = null
    }
  }, [client, path, programId, user?.id])

  useEffect(() => {
    sessionRef.current?.setActive(active)
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
            onFormatChange={onFormatChange}
            diagnosticTarget={active ? diagnosticTarget : undefined}
            path={path}
            programId={programId}
          />
        )}
      </div>
    </div>
  )
}

function PierreFile({
  diagnosticTarget,
  onFormatChange,
  binding,
  path,
  programId,
}: {
  binding: PierreCollaboration
  onFormatChange: FormatChange
  diagnosticTarget?: DiagnosticTarget
  path: string
  programId: Id<"programs">
}) {
  const viewKey = `${programId}:file:${path}`
  const viewRestored = useRef(false)
  const saveView = () => {
    const editor = binding.editor
    const viewport = completion.wrapper.current?.closest('[role="tabpanel"]')
    if (!editor || !viewport || viewport.getClientRects().length === 0) return
    const code = [...(completion.wrapper.current?.querySelectorAll("*") ?? [])]
      .map((node) => node.shadowRoot?.querySelector<HTMLElement>("[data-code]"))
      .find(Boolean)
    if (!viewRestored.current) {
      const saved = readEditorState<FileView>(viewKey)
      if (saved && !targetRef.current) {
        viewport.scrollTop = Number.isFinite(saved.top) ? saved.top : 0
        viewport.scrollLeft = Number.isFinite(saved.left) ? saved.left : 0
        if (code) code.scrollLeft = saved.codeLeft ?? 0
      }
      viewRestored.current = true
      return
    }
    writeEditorState(viewKey, {
      selections: (editor.getViewState().selections ?? []).map((selection) => ({
        start: binding.document.offsetAt(selection.start),
        end: binding.document.offsetAt(selection.end),
        direction: selection.direction,
      })),
      top: viewport.scrollTop,
      left: viewport.scrollLeft,
      codeLeft: code?.scrollLeft ?? 0,
    })
  }
  // Listeners bind once; the effect event reads the current binding and view refs.
  const saveViewState = useEffectEvent(saveView)
  useEffect(() => {
    const timer = setInterval(saveViewState, 300)
    document.addEventListener("selectionchange", saveViewState)
    window.addEventListener("keyup", saveViewState)
    window.addEventListener("pointerup", saveViewState)
    window.addEventListener("scroll", saveViewState, true)
    window.addEventListener("pagehide", saveViewState)
    window.addEventListener("beforeunload", saveViewState)
    return () => {
      saveViewState()
      clearInterval(timer)
      document.removeEventListener("selectionchange", saveViewState)
      window.removeEventListener("keyup", saveViewState)
      window.removeEventListener("pointerup", saveViewState)
      window.removeEventListener("scroll", saveViewState, true)
      window.removeEventListener("pagehide", saveViewState)
      window.removeEventListener("beforeunload", saveViewState)
    }
  }, [])
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
  useEditorFormatting(binding, path, onFormatChange)
  const completion = useEditorCompletion(binding, path)
  const navigation = useEditorNavigation(binding, path, completion.wrapper)
  const file = useRef({
    name: path,
    contents: binding.document.getText(),
    cacheKey: `${programId}:${path}:${binding.shared.clientID}`,
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
              if (!viewRestored.current) {
                const saved = readEditorState<FileView>(viewKey)
                if (saved && Array.isArray(saved.selections)) {
                  const length = binding.document.getText().length
                  const position = (offset: number) =>
                    binding.document.positionAt(
                      Math.max(
                        0,
                        Math.min(length, Number.isFinite(offset) ? offset : 0)
                      )
                    )
                  editor.setSelections(
                    saved.selections.map((selection) => ({
                      start: position(selection.start),
                      end: position(selection.end),
                      direction:
                        selection.direction === "backward"
                          ? "backward"
                          : "forward",
                    }))
                  )
                }
                requestAnimationFrame(saveView)
              }
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
              const background = `${caret.metadata.color}BF`
              marker.style.cssText = `display:block;position:relative;width:2px;height:100%;background:${background}`
              const label = document.createElement("span")
              label.textContent = caret.metadata.name
              label.style.cssText = `position:absolute;bottom:100%;left:0;white-space:nowrap;padding:2px 4px;border-radius:3px 3px 3px 0;font:11px var(--font-serif);color:#111;background:${background}`
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
