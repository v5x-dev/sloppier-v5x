import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getFunctionName } from "convex/server"
import * as Y from "yjs"
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness"
import {
  createLiveFileSession,
  type LivePerson,
} from "../src/lib/live-file-session"
import type { Id } from "@v5x/backend/dataModel"

type Options = Parameters<typeof createLiveFileSession>[0]
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function setup(
  hydration = Promise.resolve(),
  pageCount = 1,
  onCache?: (doc: Y.Doc) => void,
  initialOpen?: Options["initialOpen"]
) {
  const remote = new Y.Doc()
  remote.getText("source").insert(0, "robot")
  const initial = Y.encodeStateAsUpdate(remote).buffer as ArrayBuffer
  const vector = Y.encodeStateVector(remote)
  remote.getText("source").insert(5, "!")
  const second = Y.encodeStateAsUpdate(remote, vector).buffer as ArrayBuffer
  const updates = [initial, second]
    .slice(0, pageCount)
    .map((bytes, index) => ({ sequence: index + 1, bytes }))
  remote.destroy()
  let presence: { sessionId: string; bytes: ArrayBuffer }[] = []
  let documentId = "document"
  let local: Y.Doc | undefined
  const watches: {
    name: string
    args: Record<string, unknown>
    update?: () => void
    active: boolean
  }[] = []
  const append = vi.fn(
    async (_args: { updateId: string; bytes: ArrayBuffer }) => null
  )
  const disconnect = vi.fn()
  const editor = {
    renderCarets: vi.fn(),
    publishSelection: vi.fn(),
    destroy: vi.fn(),
  }
  const callbacks = {
    onChange: vi.fn(),
    onPeopleChange: vi.fn(),
    onSyncChange: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
    onReplaced: vi.fn(),
    isFocused: () => true,
    mount: vi.fn((doc: Y.Doc) => {
      local = doc
      return editor
    }),
  }
  const cache = { whenSynced: hydration, destroy: vi.fn(async () => {}) }
  const client = {
    action: vi.fn(async () => "document"),
    mutation: vi.fn(
      async (
        reference: Parameters<typeof getFunctionName>[0],
        args: Record<string, unknown>
      ) => {
        const name = getFunctionName(reference)
        if (name === "crdt:appendUpdate")
          return append(args as { updateId: string; bytes: ArrayBuffer })
        if (name === "presence:heartbeatFile") return { sessionToken: "token" }
        if (name === "presence:disconnect") disconnect(args)
        return null
      }
    ),
    watchQuery: vi.fn(
      (
        reference: Parameters<typeof getFunctionName>[0],
        args: Record<string, unknown>
      ) => {
        const watch = {
          name: getFunctionName(reference),
          args,
          active: true,
        } as (typeof watches)[number]
        watches.push(watch)
        return {
          localQueryResult: () =>
            watch.name === "crdt:updatesSince"
              ? {
                  documentId,
                  updates: updates.slice(
                    Number(args.afterSequence),
                    Number(args.afterSequence) + 1
                  ),
                  hasMore: Number(args.afterSequence) + 1 < pageCount,
                  lastSequence: pageCount,
                }
              : watch.name === "presence:listAwareness"
                ? presence
                : [],
          onUpdate: (update: () => void) => {
            watch.update = update
            return () => {
              watch.active = false
            }
          },
        }
      }
    ),
  }
  const session = createLiveFileSession({
    client: client as unknown as Options["client"],
    initialOpen,
    programId: "program" as Id<"programs">,
    path: "src/main.cpp",
    user: { id: "alice", email: "alice@example.com" },
    callbacks,
    createCache: (_name, doc) => {
      onCache?.(doc)
      return cache
    },
  })
  return {
    session,
    client,
    callbacks,
    cache,
    append,
    editor,
    watches,
    disconnect,
    text: () => local!.getText("source"),
    setPresence: (sessions: typeof presence) => {
      presence = sessions
      for (const watch of watches)
        if (watch.active && watch.name === "presence:listAwareness")
          watch.update?.()
    },
    replace: () => {
      documentId = "replacement"
      for (const watch of [...watches])
        if (watch.active && watch.name === "crdt:updatesSince") watch.update?.()
    },
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  }
}
function heartbeatSessionId(s: ReturnType<typeof setup>) {
  const heartbeat = s.client.mutation.mock.calls.find(
    ([reference]) => getFunctionName(reference) === "presence:heartbeatFile"
  )
  return (heartbeat?.[1] as { sessionId?: string } | undefined)?.sessionId
}

