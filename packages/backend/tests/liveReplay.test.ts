import { describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import { replayLiveDocument } from "../convex/lib/liveReplay"
import { restoreUpdate } from "../convex/lib/history"

function updates() {
  const doc = new Y.Doc()
  const first = Y.encodeStateAsUpdate(doc)
  doc.getText("source").insert(0, "robot")
  const insert = Y.encodeStateAsUpdate(
    doc,
    Y.encodeStateVectorFromUpdate(first)
  )
  const vector = Y.encodeStateVector(doc)
  doc.getText("source").delete(0, 1)
  const remove = Y.encodeStateAsUpdate(doc, vector)
  doc.destroy()
  return [insert, remove].map((bytes, index) => ({
    sequence: index + 1,
    bytes: bytes.buffer as ArrayBuffer,
  }))
}

describe("live document replay", () => {
  it("follows page cursors and returns text and a restorable snapshot", async () => {
    const changes = updates()
    const read = vi.fn(async (cursor: number) => ({
      documentId: "file",
      updates: [changes[cursor]],
      hasMore: cursor === 0,
    }))
    const budget = { used: 0, limit: 1024 }
    const replay = await replayLiveDocument(read, budget)
    expect(read.mock.calls).toEqual([[0], [1]])
    expect(replay.contents).toBe("obot")
    expect(replay.documentId).toBe("file")
    expect(budget.used).toBe(
      changes.reduce((n, update) => n + update.bytes.byteLength, 0)
    )
    const restored = new Y.Doc()
    Y.applyUpdate(restored, new Uint8Array(replay.snapshot))
    Y.applyUpdate(
      restored,
      new Uint8Array(restoreUpdate([replay.snapshot], "restored"))
    )
    expect(restored.getText("source").toString()).toBe("restored")
    restored.destroy()
  })
  it("rejects replacement between pages and a mismatched expected identity", async () => {
    const changes = updates()
    const read = async (cursor: number) => ({
      documentId: cursor ? "new" : "old",
      updates: cursor ? [] : [changes[0]],
      hasMore: cursor === 0,
    })
    await expect(
      replayLiveDocument(read, { used: 0, limit: 1024 })
    ).rejects.toMatchObject({ reason: "replaced" })
    await expect(
      replayLiveDocument(read, { used: 0, limit: 1024 }, "new")
    ).rejects.toMatchObject({ reason: "replaced" })
  })
  it("keeps failed replay bytes in the shared budget", async () => {
    const changes = updates()
    const budget = { used: 0, limit: changes[0].bytes.byteLength }
    const read = async () => ({
      documentId: "file",
      updates: changes,
      hasMore: false,
    })
    await expect(replayLiveDocument(read, budget)).rejects.toMatchObject({
      reason: "limit",
    })
    expect(budget.used).toBeGreaterThan(budget.limit)
  })
  it("rejects a stalled page instead of looping forever", async () => {
    await expect(
      replayLiveDocument(
        async () => ({ documentId: "file", updates: [], hasMore: true }),
        { used: 0, limit: 1024 }
      )
    ).rejects.toMatchObject({ reason: "stalled" })
  })
  it("propagates read failures without returning partial text", async () => {
    const changes = updates()
    const failure = new Error("connection lost")
    await expect(
      replayLiveDocument(
        async (cursor) => {
          if (cursor) throw failure
          return { documentId: "file", updates: [changes[0]], hasMore: true }
        },
        { used: 0, limit: 1024 }
      )
    ).rejects.toBe(failure)
  })
  it("represents an absent live document without inventing an identity", async () => {
    expect(
      await replayLiveDocument(
        async () => ({ documentId: null, updates: [], hasMore: false }),
        { used: 0, limit: 1024 }
      )
    ).toMatchObject({ documentId: null, contents: "" })
  })
})
