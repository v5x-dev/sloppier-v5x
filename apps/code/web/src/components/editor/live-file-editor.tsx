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
import type { Id } from "@v5x/backend/dataModel"
import { Button } from "@v5x/ui/components/button"
import { Spinner } from "@v5x/ui/components/spinner"
import { Editor, type EditorFactory } from "@pierre/diffs/edit"
import { EditProvider, File } from "@pierre/diffs/react"
import { PierreCollaboration } from "@/lib/pierre-collaboration"
import { MAX_SOURCE_BYTES } from "@/lib/live-document"
import {
  joinLiveFile,
  type LiveFileView,
  type LivePerson,
} from "@/lib/live-file-session"
import { useEditorCompletion } from "./editor-completion"
import { useEditorBrackets } from "./editor-brackets"
import { useLanguageService } from "./language-session"
import {
  replacementEdits,
  type ReplacementAction,
} from "@/lib/search-replacement"

export type { LivePerson } from "@/lib/live-file-session"

const createEditor: EditorFactory<undefined, { name: string }> = (
  type,
  options,
  key
) => new Editor(type, options, key)

type Props = {
  programId: Id<"programs">
  /** Identifies this open tab, so each copy of a file keeps its own cursor and scroll. */
  viewId: string
  takeLiveOpen: (
    path: string
  ) => Promise<Id<"crdtDocuments"> | null> | undefined
  path: string
  active: boolean
  onFormatChange: FormatChange
  diagnosticTarget?: DiagnosticTarget
  onChange: (text: string) => void
  onPeopleChange: (people: LivePerson[]) => void
  onSyncChange: (synced: boolean) => void
  onReplacementAction: (path: string, action: ReplacementAction | null) => void
  onCursorLine: (path: string, line: number) => void
}