describe("presence session", () => {
  it("shares tab activity and keeps a person active while any of their tabs is active", async () => {
    const s = setup()
    const docs = [new Y.Doc(), new Y.Doc()]
    const peers = docs.map((doc) => new Awareness(doc))
    try {
      await vi.advanceTimersByTimeAsync(0)
      const local = s.callbacks.mount.mock.calls[0] as unknown as [
        Y.Doc,
        Awareness,
      ]
      s.session.setBrowserActive(true)
      expect(local[1].getLocalState()?.active).toBe(true)
      s.session.setActive(false)
      expect(local[1].getLocalState()?.active).toBe(true)
      s.session.setBrowserActive(false)
      expect(local[1].getLocalState()?.active).toBe(false)
      const update = (states: boolean[]) => {
        s.setPresence(
          peers.map((peer, index) => {
            peer.setLocalState({
              user: { id: "bob", name: "Bob", color: "blue" },
              active: states[index],
            })
            return {
              sessionId: `bob-tab-${index}`,
              bytes: encodeAwarenessUpdate(peer, [peer.clientID])
                .buffer as ArrayBuffer,
            }
          })
        )
      }
      for (const states of [
        [true, false],
        [false, true],
        [false, false],
        [true, true],
      ]) {
        update(states)
        expect(
          s.callbacks.onPeopleChange.mock.lastCall?.[0].find(
            (person: LivePerson) => person.id === "bob"
          )?.active
        ).toBe(states.some(Boolean))
      }
    } finally {
      s.session.dispose()
      peers.forEach((peer) => peer.destroy())
      docs.forEach((doc) => doc.destroy())
    }
  })

  it("replaces the old Yjs client when a peer reloads the same session", async () => {
    const s = setup()
    const peers = [new Y.Doc(), new Y.Doc(), new Y.Doc()]
    const awareness = peers.map((doc) => new Awareness(doc))
    try {
      await vi.advanceTimersByTimeAsync(0)
      const local = s.callbacks.mount.mock.calls[0] as unknown as [
        Y.Doc,
        Awareness,
      ]
      for (const peer of awareness) {
        peer.setLocalState({
          user: { id: "bob", name: "Bob", color: "blue" },
          cursor: {},
        })
        s.setPresence([
          {
            sessionId: "bob-tab",
            bytes: encodeAwarenessUpdate(peer, [peer.clientID])
              .buffer as ArrayBuffer,
          },
        ])
        expect(
          [...local[1].getStates().keys()].filter(
            (id) => id !== local[0].clientID
          )
        ).toEqual([peer.clientID])
      }
      s.setPresence([])
      expect([...local[1].getStates().keys()]).toEqual([local[0].clientID])
    } finally {
      s.session.dispose()
      awareness.forEach((peer) => peer.destroy())
      peers.forEach((doc) => doc.destroy())
    }
  })

  it("reuses one session per tab, user and file, so a reloaded page replaces its previous caret", async () => {
    vi.stubGlobal("sessionStorage", memoryStorage())
    const previousPage = setup()
    const reloadedPage = setup()
    try {
      await vi.advanceTimersByTimeAsync(0)
      const id = heartbeatSessionId(previousPage)
      expect(id).toBeDefined()
      expect(heartbeatSessionId(reloadedPage)).toBe(id)
      vi.stubGlobal("sessionStorage", memoryStorage())
      const otherTab = setup()
      try {
        await vi.advanceTimersByTimeAsync(0)
        expect(heartbeatSessionId(otherTab)).not.toBe(id)
      } finally {
        otherTab.session.dispose()
      }
    } finally {
      previousPage.session.dispose()
      reloadedPage.session.dispose()
      vi.unstubAllGlobals()
    }
  })
})

