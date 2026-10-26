/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import * as Y from "yjs"
import schema from "../convex/schema"
import { api, internal } from "../convex/_generated/api"

const modules = import.meta.glob("../convex/**/*.ts")
async function setup() {
  const t = convexTest(schema, modules)
  const projectId = await t.run(async (ctx) => {
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Team",
      ownerId: "alice",
      createdAt: 1,
    })
    for (const userId of ["alice", "bob"])
      await ctx.db.insert("workspaceMembers", {
        workspaceId,
        userId,
        role: "member",
        joinedAt: 1,
      })
    const projectId = await ctx.db.insert("projects", {
      workspaceId,
      name: "Robot",
      template: "pros",
      repositoryId: "repo",
      repositoryStatus: "ready",
      createdBy: "alice",
      createdAt: 1,
    })
    await ctx.db.insert("files", {
      projectId,
      path: "main.cpp",
      origin: "template",
      createdBy: "alice",
      createdAt: 1,
      updatedAt: 1,
    })
    return projectId
  })
  const seed = new Y.Doc()
  seed.getText("source").insert(0, "int main() {}\n")
  const bytes = Y.encodeStateAsUpdate(seed).buffer as ArrayBuffer
  const args = { projectId, path: "main.cpp" }
  return {
    t,
    args,
    seed,
    bytes,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  }
}

describe("live document backend", () => {
  test("concurrent opens seed once, and members replay the same source", async () => {
    const { t, args, bytes, alice, bob } = await setup()
    const ids = await Promise.all(
      ["alice", "bob"].map((actorId) =>
        t.mutation(internal.crdt.initializeDocument, {
          ...args,
          bytes,
          actorId,
        })
      )
    )
    expect(ids[0]).toBe(ids[1])
    const replay = await bob.query(api.crdt.updatesSince, args)
    expect(replay.updates).toHaveLength(1)
    const doc = new Y.Doc()
    Y.applyUpdate(doc, new Uint8Array(replay.updates[0].bytes))
    expect(doc.getText("source").toString()).toBe("int main() {}\n")
    await expect(
      t.withIdentity({ subject: "stranger" }).query(api.crdt.updatesSince, args)
    ).rejects.toThrow("access")
    await expect(t.query(api.crdt.updatesSince, args)).rejects.toThrow(
      "Authentication"
    )
    expect(
      await alice.query(api.crdt.updatesSince, { ...args, afterSequence: 1 })
    ).toMatchObject({ updates: [], hasMore: false })
  })

  test("acknowledgement retries are idempotent, with validation and stale-file protection", async () => {
    const { t, args, bytes, alice, seed } = await setup()
    const documentId = await t.mutation(internal.crdt.initializeDocument, {
      ...args,
      bytes,
      actorId: "alice",
    })
    const vector = Y.encodeStateVector(seed)
    seed.getText("source").insert(0, "// edit\n")
    const update = {
      ...args,
      documentId,
      updateId: "retry-one",
      bytes: Y.encodeStateAsUpdate(seed, vector).buffer as ArrayBuffer,
    }
    expect(await alice.mutation(api.crdt.appendUpdate, update)).toMatchObject({
      sequence: 2,
      duplicate: false,
    })
    expect(await alice.mutation(api.crdt.appendUpdate, update)).toMatchObject({
      sequence: 2,
      duplicate: true,
    })
    await expect(
      alice.mutation(api.crdt.appendUpdate, { ...update, bytes })
    ).rejects.toThrow("different bytes")
    await expect(
      alice.mutation(api.crdt.appendUpdate, {
        ...update,
        updateId: "invalid-update",
        bytes: new Uint8Array([255]).buffer,
      })
    ).rejects.toThrow("Invalid Yjs")
    await t.mutation(internal.files.applyRepositoryChanges, {
      projectId: args.projectId,
      actorId: "alice",
      changes: [
        { operation: "delete", path: args.path },
        { operation: "put", path: args.path },
      ],
    })
    const replacement = await t.mutation(internal.crdt.initializeDocument, {
      ...args,
      bytes,
      actorId: "alice",
    })
    expect(replacement).not.toBe(documentId)
    await expect(alice.mutation(api.crdt.appendUpdate, update)).rejects.toThrow(
      "replaced"
    )
  })

  test("replay crosses the 100-update page boundary without losing changes", async () => {
    const { t, args, bytes, alice, seed } = await setup()
    await t.mutation(internal.crdt.initializeDocument, {
      ...args,
      bytes,
      actorId: "alice",
    })
    for (let n = 0; n < 105; n++) {
      const vector = Y.encodeStateVector(seed)
      seed.getText("source").insert(0, `${n}\n`)
      await alice.mutation(api.crdt.appendUpdate, {
        ...args,
        updateId: `update-${String(n).padStart(4, "0")}`,
        bytes: Y.encodeStateAsUpdate(seed, vector).buffer as ArrayBuffer,
      })
    }
    const replay = new Y.Doc()
    let sequence = 0
    let pages = 0
    while (true) {
      const batch = await alice.query(api.crdt.updatesSince, {
        ...args,
        afterSequence: sequence,
      })
      pages++
      for (const update of batch.updates) {
        Y.applyUpdate(replay, new Uint8Array(update.bytes))
        sequence = update.sequence
      }
      if (!batch.hasMore) break
    }
    expect(pages).toBe(2)
    expect(sequence).toBe(106)
    expect(replay.getText("source").toString()).toBe(
      seed.getText("source").toString()
    )
  })
})

