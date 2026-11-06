import { describe, expect, it } from "vitest"
import {
  KEYS_STORAGE_KEY,
  createKeyStore,
  type KeyStorage,
} from "@/design/key-store"
import { defaultBindings } from "@/design/keys"

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const storage: KeyStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
  return { storage, data }
}

const blockedStorage: KeyStorage = {
  getItem: () => {
    throw new Error("blocked")
  },
  setItem: () => {
    throw new Error("quota")
  },
  removeItem: () => {
    throw new Error("blocked")
  },
}

describe("the key store", () => {
  it("saves a change and gives it back after a reload", () => {
    const { storage, data } = memoryStorage()
    const first = createKeyStore(storage)
    expect(first.set("frame", ["g"]).ok).toBe(true)
    expect(JSON.parse(data.get(KEYS_STORAGE_KEY) ?? "null")).toEqual({
      version: 1,
      bindings: { frame: ["g"] },
    })
    const reloaded = createKeyStore(storage)
    expect(reloaded.get().frame).toEqual(["g"])
    expect(reloaded.droppedOnLoad).toEqual([])
  })

  it("does not save or change anything for a refused key", () => {
    const { storage, data } = memoryStorage()
    const store = createKeyStore(storage)
    let calls = 0
    store.subscribe(() => calls++)
    const result = store.set("frame", ["w"])
    expect(result.ok).toBe(false)
    expect(store.get()).toEqual(defaultBindings())
    expect(data.has(KEYS_STORAGE_KEY)).toBe(false)
    expect(calls).toBe(0)
  })

  it("tells listeners about a change and stops when unsubscribed", () => {
    const store = createKeyStore(undefined)
    let calls = 0
    const off = store.subscribe(() => calls++)
    store.set("frame", ["g"])
    off()
    store.set("projection", ["p"])
    expect(calls).toBe(1)
  })

  it("puts one action back, and removes the saved entry once nothing is changed", () => {
    const { storage, data } = memoryStorage()
    const store = createKeyStore(storage)
    store.set("frame", ["g"])
    store.reset("frame")
    expect(store.get().frame).toEqual(["f"])
    expect(data.has(KEYS_STORAGE_KEY)).toBe(false)
  })

  it("puts every action back", () => {
    const store = createKeyStore(undefined)
    store.set("frame", ["g"])
    store.set("projection", ["p"])
    store.resetAll()
    expect(store.get()).toEqual(defaultBindings())
  })

  it("keeps working on the defaults when storage holds garbage", () => {
    const { storage } = memoryStorage({ [KEYS_STORAGE_KEY]: "{not json" })
    const store = createKeyStore(storage)
    expect(store.get()).toEqual(defaultBindings())
    expect(store.set("frame", ["g"]).ok).toBe(true)
  })

  it("reports saved entries it had to drop, and keeps the rest", () => {
    const saved = JSON.stringify({
      version: 1,
      bindings: { frame: ["g"], undo: ["Tab"], projection: ["w"] },
    })
    const store = createKeyStore(
      memoryStorage({ [KEYS_STORAGE_KEY]: saved }).storage
    )
    expect(store.get().frame).toEqual(["g"])
    expect(store.get().undo).toEqual(["mod+z"])
    expect([...store.droppedOnLoad].sort()).toEqual(["projection", "undo"])
  })

  it("works in memory when storage throws", () => {
    const store = createKeyStore(blockedStorage)
    expect(store.get()).toEqual(defaultBindings())
    expect(store.set("frame", ["g"]).ok).toBe(true)
    expect(store.get().frame).toEqual(["g"])
    expect(() => store.reset("frame")).not.toThrow()
  })
})