export function LiveFileEditor({
  programId,
  viewId,
  takeLiveOpen,
  path,
  active,
  diagnosticTarget,
  onFormatChange,
  onChange,
  onSyncChange,
  onPeopleChange,
  onReplacementAction,
  onCursorLine,
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
  const joinRef = useRef<ReturnType<typeof joinLiveFile> | null>(null)
  const [binding, setBinding] = useState<PierreCollaboration | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    if (!user || !host.current) return
    const view: LiveFileView = {
      onChange: (text) => callbacks.current.onChange(text),
      onSyncChange: (synced) => callbacks.current.onSyncChange(synced),
      onPeopleChange: (people) => callbacks.current.onPeopleChange(people),
      onStatus: setStatus,
      onError: setError,
      onReplaced: () => {
        onReplacementAction(path, null)
        host.current?.setAttribute("inert", "")
      },
      isFocused: () =>
        activeRef.current &&
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        Boolean(host.current?.contains(document.activeElement)),
      mount: (doc, awareness, undo) => {
        const collaboration = new PierreCollaboration(
          doc,
          awareness,
          path,
          () =>
            setError(
              "Live files can contain up to 256 KiB of text. This edit exceeds that limit."
            ),
          undo
        )
        setBinding(collaboration)
        setReady(true)
        return collaboration
      },
    }
    const join = joinLiveFile({
      client,
      initialOpen: takeLiveOpen(path),
      programId,
      path,
      user,
      openLanguage: (text) => languageRef.current?.openDocument(path, text),
      view,
    })
    joinRef.current = join
    retry.current = join.session.retry
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (join.session.hasPendingChanges()) {
        event.preventDefault()
        event.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => {
      window.removeEventListener("beforeunload", beforeUnload)
      join.release()
      joinRef.current = null
    }
  }, [client, path, programId, user?.id])

  useEffect(() => {
    joinRef.current?.setActive(active)
  }, [active, client, path, programId, user?.id])

  useEffect(() => {
    const updateActivity = () => {
      joinRef.current?.session.setBrowserActive(
        document.visibilityState === "visible" && document.hasFocus()
      )
    }
    updateActivity()
    document.addEventListener("visibilitychange", updateActivity)
    window.addEventListener("focus", updateActivity)
    window.addEventListener("blur", updateActivity)
    return () => {
      document.removeEventListener("visibilitychange", updateActivity)
      window.removeEventListener("focus", updateActivity)
      window.removeEventListener("blur", updateActivity)
    }
  }, [client, path, programId, user?.id])

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
            active={active}
            onCursorLine={onCursorLine}
            onFormatChange={onFormatChange}
            diagnosticTarget={active ? diagnosticTarget : undefined}
            path={path}
            programId={programId}
            viewId={viewId}
            onReplacementAction={onReplacementAction}
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
  active,
  onCursorLine,
  path,
  programId,
  viewId,
  onReplacementAction,
}: {
  viewId: string
  binding: PierreCollaboration
  active: boolean
  onCursorLine: (path: string, line: number) => void
  onFormatChange: FormatChange
  diagnosticTarget?: DiagnosticTarget
  path: string
  programId: Id<"programs">
  onReplacementAction: (path: string, action: ReplacementAction | null) => void
}) {
  useEffect(
    () => () => onReplacementAction(path, null),
    [path, onReplacementAction]
  )
  // A copy opened from a split starts from the file's last view state, and then
  // keeps its own cursor and scroll under its tab's key.
  const viewKey = `${programId}:file:${path}`
  const instanceKey = `${viewKey}:${viewId}`
  const readViewState = () =>
    readEditorState<FileView>(instanceKey) ?? readEditorState<FileView>(viewKey)
  const viewRestored = useRef(false)
  const bottomScrollFrame = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (bottomScrollFrame.current !== null)
        cancelAnimationFrame(bottomScrollFrame.current)
    },
    []
  )
  const saveView = () => {
    const editor = binding.editor
    const viewport = completion.wrapper.current?.closest('[role="tabpanel"]')
    if (!editor || !viewport || viewport.getClientRects().length === 0) return
    const caretSelection = editor.getViewState().selections?.[0]
    if (active && caretSelection) {
      const position =
        caretSelection.direction === -1
          ? caretSelection.start
          : caretSelection.end
      const offset = binding.document.offsetAt(position)
      onCursorLine(
        path,
        binding.document.getText().slice(0, offset).split("\n").length
      )
    }
    const code = [...(completion.wrapper.current?.querySelectorAll("*") ?? [])]
      .map((node) => node.shadowRoot?.querySelector<HTMLElement>("[data-code]"))
      .find(Boolean)
    if (!viewRestored.current) {
      const saved = readViewState()
      if (saved && !targetRef.current) {
        viewport.scrollTop = Number.isFinite(saved.top) ? saved.top : 0
        viewport.scrollLeft = Number.isFinite(saved.left) ? saved.left : 0
        if (code) code.scrollLeft = saved.codeLeft ?? 0
      }
      viewRestored.current = true
      return
    }
    const state: FileView = {
      selections: (editor.getViewState().selections ?? []).map((selection) => ({
        start: binding.document.offsetAt(selection.start),
        end: binding.document.offsetAt(selection.end),
        // Saved as words, so restores read the direction the editor had.
        direction: selection.direction === -1 ? "backward" : "forward",
      })),
      top: viewport.scrollTop,
      left: viewport.scrollLeft,
      codeLeft: code?.scrollLeft ?? 0,
    }
    writeEditorState(instanceKey, state)
    writeEditorState(viewKey, state)
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
  useEditorBrackets(binding, completion.wrapper)
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
              onReplacementAction(path, (matches, replacement) => {
                const text = binding.document.getText()
                const edits = replacementEdits(text, matches, replacement)
                const nextSize =
                  new TextEncoder().encode(text).byteLength +
                  matches.reduce(
                    (total, match) =>
                      total +
                      new TextEncoder().encode(replacement).byteLength -
                      new TextEncoder().encode(
                        match.text.slice(match.start, match.end)
                      ).byteLength,
                    0
                  )
                if (nextSize > MAX_SOURCE_BYTES)
                  throw new Error(
                    "The replacement exceeds the 256 KiB live editing limit."
                  )
                binding.undo.stopCapturing()
                try {
                  editor.applyEdits(edits)
                } finally {
                  binding.undo.stopCapturing()
                }
              })
              if (!viewRestored.current) {
                const saved = readViewState()
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
            const viewport =
              completion.wrapper.current?.closest<HTMLElement>(
                '[role="tabpanel"]'
              )
            const followBottom =
              active &&
              !binding.document.applyingRemote &&
              event.changes.some((change) => change.text.includes("\n")) &&
              viewport &&
              viewport.scrollHeight -
                viewport.clientHeight -
                viewport.scrollTop <=
                24
            binding.localChange(event)
            completion.onLocalChange(event)
            if (followBottom) {
              if (bottomScrollFrame.current !== null)
                cancelAnimationFrame(bottomScrollFrame.current)
              const previousTop = viewport.scrollTop
              bottomScrollFrame.current = requestAnimationFrame(() => {
                bottomScrollFrame.current = requestAnimationFrame(() => {
                  bottomScrollFrame.current = null
                  if (
                    viewport.isConnected &&
                    viewport.scrollTop >= previousTop &&
                    viewport.scrollHeight -
                      viewport.clientHeight -
                      viewport.scrollTop <=
                      48
                  )
                    viewport.scrollTop = viewport.scrollHeight
                })
              })
            }
          }}
          onEditComplete={() => "accept"}
        />
      </EditProvider>
      {completion.popup}
      {navigation}
    </div>
  )
}
