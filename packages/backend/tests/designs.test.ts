/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import schema from "../convex/schema"
import { api, internal } from "../convex/_generated/api"
import type { Id } from "../convex/_generated/dataModel"

const modules = import.meta.glob("../convex/**/*.ts")

async function setup() {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity({ subject: "owner" })
  const outsider = t.withIdentity({ subject: "outsider" })
  const workspaceId = await owner.mutation(api.workspaces.create, {
    name: "Team",
  })
  const designId = await owner.mutation(api.designs.create, {
    workspaceId,
    name: "  Clawbot  ",
  })
  return { t, owner, outsider, workspaceId, designId }
}

type Client = Awaited<ReturnType<typeof setup>>["owner"]

function encode(doc: Y.Doc, key: string, value: string) {
  doc.getMap("parts").set(key, value)
  return Y.encodeStateAsUpdate(doc).slice().buffer as ArrayBuffer
}

async function readAll(client: Client, designId: Id<"designs">) {
  const doc = new Y.Doc()
  let afterSequence = 0
  while (true) {
    const page = await client.query(api.designSync.updatesSince, {
      designId,
      afterSequence,
    })
    for (const update of page.updates) {
      Y.applyUpdate(doc, new Uint8Array(update.bytes))
      afterSequence = update.sequence
    }
    if (!page.hasMore) return doc.getMap("parts").toJSON()
  }
}

