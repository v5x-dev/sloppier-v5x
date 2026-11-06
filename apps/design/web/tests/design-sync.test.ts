import { ConvexError } from "convex/values"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import { DesignSync } from "../src/lib/design-sync"

type Sent = { id: string; bytes: ArrayBuffer }

function setup(append: (id: string, bytes: ArrayBuffer) => Promise<unknown>) {
  let n = 0
  const sync = new DesignSync(append, () => `update-${++n}`)
  return sync
}

function ready(sync: DesignSync) {
  sync.markLocalReady()
  sync.markReplayed()
}

function parts(sync: DesignSync) {
  return sync.doc.getMap("parts")
}

function received(sent: Sent[]) {
  const doc = new Y.Doc()
  for (const { bytes } of sent) Y.applyUpdate(doc, new Uint8Array(bytes))
  return doc.getMap("parts").toJSON()
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("DesignSync", () => {
  it("sends nothing until both local edits and the server replay have loaded", async () => {
    const sent: Sent[] = []
    const sync = setup(async (id, bytes) => void sent.push({ id, bytes }))
    parts(sync).set("offline-edit", 1)
    await vi.runAllTimersAsync()
    expect(sent).toEqual([])
    expect(sync.getStatus()).toEqual({ kind: "loading" })

    sync.markLocalReady()
    await vi.runAllTimersAsync()
    expect(sent).toEqual([])

    sync.markReplayed()
    await vi.runAllTimersAsync()
    expect(received(sent)).toEqual({ "offline-edit": 1 })
    expect(sync.getStatus()).toEqual({ kind: "saved" })
  })

  it("does not send back what came from the server", async () => {
    const other = new Y.Doc()
    other.getMap("parts").set("theirs", 1)
    const sent: Sent[] = []
    const sync = setup(async (id, bytes) => void sent.push({ id, bytes }))
    sync.applyRemote([{ bytes: Y.encodeStateAsUpdate(other).slice().buffer }])
    ready(sync)
    await vi.runAllTimersAsync()
    expect(sent).toEqual([])
    expect(parts(sync).get("theirs")).toBe(1)
    expect(sync.getStatus()).toEqual({ kind: "saved" })
  })

  it("sends a delete of a part the server already has", async () => {
    const other = new Y.Doc()
    other.getMap("parts").set("part", 1)
    const sent: Sent[] = []
    const sync = setup(async (id, bytes) => void sent.push({ id, bytes }))
    const initial = Y.encodeStateAsUpdate(other).slice().buffer
    sync.applyRemote([{ bytes: initial }])
    ready(sync)
    await vi.runAllTimersAsync()

    parts(sync).delete("part")
    await vi.runAllTimersAsync()
    expect(sent).toHaveLength(1)
    expect(received([{ id: "initial", bytes: initial }, ...sent])).toEqual({})
    expect(sync.getStatus()).toEqual({ kind: "saved" })
  })

  it("retries a dropped connection with the same ID and bytes, then sends later edits", async () => {
    const attempts: Sent[] = []
    let failing = true
    const sync = setup(async (id, bytes) => {
      attempts.push({ id, bytes })
      if (failing) throw new Error("connection lost")
    })
    ready(sync)
    parts(sync).set("first", 1)
    await vi.advanceTimersByTimeAsync(200)
    expect(attempts).toHaveLength(1)
    expect(sync.getStatus()).toEqual({ kind: "saving" })

    parts(sync).set("second", 2)
    failing = false
    await vi.runAllTimersAsync()

    expect(attempts[1].id).toBe(attempts[0].id)
    expect(attempts[1].bytes).toEqual(attempts[0].bytes)
    expect(received(attempts)).toEqual({ first: 1, second: 2 })
    expect(new Set(attempts.map((a) => a.id)).size).toBe(2)
    expect(sync.getStatus()).toEqual({ kind: "saved" })
  })

  it("reports a refused update and includes it in the next edit's update", async () => {
    const sent: Sent[] = []
    let refuse = true
    const sync = setup(async (id, bytes) => {
      if (refuse) throw new ConvexError("Too large.")
      sent.push({ id, bytes })
    })
    ready(sync)
    parts(sync).set("first", 1)
    await vi.runAllTimersAsync()
    expect(sync.getStatus()).toEqual({ kind: "error", message: "Too large." })

    refuse = false
    parts(sync).set("second", 2)
    await vi.runAllTimersAsync()
    expect(received(sent)).toEqual({ first: 1, second: 2 })
    expect(sync.getStatus()).toEqual({ kind: "saved" })
  })

  it("converges with another editor changing different parts", async () => {
    const sent: Sent[] = []
    const sync = setup(async (id, bytes) => void sent.push({ id, bytes }))
    ready(sync)
    const other = new Y.Doc()
    other.getMap("parts").set("theirs", 1)
    parts(sync).set("mine", 2)
    sync.applyRemote([{ bytes: Y.encodeStateAsUpdate(other).slice().buffer }])
    await vi.runAllTimersAsync()
    for (const { bytes } of sent) Y.applyUpdate(other, new Uint8Array(bytes))
    expect(other.getMap("parts").toJSON()).toEqual(parts(sync).toJSON())
  })
})
