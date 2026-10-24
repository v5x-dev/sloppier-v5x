import "fake-indexeddb/auto"
import { expect, test } from "vitest"
import { IndexeddbPersistence } from "y-indexeddb"
import * as Y from "yjs"
import {
  applyRemote,
  hasChanges,
  pendingUpdate,
  source,
} from "../src/lib/live-document"

test("offline edits survive a closed editor and merge with later server changes", async () => {
  const name = `live-test-${crypto.randomUUID()}`
  const server = new Y.Doc(),
    first = new Y.Doc()
  source(server).insert(0, "robot\n")
  Y.applyUpdate(first, Y.encodeStateAsUpdate(server), "remote")
  const cache = new IndexeddbPersistence(name, first)
  await cache.whenSynced
  first.transact(() => {
    source(first).delete(0, 5)
    source(first).insert(0, "offline")
  })
  await cache.destroy()
  first.destroy()
  source(server).insert(source(server).length, "online\n")
  const restored = new Y.Doc(),
    mirror = new Y.Doc()
  const restoredCache = new IndexeddbPersistence(name, restored)
  await restoredCache.whenSynced
  expect(source(restored).toString()).toBe("offline\n")
  applyRemote(
    restored,
    mirror,
    Y.encodeStateAsUpdate(server).buffer as ArrayBuffer
  )
  expect(source(restored).toString()).toBe("offline\nonline\n")
  expect(hasChanges(restored, mirror)).toBe(true)
  Y.applyUpdate(mirror, pendingUpdate(restored, mirror), "remote")
  expect(hasChanges(restored, mirror)).toBe(false)
  await restoredCache.clearData()
  restored.destroy()
  mirror.destroy()
  server.destroy()
})
