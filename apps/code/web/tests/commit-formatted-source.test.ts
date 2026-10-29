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

it("formats a closed dirty source file before committing, preserving the active tab", async () => {
  const { source, state, drafts } = fixture()
  const format = vi.fn(async () => {
    drafts.set("src/main.cpp", "formatted")
  })
  await commitFormattedSource(
    source,
    () => ({ "src/main.cpp": format }),
    "save",
    new AbortController().signal
  )
  expect(format).toHaveBeenCalledOnce()
  expect(state.activePath).toBe("notes.txt")
  expect(source.commit).toHaveBeenCalledWith("save")
})

it("does not commit when formatting fails or a formatted file changes", async () => {
  const { source, state, drafts } = fixture()
  await expect(
    commitFormattedSource(
      source,
      () => ({
        "src/main.cpp": async () => {
          throw new Error("bad style")
        },
      }),
      undefined,
      new AbortController().signal
    )
  ).rejects.toThrow("bad style")
  state.dirtyPaths.push("src/other.cpp")
  await expect(
    commitFormattedSource(
      source,
      () => ({
        "src/main.cpp": async () => {
          drafts.set("src/main.cpp", "formatted")
        },
        "src/other.cpp": async () => {
          drafts.set("src/main.cpp", "edited again")
        },
      }),
      undefined,
      new AbortController().signal
    )
  ).rejects.toThrow("Source changed")
  expect(source.commit).not.toHaveBeenCalled()
})