describe("repository backup queue", () => {
  test("concurrent writers share one job and edits arriving during a backup are drained next", async () => {
    const { t, args, bytes, alice, bob, seed } = await setup()
    await t.mutation(internal.crdt.initializeDocument, {
      ...args,
      bytes,
      actorId: "alice",
    })
    const jobs = () => t.run((ctx) => ctx.db.query("crdtBackupJobs").collect())
    const [job] = await jobs()
    const first = await t.query(internal.backups.batch, {
      jobId: job._id,
      generation: 0,
    })
    expect(first?.updates).toHaveLength(1)
    const vector = Y.encodeStateVector(seed)
    seed.getText("source").insert(0, "// concurrent edit\n")
    const edit = Y.encodeStateAsUpdate(seed, vector).buffer as ArrayBuffer
    await Promise.all(
      [alice, bob, alice, bob].map((user, i) =>
        user.mutation(api.crdt.appendUpdate, {
          ...args,
          bytes: edit,
          updateId: `parallel-${i}`,
        })
      )
    )
    expect(await jobs()).toHaveLength(1)
    await t.mutation(internal.backups.complete, {
      jobId: job._id,
      generation: 0,
      updateIds: first!.updates.map((u) => u._id),
      commitSha: "first",
    })
    const second = await t.query(internal.backups.batch, {
      jobId: job._id,
      generation: 1,
    })
    expect(second?.updates).toHaveLength(4)
    await t.mutation(internal.backups.complete, {
      jobId: job._id,
      generation: 1,
      updateIds: second!.updates.map((u) => u._id),
      commitSha: "second",
    })
    expect(await jobs()).toHaveLength(0)
    const rows = await t.run((ctx) => ctx.db.query("crdtUpdates").collect())
    expect(rows.every((r) => r.storageStatus === "persisted")).toBe(true)
  })

  test("transient branch conflicts retry without reporting failed backups, and stale workers cannot acknowledge edits", async () => {
    const { t, args, bytes } = await setup()
    await t.mutation(internal.crdt.initializeDocument, {
      ...args,
      bytes,
      actorId: "alice",
    })
    const [job] = await t.run((ctx) => ctx.db.query("crdtBackupJobs").collect())
    const batch = await t.query(internal.backups.batch, {
      jobId: job._id,
      generation: 0,
    })
    const updateIds = batch!.updates.map((u) => u._id)
    await t.mutation(internal.backups.complete, {
      jobId: job._id,
      generation: 0,
      updateIds,
      error: "base_ref does not match current head",
    })
    expect(
      (await t.run((ctx) => ctx.db.get(updateIds[0])))?.storageStatus
    ).toBe("pending")
    await t.mutation(internal.backups.complete, {
      jobId: job._id,
      generation: 0,
      updateIds,
      commitSha: "stale",
    })
    expect(
      (await t.run((ctx) => ctx.db.get(updateIds[0])))?.storageStatus
    ).toBe("pending")
    await t.mutation(internal.backups.complete, {
      jobId: job._id,
      generation: 1,
      updateIds,
      commitSha: "retry",
    })
    expect(
      (await t.run((ctx) => ctx.db.get(updateIds[0])))?.storageStatus
    ).toBe("persisted")
  })
})
