import { describe, expect, it, vi } from "vitest"
import { WorkbenchSource } from "../src/lib/workbench-source"
import type { Id } from "@workspace/backend/dataModel"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function setup() {
  const actions = {
    listFiles: vi.fn(async () => ({
      paths: ["src/main.cpp", "include/robot.h"],
      hasMore: false,
    })),
    readFile: vi.fn(async () => ({
      bytes: new TextEncoder().encode("original").buffer,
      contentRange: null,
      contentType: "text/plain",
    })),
    commitFiles: vi.fn(async () => ({ commitSha: "commit" })),
    restoreHistoryFile: vi.fn(async () => ({
      commitSha: "restore",
      contents: "restored",
      warning: null as string | null,
    })),
    buildManifest: vi.fn(async () => ({
      sha: "pinned",
      paths: ["src/main.cpp"],
    })),
  }
  const source = new WorkbenchSource("program" as Id<"programs">, actions)
  return { source, actions }
}
async function opened() {
  const result = setup()
  await result.source.loadPaths()
  await Promise.resolve()
  return result
}

describe("workbench source", () => {
  it("notifies draft readers without rerendering the workbench on every keystroke", async () => {
    const { source } = await opened()
    const render = vi.fn(),
      drafts = vi.fn()
    source.subscribe(render)
    source.subscribeDrafts(drafts)
    source.setDraft("src/main.cpp", "first")
    source.setDraft("src/main.cpp", "second")
    expect(render).toHaveBeenCalledOnce()
    expect(drafts).toHaveBeenCalledTimes(2)
    expect(source.getDrafts().get("src/main.cpp")).toBe("second")
  })

  it("acknowledges the commit snapshot while later typing stays dirty", async () => {
    const { source, actions } = await opened()
    const write = deferred<{ commitSha: string }>()
    actions.commitFiles.mockReturnValueOnce(write.promise)
    source.setDraft("src/main.cpp", "captured")
    const commit = source.commit()
    source.setDraft("src/main.cpp", "later typing")
    await expect(
      source.applyExplorerUpdate({
        message: "Delete",
        changes: [{ operation: "delete", path: "src/main.cpp" }],
        removed: ["src/main.cpp"],
      })
    ).rejects.toThrow("current file operation")
    write.resolve({ commitSha: "saved" })
    await commit
    expect(actions.commitFiles.mock.calls[0]).toEqual([
      {
        programId: "program",
        message: "Update src/main.cpp",
        changes: [
          { operation: "put", path: "src/main.cpp", contents: "captured" },
        ],
      },
    ])
    expect(source.getSnapshot().dirtyPaths).toEqual(["src/main.cpp"])
    source.setDraft("src/main.cpp", "captured")
    expect(source.getSnapshot().dirtyPaths).toEqual([])
  })
  it("moves a dirty file with its draft, tab, editor identity, scroll, and presence", async () => {
    const { source } = await opened()
    source.setDraft("src/main.cpp", "draft")
    source.setPeople("src/main.cpp", [
      { id: "alice", name: "Alice", color: "red" },
    ])
    source.setSynced("src/main.cpp", true)
    source.scrollPositions.set("src/main.cpp", 123)
    const editorKey = source.getSnapshot().loaded["src/main.cpp"]?.editorKey
    const listener = vi.fn()
    source.subscribeDrafts(listener)
    await source.applyExplorerUpdate({
      message: "Move",
      changes: [
        { operation: "delete", path: "src/main.cpp" },
        { operation: "put", path: "code/main.cpp", contents: "draft" },
      ],
      moves: [{ from: "src", to: "code" }],
    })
    const state = source.getSnapshot()
    expect(state.openPaths).toEqual(["code/main.cpp"])
    expect(state.activePath).toBe("code/main.cpp")
    expect(state.loaded["code/main.cpp"]).toMatchObject({
      contents: "draft",
      editorKey,
    })
    expect(state.loaded["src/main.cpp"]).toBeUndefined()
    expect([...source.getDrafts()]).toEqual([["code/main.cpp", "draft"]])
    expect(state.dirtyPaths).toEqual(["code/main.cpp"])
    expect(state.filePeople["code/main.cpp"][0].id).toBe("alice")
    expect(source.scrollPositions.get("code/main.cpp")).toBe(123)
    expect(listener).toHaveBeenCalledOnce()
    // Cleanup from the old editor must not recreate entries at its former path.
    source.setPeople("src/main.cpp", [])
    source.setSynced("src/main.cpp", false)
    source.setDraft("src/main.cpp", "stale")
    expect(source.getSnapshot().filePeople["src/main.cpp"]).toBeUndefined()
    expect(source.getSnapshot().liveSync["src/main.cpp"]).toBeUndefined()
    expect(source.getDrafts().has("src/main.cpp")).toBe(false)
    expect(source.isSynced()).toBe(true)
  })
  it("leaves source state untouched on a rejected write and releases the operation", async () => {
    const { source, actions } = await opened()
    source.setDraft("src/main.cpp", "draft")
    const before = source.getSnapshot()
    actions.commitFiles.mockRejectedValueOnce(new Error("offline"))
    await expect(
      source.applyExplorerUpdate({
        message: "Delete",
        changes: [{ operation: "delete", path: "src/main.cpp" }],
        removed: ["src/main.cpp"],
      })
    ).rejects.toThrow("offline")
    expect(source.getSnapshot()).toBe(before)
    await source.commit()
    expect(source.getSnapshot().dirtyPaths).toEqual([])
  })
  it("blocks close, commit, restore and file changes while live edits are unsynchronized", async () => {
    const { source, actions } = await opened()
    source.setDraft("src/main.cpp", "draft")
    source.setSynced("src/main.cpp", false)
    expect(() => source.closeTab("src/main.cpp")).toThrow("Keep it open")
    await expect(source.commit()).rejects.toThrow("syncing")
    await expect(source.restoreFile("sha", "src/main.cpp")).rejects.toThrow(
      "Commit and sync"
    )
    await expect(
      source.applyExplorerUpdate({
        message: "Delete",
        changes: [{ operation: "delete", path: "src/main.cpp" }],
      })
    ).rejects.toThrow("syncing")
    expect(actions.commitFiles).not.toHaveBeenCalled()
  })
  it("ignores an old read completing after deletion", async () => {
    const { source, actions } = setup()
    const read = deferred<Awaited<ReturnType<typeof actions.readFile>>>()
    actions.readFile.mockReturnValueOnce(read.promise)
    await source.loadPaths()
    await source.applyExplorerUpdate({
      message: "Delete",
      changes: [{ operation: "delete", path: "src/main.cpp" }],
      removed: ["src/main.cpp"],
    })
    read.resolve({
      bytes: new TextEncoder().encode("stale").buffer,
      contentRange: null,
      contentType: "text/plain",
    })
    await Promise.resolve()
    expect(source.getSnapshot().loaded["src/main.cpp"]).toBeUndefined()
    expect(source.getSnapshot().openPaths).toEqual([])
  })
  it("restores clean files and forwards partial-success warnings", async () => {
    const { source, actions } = await opened()
    actions.restoreHistoryFile.mockResolvedValueOnce({
      commitSha: "restore",
      contents: "restored",
      warning: "Reopen the program",
    })
    expect(await source.restoreFile("sha", "src/main.cpp")).toBe(
      "Reopen the program"
    )
    expect(source.getSnapshot().loaded["src/main.cpp"]?.contents).toBe(
      "restored"
    )
    source.setDraft("src/main.cpp", "restored")
    expect(source.getSnapshot().dirtyPaths).toEqual([])
  })
  it("builds pinned committed source while downloads use drafts", async () => {
    const { source, actions } = await opened()
    source.setDraft("src/main.cpp", "draft")
    expect(
      new TextDecoder().decode(await source.readBytes("src/main.cpp"))
    ).toBe("draft")
    const snapshot = await source.prepareSource()
    expect(new TextDecoder().decode(snapshot.files["src/main.cpp"])).toBe(
      "original"
    )
    expect(snapshot.sha).toBe("pinned")
    expect(actions.readFile.mock.calls.at(-1)).toEqual([
      {
        programId: "program",
        path: "src/main.cpp",
        offset: 0,
        ref: "pinned",
        length: 512 * 1024,
      },
    ])
  })
  it("loads language snapshots in parallel with a fixed request bound and one source revision", async () => {
    const { source, actions } = setup()
    const paths = Array.from(
      { length: 20 },
      (_, index) => `include/header-${index}.hpp`
    )
    actions.buildManifest.mockResolvedValue({ sha: "pinned", paths })
    let active = 0,
      peak = 0
    actions.readFile.mockImplementation(async () => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      return {
        bytes: new TextEncoder().encode("header").buffer,
        contentRange: null,
        contentType: "text/plain",
      }
    })
    const snapshot = await source.prepareLanguageSource()
    expect(Object.keys(snapshot.files).sort()).toEqual([...paths].sort())
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(6)
    expect(
      actions.readFile.mock.calls.every(
        (call) => (call as unknown as [{ ref: string }])[0].ref === "pinned"
      )
    ).toBe(true)
  })
})
