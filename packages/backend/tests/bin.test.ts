/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "../convex/schema"
import { api, internal } from "../convex/_generated/api"

const modules = import.meta.glob("../convex/**/*.ts")

async function setup() {
  const t = convexTest(schema, modules)
  const admin = t.withIdentity({ subject: "admin", name: "Ada" })
  const member = t.withIdentity({ subject: "member", name: "Grace" })
  const outsider = t.withIdentity({ subject: "outsider", name: "Linus" })

  const workspaceId = await admin.mutation(api.workspaces.create, {
    name: "Robotics workspace",
  })
  await admin.mutation(api.workspaces.addMember, {
    workspaceId,
    userId: "member",
  })
  await t.run((ctx) =>
    ctx.db.insert("userProfiles", {
      userId: "member",
      email: "member@example.com",
      name: "Grace",
    })
  )

  await t.mutation(internal.binCatalog.seed, {})
  const catalog = await t.run((ctx) => ctx.db.query("binCatalogParts").first())
  if (!catalog) throw new Error("catalog did not seed")

  const partId = await admin.mutation(api.bin.createPart, {
    workspaceId,
    catalogPartId: catalog._id,
  })
  const locationId = await admin.mutation(api.bin.createLocation, {
    workspaceId,
    name: "Cabinet 1",
  })
  return { t, admin, member, outsider, workspaceId, partId, locationId }
}

describe("bin catalog", () => {
  it("seeds once and skips rows that already exist", async () => {
    const t = convexTest(schema, modules)
    const first = await t.mutation(internal.binCatalog.seed, {})
    const second = await t.mutation(internal.binCatalog.seed, {})
    expect(first.inserted).toBeGreaterThan(0)
    expect(second).toEqual({
      inserted: 0,
      renamed: 0,
      deleted: 0,
      partsRenamed: 0,
    })
  })

  it("renames catalog rows and the workspace parts copied from them", async () => {
    const { t, admin, workspaceId, partId } = await setup()
    // Simulate the old name: the row keeps its document, and so does the part.
    const row = await t.run((ctx) =>
      ctx.db
        .query("binCatalogParts")
        .withIndex("by_sku", (q) => q.eq("sku", "275-1004"))
        .unique()
    )
    expect(row).not.toBeNull()
    await t.run(async (ctx) => {
      await ctx.db.patch(row!._id, { name: '#8-32 x 1/2" Screw' })
      await ctx.db.patch(partId, {
        catalogPartId: row!._id,
        name: '#8-32 x 1/2" Screw',
      })
    })

    const result = await t.mutation(internal.binCatalog.seed, {})
    expect(result).toEqual({
      inserted: 0,
      renamed: 1,
      deleted: 0,
      partsRenamed: 1,
    })

    const after = await t.run((ctx) => ctx.db.get(row!._id))
    expect(after?.name).toBe('1/2" Hex Screw')
    const part = await admin.query(api.bin.partDetail, { workspaceId, partId })
    expect(part.part.name).toBe('1/2" Hex Screw')
    // Running it again changes nothing.
    expect(await t.mutation(internal.binCatalog.seed, {})).toEqual({
      inserted: 0,
      renamed: 0,
      deleted: 0,
      partsRenamed: 0,
    })
  })

  it("deletes catalog rows the data no longer lists, unlinking copied parts", async () => {
    const { t, admin, workspaceId, partId } = await setup()
    const stale = await t.run((ctx) =>
      ctx.db.insert("binCatalogParts", {
        sku: "276-0000",
        name: "V5 Power Cable Assortment",
        partType: "Electronics",
        alternateSkus: [],
        retrievedAt: "2026-11-06",
      })
    )
    await t.run((ctx) =>
      ctx.db.patch(partId, {
        catalogPartId: stale,
        name: "V5 Power Cable Assortment",
      })
    )

    const result = await t.mutation(internal.binCatalog.seed, {})
    expect(result.deleted).toBe(1)
    expect(await t.run((ctx) => ctx.db.get(stale))).toBeNull()
    const part = await admin.query(api.bin.partDetail, { workspaceId, partId })
    expect(part.part.name).toBe("V5 Power Cable Assortment")
  })

  it("refuses to add the same catalog part to a workspace twice", async () => {
    const { t, admin, workspaceId } = await setup()
    const catalog = await t.run((ctx) =>
      ctx.db.query("binCatalogParts").first()
    )
    await expect(
      admin.mutation(api.bin.createPart, {
        workspaceId,
        catalogPartId: catalog!._id,
      })
    ).rejects.toThrow("already in inventory")
  })
})

