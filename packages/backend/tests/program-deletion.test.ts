/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import schema from "../convex/schema"
import { api, internal } from "../convex/_generated/api"
import type { Id } from "../convex/_generated/dataModel"

const modules = import.meta.glob("../convex/**/*.ts")

const store = vi.hoisted(() => ({
  repos: new Set<string>(),
  failNextDelete: false,
}))
vi.mock("@pierre/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pierre/storage")>()
  return {
    ...actual,
    GitStorage: class {
      async findOne({ id }: { id: string }) {
        return store.repos.has(id) ? { id } : null
      }
      async deleteRepo({ id }: { id: string }) {
        if (store.failNextDelete) {
          store.failNextDelete = false
          throw new Error("Code Storage is unavailable")
        }
        store.repos.delete(id)
        return { repoId: id, message: "deleted" }
      }
    },
  }
})

const repositoryId = "programs/test"

async function setup() {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity({ subject: "owner" })
  const outsider = t.withIdentity({ subject: "outsider" })
  const workspaceId = await owner.mutation(api.workspaces.create, {
    name: "Team",
  })
  const programId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("programs", {
      workspaceId,
      name: "Robot",
      template: "pros",
      repositoryId,
      repositoryStatus: "ready",
      createdBy: "owner",
      createdAt: Date.now(),
    })
    for (const path of ["src/main.cpp", "src/a.cpp", "src/b.cpp"]) {
      await ctx.db.insert("files", {
        programId: id,
        path,
        origin: "template",
        createdBy: "owner",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }
    const documentId = await ctx.db.insert("crdtDocuments", {
      programId: id,
      path: "src/main.cpp",
      lastSequence: 4,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    for (let sequence = 1; sequence <= 4; sequence++) {
      await ctx.db.insert("crdtUpdates", {
        programId: id,
        documentId,
        sequence,
        updateId: `update-${sequence}`,
        actorId: "owner",
        bytes: new ArrayBuffer(1),
        storageStatus: "persisted",
        createdAt: Date.now(),
      })
    }
    await ctx.db.insert("programSessions", {
      programId: id,
      sessionId: "session",
      userId: "owner",
      expiresAt: Date.now() + 60_000,
    })
    await ctx.db.insert("presenceSessions", {
      programId: id,
      path: "src/main.cpp",
      userId: "owner",
      sessionId: "session",
      roomToken: "room",
      sessionToken: "token",
      createdAt: Date.now(),
    })
    return id
  })
  store.repos.add(repositoryId)
  return { t, owner, outsider, workspaceId, programId }
}

async function rowCounts(
  t: ReturnType<typeof convexTest>,
  programId: Id<"programs">
) {
  return t.run(async (ctx) => {
    const files = await ctx.db
      .query("files")
      .withIndex("by_program", (q) => q.eq("programId", programId))
      .collect()
    const documents = await ctx.db
      .query("crdtDocuments")
      .withIndex("by_program_path", (q) => q.eq("programId", programId))
      .collect()
    const updates = await ctx.db.query("crdtUpdates").collect()
    const sessions = await ctx.db
      .query("programSessions")
      .withIndex("by_program_session", (q) => q.eq("programId", programId))
      .collect()
    const presence = await ctx.db
      .query("presenceSessions")
      .withIndex("by_file_user_session", (q) => q.eq("programId", programId))
      .collect()
    const program = await ctx.db.get(programId)
    return {
      files: files.length,
      documents: documents.length,
      updates: updates.length,
      sessions: sessions.length,
      presence: presence.length,
      program: program ? 1 : 0,
    }
  })
}

describe("program deletion", () => {
  beforeEach(() => {
    vi.stubEnv("PIERRE_ORG", "test")
    vi.stubEnv("PIERRE_PRIVATE_KEY", "test")
    store.repos.clear()
    store.failNextDelete = false
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("hides the program at the start of the purge and removes its rows in bounded batches", async () => {
    const { t, owner, workspaceId, programId } = await setup()
    expect(
      await owner.query(api.programs.listByWorkspace, { workspaceId })
    ).toHaveLength(1)

    let result = await t.mutation(internal.programs.purgeBatch, {
      programId,
      batchSize: 2,
    })
    expect(result.done).toBe(false)
    expect(
      await owner.query(api.programs.listByWorkspace, { workspaceId })
    ).toHaveLength(0)

    let calls = 1
    while (!result.done) {
      result = await t.mutation(internal.programs.purgeBatch, {
        programId,
        batchSize: 2,
      })
      calls++
    }
    expect(calls).toBeGreaterThan(5)
    expect(await rowCounts(t, programId)).toEqual({
      files: 0,
      documents: 0,
      updates: 0,
      sessions: 0,
      presence: 0,
      program: 0,
    })
  })

  it("deletes the repository and every row through the owner's action", async () => {
    const { t, owner, programId } = await setup()
    await owner.action(api.codeStorage.deleteProgram, { programId })
    expect(store.repos.has(repositoryId)).toBe(false)
    expect(await rowCounts(t, programId)).toEqual({
      files: 0,
      documents: 0,
      updates: 0,
      sessions: 0,
      presence: 0,
      program: 0,
    })
  })

  it("keeps the program and its rows when the repository cannot be deleted, then retries", async () => {
    const { t, owner, workspaceId, programId } = await setup()
    store.failNextDelete = true
    await expect(
      owner.action(api.codeStorage.deleteProgram, { programId })
    ).rejects.toThrow("Code Storage is unavailable")
    expect(store.repos.has(repositoryId)).toBe(true)
    expect(await rowCounts(t, programId)).toMatchObject({
      files: 3,
      documents: 1,
      updates: 4,
      program: 1,
    })
    expect(
      await owner.query(api.programs.listByWorkspace, { workspaceId })
    ).toHaveLength(1)

    await owner.action(api.codeStorage.deleteProgram, { programId })
    expect(store.repos.has(repositoryId)).toBe(false)
    expect((await rowCounts(t, programId)).program).toBe(0)
  })

  it("deletes the Builder machine before removing its row", async () => {
    const { t, owner, programId } = await setup()
    await t.run((ctx) =>
      ctx.db.insert("buildMachines", {
        programId,
        machineId: "machine-1",
        status: "ready",
        logs: "",
        building: false,
      })
    )
    const requests: Array<{ method: string; url: string }> = []
    vi.stubEnv("SMOL_CLOUD_TOKEN", "token")
    vi.stubGlobal("fetch", async (url: string, init?: { method?: string }) => {
      requests.push({ method: init?.method ?? "GET", url: String(url) })
      return new Response(null, { status: 204 })
    })
    await owner.action(api.codeStorage.deleteProgram, { programId })
    expect(requests).toEqual([
      {
        method: "DELETE",
        url: "https://api.smolmachines.com/v1/machines/machine-1",
      },
    ])
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("buildMachines")
          .withIndex("by_program", (q) => q.eq("programId", programId))
          .collect()
      )
    ).toHaveLength(0)
  })

  it("refuses deletion by users outside the program's workspace", async () => {
    const { t, outsider, programId } = await setup()
    await expect(
      outsider.action(api.codeStorage.deleteProgram, { programId })
    ).rejects.toThrow("You do not have access to this program.")
    expect(store.repos.has(repositoryId)).toBe(true)
    expect((await rowCounts(t, programId)).program).toBe(1)
  })
})
