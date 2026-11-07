import { expect, it, vi } from "vitest"
import { commitFormattedSource } from "../src/lib/commit-formatted-source"

function fixture() {
  const state = {
    dirtyPaths: ["src/main.cpp", "notes.txt"],
    openPaths: ["notes.txt"],
    activePath: "notes.txt",
  }
  const drafts = new Map([
    ["src/main.cpp", "unformatted"],
    ["notes.txt", "notes"],
  ])
  const source = {
    isSynced: () => true,
    subscribe: () => () => {},
    getSnapshot: () => state,
    getDrafts: () => drafts,
    openFile: vi.fn((path: string) => {
      if (!state.openPaths.includes(path)) state.openPaths.push(path)
      state.activePath = path
    }),
    commit: vi.fn(async () => {}),
  }
  return { source, state, drafts }
}

/** A registry whose actions can be set while listeners are waiting for them. */
function registry(actions: Record<string, (() => Promise<void>) | null> = {}) {
  const listeners = new Set<() => void>()
  return {
    actions,
    listeners,
    registry: {
      get: () => actions,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    register(path: string, action: () => Promise<void>) {
      actions[path] = action
      for (const listener of listeners) listener()
    },
  }
}

it("formats a closed dirty source file before committing, preserving the active tab", async () => {
  const { source, state, drafts } = fixture()
  const format = vi.fn(async () => {
    drafts.set("src/main.cpp", "formatted")
  })
  await commitFormattedSource(
    source,
    registry({ "src/main.cpp": format }).registry,
    "save",
    new AbortController().signal
  )
  expect(format).toHaveBeenCalledOnce()
  expect(state.activePath).toBe("notes.txt")
  expect(source.commit).toHaveBeenCalledWith("save")
})

it("waits for an editor to register its formatter, then formats", async () => {
  const { source, drafts } = fixture()
  const format = vi.fn(async () => {
    drafts.set("src/main.cpp", "formatted")
  })
  const formats = registry()
  let subscribed!: () => void
  const waiting = new Promise<void>((resolve) => {
    subscribed = resolve
  })
  const subscribe = formats.registry.subscribe
  const watched = {
    ...formats.registry,
    subscribe: (listener: () => void) => {
      subscribed()
      return subscribe(listener)
    },
  }
  const committed = commitFormattedSource(
    source,
    watched,
    "save",
    new AbortController().signal
  )
  await waiting
  expect(format).not.toHaveBeenCalled()
  formats.register("src/main.cpp", format)
  await committed
  expect(format).toHaveBeenCalledOnce()
  expect(source.commit).toHaveBeenCalledWith("save")
})

it("does not commit when formatting fails or a formatted file changes", async () => {
  const { source, state, drafts } = fixture()
  await expect(
    commitFormattedSource(
      source,
      registry({
        "src/main.cpp": async () => {
          throw new Error("bad style")
        },
      }).registry,
      undefined,
      new AbortController().signal
    )
  ).rejects.toThrow("bad style")
  state.dirtyPaths.push("src/other.cpp")
  await expect(
    commitFormattedSource(
      source,
      registry({
        "src/main.cpp": async () => {
          drafts.set("src/main.cpp", "formatted")
        },
        "src/other.cpp": async () => {
          drafts.set("src/main.cpp", "edited again")
        },
      }).registry,
      undefined,
      new AbortController().signal
    )
  ).rejects.toThrow("Source changed")
  expect(source.commit).not.toHaveBeenCalled()
})
