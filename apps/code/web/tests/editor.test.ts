import { afterEach, describe, expect, test } from "vitest"
import type { Editor, EditorChangeEvent } from "@pierre/diffs/edit"
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness"
import * as Y from "yjs"
import { PierreCollaboration } from "../src/lib/pierre-collaboration"
import { source } from "../src/lib/live-document"

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose()
})

// Exercise the adapter against Pierre's real TextDocument. The renderer is a
// narrow stand-in for Editor.applyEdits, which reports normalized changes.
function editor(doc: Y.Doc) {
  const awareness = new Awareness(doc)
  const binding = new PierreCollaboration(doc, awareness, "main.cpp", () => {
    throw new Error("size limit")
  })
  const document = binding.document
  let carets: unknown[] = []
  const renderer = {
    getText: () => document.getText(),
    getViewState: () => ({
      selections: [
        {
          start: document.positionAt(3),
          end: document.positionAt(5),
          direction: 1 as const,
        },
      ],
    }),
    setCarets: (next: unknown[]) => {
      carets = next
    },
    applyEdits: (edits: Parameters<Editor["applyEdits"]>[0]) => {
      const change = document.applyEdits(edits)
      if (change)
        binding.localChange({ changes: change.changes } as EditorChangeEvent<
          "file",
          undefined,
          { name: string }
        >)
    },
  }
  binding.attach(
    renderer as unknown as Editor<"file", undefined, { name: string }>
  )
  cleanup.push(() => {
    binding.destroy()
    awareness.destroy()
    doc.destroy()
  })
  return { binding, document, awareness, renderer, carets: () => carets }
}
function pair() {
  const a = new Y.Doc(),
    b = new Y.Doc()
  source(a).insert(0, "robot 🤖\n")
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), "remote")
  return { a, b, alice: editor(a), bob: editor(b) }
}

describe("Pierre collaboration", () => {
  test("two editors converge and native undo hooks preserve the peer's changes", () => {
    const { a, b, alice, bob } = pair()
    alice.renderer.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: "Alice ",
      },
    ])
    bob.renderer.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: "Bob ",
      },
    ])
    const updateA = Y.encodeStateAsUpdate(a),
      updateB = Y.encodeStateAsUpdate(b)
    Y.applyUpdate(a, updateB, "remote")
    Y.applyUpdate(b, updateA, "remote")
    expect(alice.document.getText()).toBe(bob.document.getText())
    expect(alice.document.canUndo).toBe(true)
    alice.document.undo()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), "remote")
    expect(alice.document.getText()).toBe("Bob robot 🤖\n")
    expect(bob.document.getText()).toBe("Bob robot 🤖\n")
    alice.document.undo()
    expect(alice.document.getText()).toBe("Bob robot 🤖\n")
    bob.document.undo()
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b), "remote")
    expect(alice.document.getText()).toBe("robot 🤖\n")
    alice.document.redo()
    expect(alice.document.getText()).toBe("Alice robot 🤖\n")
  })
  test("replacements, multi-line edits, and emoji map to Pierre's UTF-16 positions", () => {
    const { a, b, alice, bob } = pair()
    bob.renderer.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
        newText: "drive\nfast",
      },
    ])
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b), "remote")
    expect(alice.document.getText()).toBe("drive\nfast 🤖\n")
    expect(alice.document.getText()).toBe(source(a).toString())
    expect(bob.document.getText()).toBe(source(b).toString())
    bob.document.undo()
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b), "remote")
    expect(alice.document.getText()).toBe("robot 🤖\n")
  })
  test("relative selections render as Pierre carets and follow peer insertions", () => {
    const { a, b, alice, bob } = pair()
    bob.awareness.setLocalStateField("user", { name: "Bob", color: "#0000ff" })
    bob.binding.publishSelection(true)
    applyAwarenessUpdate(
      alice.awareness,
      encodeAwarenessUpdate(bob.awareness, [b.clientID]),
      "remote"
    )
    alice.binding.renderCarets()
    expect(alice.carets()).toMatchObject([
      {
        anchor: { line: 0, character: 3 },
        focus: { line: 0, character: 5 },
        metadata: { name: "Bob" },
      },
    ])
    alice.renderer.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: "new ",
      },
    ])
    alice.binding.renderCarets()
    expect(alice.carets()).toMatchObject([
      { anchor: { line: 0, character: 7 }, focus: { line: 0, character: 9 } },
    ])
    expect(source(a).toString()).toBe(alice.document.getText())
  })
})