describe("bin stock", () => {
  it("lets admins change stock and records the movement", async () => {
    const { admin, workspaceId, partId, locationId } = await setup()
    await admin.mutation(api.bin.adjustStock, {
      workspaceId,
      partId,
      locationId,
      delta: 5,
      note: "Restocked",
    })
    const detail = await admin.query(api.bin.partDetail, {
      workspaceId,
      partId,
    })
    expect(detail.stock).toEqual([
      expect.objectContaining({ locationName: "Cabinet 1", quantity: 5 }),
    ])
    expect(detail.movements).toEqual([
      expect.objectContaining({ kind: "adjust", delta: 5, note: "Restocked" }),
    ])
  })

  it("sets a count and records only the difference", async () => {
    const { admin, member, workspaceId, partId, locationId } = await setup()
    await admin.mutation(api.bin.setStock, {
      workspaceId,
      partId,
      locationId,
      quantity: 79,
    })
    await admin.mutation(api.bin.setStock, {
      workspaceId,
      partId,
      locationId,
      quantity: 70,
    })
    // Counting the same number again changes nothing and logs nothing.
    await admin.mutation(api.bin.setStock, {
      workspaceId,
      partId,
      locationId,
      quantity: 70,
    })

    const detail = await admin.query(api.bin.partDetail, {
      workspaceId,
      partId,
    })
    expect(detail.stock).toEqual([
      expect.objectContaining({ locationName: "Cabinet 1", quantity: 70 }),
    ])
    expect(detail.movements.map((m) => m.delta)).toEqual([-9, 79])
    await expect(
      member.mutation(api.bin.setStock, {
        workspaceId,
        partId,
        locationId,
        quantity: 5,
      })
    ).rejects.toThrow("Only workspace admins")
  })

  it("stops members from changing stock", async () => {
    const { member, workspaceId, partId, locationId } = await setup()
    await expect(
      member.mutation(api.bin.adjustStock, {
        workspaceId,
        partId,
        locationId,
        delta: 5,
      })
    ).rejects.toThrow("Only workspace admins")
  })

  it("never lets stock go negative", async () => {
    const { admin, workspaceId, partId, locationId } = await setup()
    await expect(
      admin.mutation(api.bin.adjustStock, {
        workspaceId,
        partId,
        locationId,
        delta: -1,
      })
    ).rejects.toThrow("Only 0 on hand")
  })
})

describe("bin sorting", () => {
  it("lists sizes in order, not as text", async () => {
    const { admin, workspaceId } = await setup()
    for (const name of [
      '2" Star Drive Screw',
      '2.5" Star Drive Screw',
      '1.25" Star Drive Screw',
      '1/2" Hex Screw',
      '1/4" Hex Screw',
    ]) {
      await admin.mutation(api.bin.createPart, { workspaceId, name })
    }
    const inventory = await admin.query(api.bin.inventory, { workspaceId })
    // setup() already added one catalog part, so keep only the ones made here.
    const made = inventory.parts
      .map((part) => part.name)
      .filter((name) => name.includes("Screw"))
    expect(made).toEqual([
      '1/4" Hex Screw',
      '1/2" Hex Screw',
      '1.25" Star Drive Screw',
      '2" Star Drive Screw',
      '2.5" Star Drive Screw',
    ])
  })
})

