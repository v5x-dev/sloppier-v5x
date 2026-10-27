/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import schema from "../convex/schema"
import { api, internal } from "../convex/_generated/api"

const modules = import.meta.glob("../convex/**/*.ts")
const repo = vi.hoisted(() => ({
  listBranches: vi.fn(async () => ({
    branches: [{ name: "main", headSha: "current" }],
  })),
  listFiles: vi.fn(
    async (): Promise<{
      paths: string[]
      hasMore: boolean
      nextCursor?: string
    }> => ({
      paths: ["src/main.cpp", "restored.bin", ".v5x/old.bin"],
      hasMore: false,
    })
  ),
  restoreCommit: vi.fn(async () => ({ commitSha: "restored" })),
}))
vi.mock("@pierre/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@pierre/storage")>()),
  GitStorage: class {
    repo() {
      return repo
    }
  },
}))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  vi.useRealTimers()
})

async function setup() {
  vi.useFakeTimers()
  vi.stubEnv("PIERRE_ORG", "test")
  vi.stubEnv("PIERRE_PRIVATE_KEY", "test")
  const t = convexTest(schema, modules)
  const programId = await t.run(async (ctx) => {
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Team",
      ownerId: "alice",
      createdAt: 1,
    })
    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId: "alice",
      role: "admin",
      joinedAt: 1,
    })
    return ctx.db.insert("programs", {
      workspaceId,
      name: "Robot",
      template: "pros",
      repositoryId: "repo",
      repositoryStatus: "ready",
      createdBy: "alice",
      createdAt: 1,
    })
  })
  const user = t.withIdentity({ subject: "alice" })
  await t.mutation(internal.files.applyRepositoryChanges, {
    programId,
    actorId: "alice",
    changes: [
      { operation: "put", path: "src/main.cpp" },
      { operation: "put", path: "new.cpp" },
    ],
  })
  const document = await t.mutation(internal.crdt.initializeDocument, {
    programId,
    path: "src/main.cpp",
    actorId: "alice",
    contents: "newer text",
  })
  return { t, user, programId, document }
}

describe("commit restore", () => {
  it("restores the complete pinned tree and replaces live document identities and file metadata", async () => {
    const { t, user, programId, document } = await setup()
    const sha = "a".repeat(40)
    expect(
      await user.action(api.codeStorage.restoreHistoryCommit, {
        programId,
        sha,
      })
    ).toEqual({ commitSha: "restored" })
    expect(repo.restoreCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        targetBranch: "main",
        targetCommitSha: sha,
        expectedHeadSha: "current",
      })
    )
    expect(repo.listFiles).toHaveBeenCalledWith(
      expect.objectContaining({ ref: sha })
    )
    const stale = new Y.Doc()
    stale.getText("source").insert(0, "post-commit text")
    await expect(
      user.mutation(api.crdt.appendUpdate, {
        programId,
        path: "src/main.cpp",
        documentId: document,
        updateId: "late-old-editor",
        bytes: Y.encodeStateAsUpdate(stale).buffer as ArrayBuffer,
      })
    ).rejects.toThrow("Open the live document before editing.")
    stale.destroy()
    const files = await user.query(api.files.listByProgram, { programId })
    expect(files.map((f) => f.path).sort()).toEqual([
      "restored.bin",
      "src/main.cpp",
    ])
    await t.run(async (ctx) => {
      expect(await ctx.db.query("crdtDocuments").collect()).toEqual([])
      expect((await ctx.db.get(programId))?.repositoryHeadSha).toBe("restored")
    })
  })
  it("lists every page of the selected commit before restoring", async () => {
    const { user, programId } = await setup()
    repo.listFiles.mockResolvedValueOnce({
      paths: ["src/main.cpp"],
      hasMore: true,
      nextCursor: "next",
    })
    repo.listFiles.mockResolvedValueOnce({
      paths: ["restored.bin"],
      hasMore: false,
    })
    await user.action(api.codeStorage.restoreHistoryCommit, {
      programId,
      sha: "a".repeat(40),
    })
    expect(repo.listFiles).toHaveBeenLastCalledWith({
      ref: "a".repeat(40),
      cursor: "next",
      limit: 500,
    })
    expect(
      (await user.query(api.files.listByProgram, { programId }))
        .map((f) => f.path)
        .sort()
    ).toEqual(["restored.bin", "src/main.cpp"])
  })
  it("does not alter live state if the branch changed before restoration", async () => {
    const { user, programId } = await setup()
    repo.restoreCommit.mockRejectedValueOnce(new Error("Branch changed"))
    await expect(
      user.action(api.codeStorage.restoreHistoryCommit, {
        programId,
        sha: "a".repeat(40),
      })
    ).rejects.toThrow("Branch changed")
    expect(
      (await user.query(api.files.listByProgram, { programId }))
        .map((f) => f.path)
        .sort()
    ).toEqual(["new.cpp", "src/main.cpp"])
    expect(
      (
        await user.query(api.crdt.updatesSince, {
          programId,
          path: "src/main.cpp",
          afterSequence: 0,
        })
      ).documentId
    ).toBeTruthy()
  })
  it("rejects nonmembers before calling storage", async () => {
    const { t, programId } = await setup()
    await expect(
      t
        .withIdentity({ subject: "mallory" })
        .action(api.codeStorage.restoreHistoryCommit, {
          programId,
          sha: "a".repeat(40),
        })
    ).rejects.toThrow("You do not have access")
    expect(repo.restoreCommit).not.toHaveBeenCalled()
  })
})
