import { describe, expect, test } from "vitest"
import * as Y from "yjs"
import {
  applyRemote,
  hasChanges,
  pendingUpdate,
  source,
} from "../src/lib/live-document"

function pair() {
  const seed = new Y.Doc()
  source(seed).insert(0, "robot 🤖\n")
  const bytes = Y.encodeStateAsUpdate(seed).buffer as ArrayBuffer
  const a = new Y.Doc(),
    b = new Y.Doc(),
    server = new Y.Doc()
  applyRemote(a, server, bytes)
  Y.applyUpdate(b, new Uint8Array(bytes))
  return { a, b, server }
}

describe("collaborative sync", () => {
  test("concurrent offline inserts and deletes converge, with duplicate delivery", () => {
    const { a, b, server } = pair()
    source(a).insert(0, "Alice ")
    source(b).delete(0, 5)
    source(b).insert(0, "Bob")
    const updateA = pendingUpdate(a, server)
    const updateB = pendingUpdate(b, server)
    Y.applyUpdate(a, updateB)
    Y.applyUpdate(b, updateA)
    Y.applyUpdate(a, updateB)
    Y.applyUpdate(b, updateA)
    expect(source(a).toString()).toBe(source(b).toString())
    expect(source(a).toString()).toContain("Alice")
    expect(source(a).toString()).toContain("Bob")
    expect(source(a).toString()).toContain("🤖")
  })
  test("deletions become clean after acknowledgement, then later deletions remain dirty", () => {
    const { a, server } = pair()
    expect(hasChanges(a, server)).toBe(false)
    source(a).delete(0, 2)
    expect(hasChanges(a, server)).toBe(true)
    Y.applyUpdate(server, pendingUpdate(a, server))
    expect(hasChanges(a, server)).toBe(false)
    source(a).delete(0, 1)
    expect(hasChanges(a, server)).toBe(true)
  })
  test("an edit during an in-flight save remains pending after that save is acknowledged", () => {
    const { a, server } = pair()
    source(a).insert(0, "first ")
    const sent = pendingUpdate(a, server)
    source(a).insert(0, "second ")
    Y.applyUpdate(server, sent)
    expect(hasChanges(a, server)).toBe(true)
    Y.applyUpdate(server, pendingUpdate(a, server))
    expect(hasChanges(a, server)).toBe(false)
    expect(source(server).toString()).toBe(source(a).toString())
  })
  test("remote changes are excluded from local undo", () => {
    const { a, b, server } = pair()
    const undo = new Y.UndoManager(source(a), {
      trackedOrigins: new Set(["local"]),
    })
    a.transact(() => source(a).insert(0, "mine "), "local")
    source(b).insert(source(b).length, "theirs")
    applyRemote(a, server, pendingUpdate(b, server).buffer as ArrayBuffer)
    undo.undo()
    expect(source(a).toString()).toBe("robot 🤖\ntheirs")
    undo.destroy()
  })
})