describe("bin loans", () => {
  it("lets members borrow, then return what they took", async () => {
    const { admin, member, workspaceId, partId, locationId } = await setup()
    await admin.mutation(api.bin.adjustStock, {
      workspaceId,
      partId,
      locationId,
      delta: 4,
    })
    const loanId = await member.mutation(api.bin.borrow, {
      workspaceId,
      partId,
      locationId,
      quantity: 3,
    })

    const during = await admin.query(api.bin.inventory, { workspaceId })
    expect(during.parts[0].onHand).toBe(1)
    expect(during.loans).toEqual([
      expect.objectContaining({
        _id: loanId,
        quantity: 3,
        borrowerName: "Grace",
      }),
    ])

    await member.mutation(api.bin.returnLoan, { workspaceId, loanId })
    const after = await admin.query(api.bin.inventory, { workspaceId })
    expect(after.parts[0].onHand).toBe(4)
    expect(after.loans).toEqual([])
  })

  it("refuses to borrow more than is on hand at that location", async () => {
    const { admin, member, workspaceId, partId, locationId } = await setup()
    await admin.mutation(api.bin.adjustStock, {
      workspaceId,
      partId,
      locationId,
      delta: 2,
    })
    await expect(
      member.mutation(api.bin.borrow, {
        workspaceId,
        partId,
        locationId,
        quantity: 3,
      })
    ).rejects.toThrow("Only 2 on hand at Cabinet 1.")
  })

  it("only lets the borrower or an admin return a loan, and only once", async () => {
    const { admin, member, t, workspaceId, partId, locationId } = await setup()
    await admin.mutation(api.bin.adjustStock, {
      workspaceId,
      partId,
      locationId,
      delta: 3,
    })
    await admin.mutation(api.workspaces.addMember, {
      workspaceId,
      userId: "other",
    })
    const loanId = await member.mutation(api.bin.borrow, {
      workspaceId,
      partId,
      locationId,
      quantity: 1,
    })

    const other = t.withIdentity({ subject: "other", name: "Other" })
    await expect(
      other.mutation(api.bin.returnLoan, { workspaceId, loanId })
    ).rejects.toThrow("Only the borrower or an admin")

    await admin.mutation(api.bin.returnLoan, { workspaceId, loanId })
    await expect(
      admin.mutation(api.bin.returnLoan, { workspaceId, loanId })
    ).rejects.toThrow("already been returned")
  })
})

describe("bin locations", () => {
  it("lets admins rename a location and nobody else", async () => {
    const { admin, member, workspaceId, locationId } = await setup()
    await admin.mutation(api.bin.renameLocation, {
      workspaceId,
      locationId,
      name: "  Steel Husky  ",
    })
    const inventory = await admin.query(api.bin.inventory, { workspaceId })
    expect(inventory.locations.map((l) => l.name)).toEqual(["Steel Husky"])

    await expect(
      member.mutation(api.bin.renameLocation, {
        workspaceId,
        locationId,
        name: "Mine now",
      })
    ).rejects.toThrow("Only workspace admins")
    await expect(
      admin.mutation(api.bin.renameLocation, {
        workspaceId,
        locationId,
        name: "   ",
      })
    ).rejects.toThrow("Location name must be")
  })

  it("only deletes a location once it is empty and nothing is out from it", async () => {
    const { admin, member, workspaceId, partId, locationId } = await setup()
    await admin.mutation(api.bin.adjustStock, {
      workspaceId,
      partId,
      locationId,
      delta: 2,
    })
    await expect(
      admin.mutation(api.bin.deleteLocation, { workspaceId, locationId })
    ).rejects.toThrow("still holds 2 pieces")

    // Borrowing everything empties the shelf, but the loan returns here.
    const loanId = await member.mutation(api.bin.borrow, {
      workspaceId,
      partId,
      locationId,
      quantity: 2,
    })
    await expect(
      admin.mutation(api.bin.deleteLocation, { workspaceId, locationId })
    ).rejects.toThrow("1 loan is still out")
    await member.mutation(api.bin.returnLoan, { workspaceId, loanId })

    await admin.mutation(api.bin.setStock, {
      workspaceId,
      partId,
      locationId,
      quantity: 0,
    })
    await expect(
      member.mutation(api.bin.deleteLocation, { workspaceId, locationId })
    ).rejects.toThrow("Only workspace admins")
    await admin.mutation(api.bin.deleteLocation, { workspaceId, locationId })

    const inventory = await admin.query(api.bin.inventory, { workspaceId })
    expect(inventory.locations).toEqual([])
    // History keeps its entries and says where they happened.
    const entries = await admin.query(api.bin.history, { workspaceId })
    expect(entries[0].locationName).toBe("a deleted location")
  })
})

