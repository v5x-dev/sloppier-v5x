import { getFiletypeFromFileName } from "@pierre/diffs"
import { TextDocument } from "@pierre/diffs/edit"
import type {
  Editor,
  EditorChangeEvent,
  ResolvedTextEdit,
  TextEdit,
} from "@pierre/diffs/edit"
import type { Awareness } from "y-protocols/awareness"
import * as Y from "yjs"
import { MAX_SOURCE_BYTES, source } from "./live-document"

export const LOCAL_EDIT = Symbol("pierre-local-edit")

// Pierre keeps its rendering, commands, selection mapping, and syntax support.
// Its public TextDocument undo hooks delegate to Yjs so remote edits never enter
// the local undo stack. Yjs changes render through Editor.applyEdits.
export class CollaborativeTextDocument extends TextDocument<"file", undefined> {
  applyingRemote = false
  constructor(
    path: string,
    readonly shared: Y.Doc,
    readonly undoManager: Y.UndoManager,
    readonly onLimit: () => void
  ) {
    super(path, source(shared).toString(), getFiletypeFromFileName(path))
  }
  override get canUndo() {
    return this.undoManager.canUndo()
  }
  override get canRedo() {
    return this.undoManager.canRedo()
  }
  override undo(): undefined {
    this.undoManager.undo()
    return undefined
  }
  override redo(): undefined {
    this.undoManager.redo()
    return undefined
  }
  override applyEdits(
    ...args: Parameters<TextDocument<"file", undefined>["applyEdits"]>
  ) {
    const [
      edits,
      updateHistory,
      selectionsBefore,
      selectionsAfter,
      undoBoundary,
    ] = args
    return this.applyResolvedEdits(
      this.resolveEdits(edits),
      updateHistory,
      selectionsBefore,
      selectionsAfter,
      undoBoundary
    )
  }
  override applyResolvedEdits(
    ...args: Parameters<TextDocument<"file", undefined>["applyResolvedEdits"]>
  ) {
    if (!this.applyingRemote) {
      let next = this.getText()
      for (const edit of [...args[0]].sort((a, b) => b.start - a.start))
        next = next.slice(0, edit.start) + edit.text + next.slice(edit.end)
      if (new TextEncoder().encode(next).byteLength > MAX_SOURCE_BYTES) {
        this.onLimit()
        return undefined
      }
    }
    return super.applyResolvedEdits(...args)
  }
}

export function yDeltaToEdits(
  document: TextDocument<"file", undefined>,
  delta: Y.YTextEvent["delta"]
): TextEdit[] {
  let offset = 0
  let start = 0
  let inserted = ""
  let deleted = 0
  const edits: TextEdit[] = []
  const flush = () => {
    if (deleted || inserted)
      edits.push({
        range: {
          start: document.positionAt(start),
          end: document.positionAt(start + deleted),
        },
        newText: inserted,
      })
    inserted = ""
    deleted = 0
  }
  for (const part of delta) {
    if (part.retain) {
      flush()
      offset += part.retain
      start = offset
    }
    if (part.delete) {
      deleted += part.delete
      offset += part.delete
    }
    if (typeof part.insert === "string") inserted += part.insert
  }
  flush()
  return edits
}

export function applyLocalChanges(
  shared: Y.Doc,
  changes: readonly ResolvedTextEdit[]
) {
  shared.transact(() => {
    for (const change of [...changes].sort((a, b) => b.start - a.start)) {
      if (change.end > change.start)
        source(shared).delete(change.start, change.end - change.start)
      if (change.text) source(shared).insert(change.start, change.text)
    }
  }, LOCAL_EDIT)
}

export class PierreCollaboration {
  readonly undo: Y.UndoManager
  readonly document: CollaborativeTextDocument
  editor?: Editor<"file", undefined, { name: string }>
  private readonly observe: (
    event: Y.YTextEvent,
    transaction: Y.Transaction
  ) => void
  constructor(
    readonly shared: Y.Doc,
    readonly awareness: Awareness,
    path: string,
    onLimit: () => void
  ) {
    this.undo = new Y.UndoManager(source(shared), {
      trackedOrigins: new Set([LOCAL_EDIT]),
    })
    this.document = new CollaborativeTextDocument(
      path,
      shared,
      this.undo,
      onLimit
    )
    this.observe = (event, transaction) => {
      if (transaction.origin === LOCAL_EDIT || !this.editor) return
      const edits = yDeltaToEdits(this.document, event.delta)
      if (!edits.length) return
      this.document.applyingRemote = true
      try {
        this.editor.applyEdits(edits, false)
        this.document.clearHistory()
      } finally {
        this.document.applyingRemote = false
      }
      this.renderCarets()
    }
    source(shared).observe(this.observe)
  }
  attach(editor: Editor<"file", undefined, { name: string }>) {
    this.editor = editor
    // Updates may arrive between React rendering the File and onAttach.
    const text = source(this.shared).toString()
    if (text !== editor.getText()) {
      this.document.applyingRemote = true
      try {
        editor.applyEdits(
          [
            {
              range: {
                start: { line: 0, character: 0 },
                end: this.document.positionAt(this.document.getText().length),
              },
              newText: text,
            },
          ],
          false
        )
      } finally {
        this.document.applyingRemote = false
      }
    }
    this.document.clearHistory()
    this.renderCarets()
  }
  localChange(event: EditorChangeEvent<"file", undefined, { name: string }>) {
    if (this.document.applyingRemote) return
    applyLocalChanges(this.shared, event.changes)
    this.document.clearHistory()
  }
  publishSelection(focused: boolean) {
    const selection = focused
      ? this.editor?.getViewState().selections?.at(0)
      : undefined
    const next = selection
      ? {
          anchor: Y.createRelativePositionFromTypeIndex(
            source(this.shared),
            this.document.offsetAt(
              selection.direction === -1 ? selection.end : selection.start
            )
          ),
          head: Y.createRelativePositionFromTypeIndex(
            source(this.shared),
            this.document.offsetAt(
              selection.direction === -1 ? selection.start : selection.end
            )
          ),
        }
      : null
    const previous = this.awareness.getLocalState()?.cursor
    if (JSON.stringify(previous ?? null) !== JSON.stringify(next))
      this.awareness.setLocalStateField("cursor", next)
  }
  renderCarets() {
    const carets = []
    for (const [id, state] of this.awareness.getStates()) {
      if (
        id === this.shared.clientID ||
        !state.cursor?.anchor ||
        !state.cursor?.head
      )
        continue
      try {
        const anchor = Y.createAbsolutePositionFromRelativePosition(
          state.cursor.anchor,
          this.shared
        )
        const head = Y.createAbsolutePositionFromRelativePosition(
          state.cursor.head,
          this.shared
        )
        if (
          !anchor ||
          !head ||
          anchor.type !== source(this.shared) ||
          head.type !== source(this.shared)
        )
          continue
        carets.push({
          anchor: this.document.positionAt(anchor.index),
          focus: this.document.positionAt(head.index),
          metadata: {
            name: String(state.user?.name ?? "Collaborator"),
            color: /^#[0-9a-f]{6}$/i.test(state.user?.color)
              ? (state.user.color as string)
              : "#22d3ee",
          },
        })
      } catch {
        /* Ignore incompatible awareness positions. */
      }
    }
    this.editor?.setCarets(carets)
  }
  destroy() {
    source(this.shared).unobserve(this.observe)
    this.undo.destroy()
    this.editor = undefined
  }
}