describe("design lifecycle", () => {
  it("creates, renames, archives, and restores for workspace members only", async () => {
    const { owner, outsider, workspaceId, designId } = await setup()
    expect((await owner.query(api.designs.get, { designId })).name).toBe(
      "Clawbot"
    )
    for (const name of [undefined, "   "]) {
      const namedId = await owner.mutation(api.designs.create, {
        workspaceId,
        name,
      })
      expect(
        (await owner.query(api.designs.get, { designId: namedId })).name
      ).toMatch(/^\S.*-\d+$/)
    }
    await owner.mutation(api.designs.rename, { designId, name: " Tray bot " })
    await owner.mutation(api.designs.setArchived, { designId, archived: true })
    const archived = await owner.query(api.designs.get, { designId })
    expect(archived.name).toBe("Tray bot")
    expect(archived.archivedAt).toEqual(expect.any(Number))
    await owner.mutation(api.designs.setArchived, { designId, archived: false })
    expect(
      (await owner.query(api.designs.get, { designId })).archivedAt
    ).toBeUndefined()

    await expect(
      owner.mutation(api.designs.rename, { designId, name: "  " })
    ).rejects.toThrow("1–80")
    for (const attempt of [
      outsider.query(api.designs.get, { designId }),
      outsider.query(api.designs.listByWorkspace, { workspaceId }),
      outsider.mutation(api.designs.create, { workspaceId, name: "Mine" }),
      outsider.mutation(api.designs.remove, { designId }),
      outsider.query(api.designSync.updatesSince, {
        designId,
        afterSequence: 0,
      }),
      outsider.mutation(api.designSync.appendUpdate, {
        designId,
        updateId: "update-outsider",
        bytes: encode(new Y.Doc(), "a", "b"),
      }),
    ]) {
      await expect(attempt).rejects.toThrow("do not have access")
    }
  })

  it("hides a deleted Design immediately and removes its rows", async () => {
    vi.useFakeTimers()
    try {
      const { t, owner, workspaceId, designId } = await setup()
      await owner.mutation(api.designSync.appendUpdate, {
        designId,
        updateId: "update-one",
        bytes: encode(new Y.Doc(), "a", "b"),
      })
      await owner.mutation(api.designs.remove, { designId })
      expect(
        await owner.query(api.designs.listByWorkspace, { workspaceId })
      ).toEqual([])
      await expect(owner.query(api.designs.get, { designId })).rejects.toThrow(
        "Design not found"
      )

      await t.finishAllScheduledFunctions(vi.runAllTimers)
      expect(
        await t.run(async (ctx) => ({
          design: await ctx.db.get(designId),
          updates: await ctx.db.query("designUpdates").collect(),
        }))
      ).toEqual({ design: null, updates: [] })
    } finally {
      vi.useRealTimers()
    }
  })

  it("duplicates into an independent Design that accepts edits once copied", async () => {
    vi.useFakeTimers()
    try {
      const { t, owner, designId } = await setup()
      const doc = new Y.Doc()
      // More updates than one copy batch holds.
      for (let i = 0; i < 25; i++) {
        await owner.mutation(api.designSync.appendUpdate, {
          designId,
          updateId: `update-${i}`,
          bytes: encode(doc, `part-${i}`, "c-channel"),
        })
      }
      const copyId = await owner.mutation(api.designs.duplicate, {
        designId,
        name: "Copy",
      })
      await expect(
        owner.mutation(api.designSync.appendUpdate, {
          designId: copyId,
          updateId: "too-early",
          bytes: encode(new Y.Doc(), "a", "b"),
        })
      ).rejects.toThrow("still being copied")

      await t.finishAllScheduledFunctions(vi.runAllTimers)
      expect(Object.keys(await readAll(owner, copyId))).toHaveLength(25)

      await owner.mutation(api.designSync.appendUpdate, {
        designId: copyId,
        updateId: "copy-only",
        bytes: encode(new Y.Doc(), "copy-part", "motor"),
      })
      expect(await readAll(owner, copyId)).toHaveProperty("copy-part")
      expect(await readAll(owner, designId)).not.toHaveProperty("copy-part")
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("design sync", () => {
  it("treats a retried update as a repeat and rejects invalid updates", async () => {
    const { owner, designId } = await setup()
    const bytes = encode(new Y.Doc(), "a", "b")
    const args = { designId, updateId: "update-one", bytes }
    expect(await owner.mutation(api.designSync.appendUpdate, args)).toEqual({
      sequence: 1,
      duplicate: false,
    })
    expect(await owner.mutation(api.designSync.appendUpdate, args)).toEqual({
      sequence: 1,
      duplicate: true,
    })
    await expect(
      owner.mutation(api.designSync.appendUpdate, {
        designId,
        updateId: "update-two",
        bytes: new Uint8Array([255, 255, 255]).buffer,
      })
    ).rejects.toThrow("Invalid Yjs update")
    await expect(
      owner.mutation(api.designSync.appendUpdate, {
        designId,
        updateId: "update-big",
        bytes: new ArrayBuffer(900 * 1024 + 1),
      })
    ).rejects.toThrow("900 KiB")
  })

  it("pages through updates larger than one response", async () => {
    const { owner, designId } = await setup()
    const big = "x".repeat(400 * 1024)
    for (let i = 0; i < 4; i++) {
      await owner.mutation(api.designSync.appendUpdate, {
        designId,
        updateId: `update-${i}`,
        bytes: encode(new Y.Doc(), `part-${i}`, big),
      })
    }
    const first = await owner.query(api.designSync.updatesSince, {
      designId,
      afterSequence: 0,
    })
    expect(first.hasMore).toBe(true)
    expect(Object.keys(await readAll(owner, designId))).toHaveLength(4)
  })

  it("compacts old updates without changing what any client ends up with", async () => {
    const { t, owner, designId } = await setup()
    const doc = new Y.Doc()
    for (let i = 0; i < 10; i++) {
      await owner.mutation(api.designSync.appendUpdate, {
        designId,
        updateId: `update-${i}`,
        bytes: encode(doc, `part-${i % 4}`, `value-${i}`),
      })
    }
    const before = await readAll(owner, designId)
    // This client has only seen the first few updates when compaction runs.
    const midway = await owner.query(api.designSync.updatesSince, {
      designId,
      afterSequence: 0,
    })
    const client = new Y.Doc()
    for (const update of midway.updates.slice(0, 3)) {
      Y.applyUpdate(client, new Uint8Array(update.bytes))
    }

    await t.mutation(internal.designSync.compact, { designId })

    const rows = await t.run((ctx) => ctx.db.query("designUpdates").collect())
    expect(rows.map((row) => row.sequence)).toEqual([10])
    expect(await readAll(owner, designId)).toEqual(before)

    const rest = await owner.query(api.designSync.updatesSince, {
      designId,
      afterSequence: 3,
    })
    for (const update of rest.updates) {
      Y.applyUpdate(client, new Uint8Array(update.bytes))
    }
    expect(client.getMap("parts").toJSON()).toEqual(before)

    // New sequences continue after the merged row.
    expect(
      await owner.mutation(api.designSync.appendUpdate, {
        designId,
        updateId: "update-after",
        bytes: encode(doc, "after", "x"),
      })
    ).toMatchObject({ sequence: 11 })
  })

  it("moves past rows too large to merge so later updates still compact", async () => {
    const { t, owner, designId } = await setup()
    const doc = new Y.Doc()
    await owner.mutation(api.designSync.appendUpdate, {
      designId,
      updateId: "update-big",
      bytes: encode(doc, "big", "x".repeat(600 * 1024)),
    })
    const small = new Y.Doc()
    for (let i = 0; i < 3; i++) {
      await owner.mutation(api.designSync.appendUpdate, {
        designId,
        updateId: `update-${i}`,
        bytes: encode(small, `part-${i}`, "y"),
      })
    }
    await t.mutation(internal.designSync.compact, { designId })
    const rows = await t.run((ctx) => ctx.db.query("designUpdates").collect())
    expect(rows.map((row) => row.sequence)).toEqual([1, 4])
    expect(Object.keys(await readAll(owner, designId))).toEqual(
      expect.arrayContaining(["big", "part-0", "part-1", "part-2"])
    )
  })
})