describe("live file session", () => {
  it("uses the prefetched document and retries an unsuccessful prefetch", async () => {
    const existing = setup(
      Promise.resolve(),
      1,
      undefined,
      Promise.resolve("document" as Id<"crdtDocuments">)
    )
    const failed = setup(Promise.resolve(), 1, undefined, Promise.resolve(null))
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(existing.client.action).not.toHaveBeenCalled()
      expect(existing.callbacks.mount).toHaveBeenCalledOnce()
      expect(failed.client.action).toHaveBeenCalledOnce()
      expect(failed.callbacks.mount).toHaveBeenCalledOnce()
    } finally {
      existing.session.dispose()
      failed.session.dispose()
    }
  })

  it("replays every page before mounting and advances the subscription cursor", async () => {
    const s = setup(Promise.resolve(), 2)
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(s.text().toString()).toBe("robot!")
      expect(s.callbacks.mount).toHaveBeenCalledOnce()
      expect(
        s.watches
          .filter((watch) => watch.name === "crdt:updatesSince")
          .map((watch) => watch.args.afterSequence)
      ).toEqual([0, 1, 2])
    } finally {
      s.session.dispose()
    }
  })

  it("waits for local recovery and replay before attaching the editor", async () => {
    const hydration = deferred<void>()
    const s = setup(hydration.promise)
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(s.callbacks.mount).not.toHaveBeenCalled()
      expect(
        s.watches.some((watch) => watch.name === "crdt:updatesSince")
      ).toBe(true)
      expect(s.session.hasPendingChanges()).toBe(true)
      hydration.resolve()
      await vi.advanceTimersByTimeAsync(0)
      expect(s.callbacks.mount).toHaveBeenCalledOnce()
      expect(s.text().toString()).toBe("robot")
      expect(s.session.hasPendingChanges()).toBe(false)
      expect(
        s.watches
          .filter((watch) => watch.active && watch.name === "crdt:updatesSince")
          .map((watch) => watch.args.afterSequence)
      ).toEqual([1])
    } finally {
      s.session.dispose()
    }
  })
  it("merges recovered local changes after remote replay before sending or mounting", async () => {
    const hydration = deferred<void>()
    let cached: Y.Doc | undefined
    const s = setup(hydration.promise, 1, (doc) => {
      cached = doc
    })
    try {
      await vi.advanceTimersByTimeAsync(0)
      cached!.getText("source").insert(0, "offline ")
      await vi.advanceTimersByTimeAsync(500)
      expect(s.callbacks.mount).not.toHaveBeenCalled()
      expect(s.append).not.toHaveBeenCalled()
      hydration.resolve()
      await vi.advanceTimersByTimeAsync(0)
      expect(s.text().toString()).toBe("offline robot")
      expect(s.append).toHaveBeenCalledOnce()
    } finally {
      s.session.dispose()
    }
  })

  it("closing during hydration cleans up replay and prevents presence and editor attachment", async () => {
    const hydration = deferred<void>()
    const s = setup(hydration.promise)
    await vi.advanceTimersByTimeAsync(0)
    s.session.dispose()
    hydration.resolve()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(s.callbacks.mount).not.toHaveBeenCalled()
    expect(
      s.watches.filter((watch) => watch.name === "crdt:updatesSince")
    ).toHaveLength(2)
    expect(s.watches.every((watch) => !watch.active)).toBe(true)
    expect(s.client.mutation).not.toHaveBeenCalled()
    expect(s.cache.destroy).toHaveBeenCalledOnce()
  })
  it("retries identical bytes after a lost response and sends later typing separately", async () => {
    const s = setup()
    try {
      await vi.advanceTimersByTimeAsync(0)
      s.append.mockRejectedValueOnce(new Error("response lost"))
      s.text().insert(5, " first")
      await vi.advanceTimersByTimeAsync(250)
      expect(s.append).toHaveBeenCalledOnce()
      expect(s.session.hasPendingChanges()).toBe(true)
      const first = s.append.mock.calls[0][0]
      s.text().insert(s.text().length, " later")
      s.session.retry()
      await vi.advanceTimersByTimeAsync(0)
      const retry = s.append.mock.calls[1][0]
      expect(retry.updateId).toBe(first.updateId)
      expect(new Uint8Array(retry.bytes)).toEqual(new Uint8Array(first.bytes))
      expect(s.session.hasPendingChanges()).toBe(true)
      await vi.advanceTimersByTimeAsync(250)
      expect(s.append).toHaveBeenCalledTimes(3)
      expect(s.append.mock.calls[2][0].updateId).not.toBe(first.updateId)
      expect(s.session.hasPendingChanges()).toBe(false)
    } finally {
      s.session.dispose()
    }
  })
  it("document replacement stops writes and reports unsynchronized state", async () => {
    const s = setup()
    try {
      await vi.advanceTimersByTimeAsync(0)
      s.replace()
      expect(s.session.hasPendingChanges()).toBe(true)
      s.session.retry()
      s.text().insert(0, "pending")
      await vi.advanceTimersByTimeAsync(250)
      expect(s.callbacks.onReplaced).toHaveBeenCalledOnce()
      expect(s.callbacks.onSyncChange).toHaveBeenCalledWith(false)
      expect(s.callbacks.onError).toHaveBeenCalledWith(
        expect.stringContaining("deleted or replaced")
      )
      expect(s.append).not.toHaveBeenCalled()
    } finally {
      s.session.dispose()
    }
  })
  it("a write acknowledged after replacement cannot clear the replacement warning", async () => {
    const s = setup()
    const sent = deferred<null>()
    try {
      await vi.advanceTimersByTimeAsync(0)
      s.append.mockReturnValueOnce(sent.promise)
      s.text().insert(0, "edit")
      await vi.advanceTimersByTimeAsync(250)
      s.replace()
      s.callbacks.onError.mockClear()
      sent.resolve(null)
      await vi.advanceTimersByTimeAsync(0)
      expect(s.callbacks.onError).not.toHaveBeenCalled()
      expect(s.session.hasPendingChanges()).toBe(true)
    } finally {
      s.session.dispose()
    }
  })
  it("a write completing after disposal cannot restart watches or notify rendering", async () => {
    const s = setup()
    const sent = deferred<null>()
    await vi.advanceTimersByTimeAsync(0)
    s.append.mockReturnValueOnce(sent.promise)
    s.text().insert(0, "edit")
    await vi.advanceTimersByTimeAsync(250)
    expect(s.append).toHaveBeenCalledOnce()
    s.session.dispose()
    const watches = s.client.watchQuery.mock.calls.length
    s.callbacks.onError.mockClear()
    s.callbacks.onStatus.mockClear()
    sent.resolve(null)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(s.client.watchQuery).toHaveBeenCalledTimes(watches)
    expect(s.callbacks.onStatus).not.toHaveBeenCalled()
    expect(s.callbacks.onError).not.toHaveBeenCalled()
    expect(s.watches.every((watch) => !watch.active)).toBe(true)
    expect(s.editor.destroy).toHaveBeenCalledOnce()
    expect(s.disconnect).toHaveBeenCalledOnce()
  })
})