describe("bin part deletion", () => {
  it("deletes a part with nothing on hand, and keeps its history", async () => {
    const { admin, workspaceId, partId, locationId } = await setup()
    await admin.mutation(api.bin.adjustStock, {
      workspaceId,
      partId,
      locationId,
      delta: 2,
    })
    await admin.mutation(api.bin.setStock, {
      workspaceId,
      partId,
      locationId,
      quantity: 0,
    })
    await admin.mutation(api.bin.deletePart, { workspaceId, partId })

    const inventory = await admin.query(api.bin.inventory, { workspaceId })
    expect(inventory.parts.map((p) => p._id)).not.toContain(partId)
    const history = await admin.query(api.bin.history, { workspaceId })
    expect(history.find((entry) => entry.kind === "adjust")?.partName).toBe(
      "a deleted part"
    )
  })

  it("refuses while pieces are on hand or out on loan, and for members", async () => {
    const { admin, member, workspaceId, partId, locationId } = await setup()
    await admin.mutation(api.bin.adjustStock, {
      workspaceId,
      partId,
      locationId,
      delta: 2,
    })
    await expect(
      admin.mutation(api.bin.deletePart, { workspaceId, partId })
    ).rejects.toThrow("still has 2 pieces on hand")
    await expect(
      member.mutation(api.bin.deletePart, { workspaceId, partId })
    ).rejects.toThrow("Only workspace admins")

    const loanId = await member.mutation(api.bin.borrow, {
      workspaceId,
      partId,
      locationId,
      quantity: 2,
    })
    await expect(
      admin.mutation(api.bin.deletePart, { workspaceId, partId })
    ).rejects.toThrow("still out on loan")

    await member.mutation(api.bin.returnLoan, { workspaceId, loanId })
    await admin.mutation(api.bin.setStock, {
      workspaceId,
      partId,
      locationId,
      quantity: 0,
    })
    await admin.mutation(api.bin.deletePart, { workspaceId, partId })
  })
})

describe("bin history", () => {
  it("lists the workspace's changes newest first, with names", async () => {
    const { admin, member, workspaceId, partId, locationId } = await setup()
    await admin.mutation(api.bin.adjustStock, {
      workspaceId,
      partId,
      locationId,
      delta: 4,
      note: "Restocked",
    })
    await member.mutation(api.bin.borrow, {
      workspaceId,
      partId,
      locationId,
      quantity: 1,
    })

    const entries = await admin.query(api.bin.history, { workspaceId })
    expect(entries.map((entry) => [entry.kind, entry.delta])).toEqual([
      ["borrow", -1],
      ["adjust", 4],
    ])
    expect(entries[0]).toEqual(
      expect.objectContaining({ actorName: "Grace", locationName: "Cabinet 1" })
    )
  })
})

describe("bin access", () => {
  it("keeps non-members out of a workspace's inventory", async () => {
    const { outsider, workspaceId } = await setup()
    await expect(
      outsider.query(api.bin.inventory, { workspaceId })
    ).rejects.toThrow("do not have access")
  })
})
