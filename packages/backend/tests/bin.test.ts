/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "../convex/schema"
import { api, internal } from "../convex/_generated/api"
import { C_CHANNEL_SKU } from "../convex/lib/binCChannel"

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

describe("bin C-channel options", () => {
  // The one C-Channel part, from the catalog row the seed made for it.
  async function addCChannel(
    t: Awaited<ReturnType<typeof setup>>["t"],
    admin: Awaited<ReturnType<typeof setup>>["admin"],
    workspaceId: Awaited<ReturnType<typeof setup>>["workspaceId"]
  ) {
    const row = await t.run((ctx) =>
      ctx.db
        .query("binCatalogParts")
        .withIndex("by_sku", (q) => q.eq("sku", C_CHANNEL_SKU))
        .unique()
    )
    return admin.mutation(api.bin.createPart, {
      workspaceId,
      catalogPartId: row!._id,
    })
  }

  it("counts each size on its own, and sums them for the part", async () => {
    const { t, admin, workspaceId, locationId } = await setup()
    const partId = await addCChannel(t, admin, workspaceId)
    await admin.mutation(api.bin.adjustStock, {
      workspaceId,
      partId,
      locationId,
      variant: "steel-2x35",
      delta: 4,
    })
    await admin.mutation(api.bin.adjustStock, {
      workspaceId,
      partId,
      locationId,
      variant: "aluminum-5x1",
      delta: 2,
    })

    const steel = await admin.query(api.bin.partDetail, {
      workspaceId,
      partId,
      variant: "steel-2x35",
    })
    expect(steel.variantLabel).toBe("Steel · 2 × 35")
    expect(steel.modelSku).toBe("276-2906")
    expect(steel.stock).toEqual([
      expect.objectContaining({ locationName: "Cabinet 1", quantity: 4 }),
    ])
    expect(steel.totalOnHand).toBe(6)

    const aluminum = await admin.query(api.bin.partDetail, {
      workspaceId,
      partId,
      variant: "aluminum-5x1",
    })
    expect(aluminum.stock[0].quantity).toBe(2)
    // No VEX model for this size, so the viewer falls back to the part's SKU,
    // which has none.
    expect(aluminum.modelSku).toBe(C_CHANNEL_SKU)
  })

  it("requires a size for a C-channel and refuses one for other parts", async () => {
    const { t, admin, workspaceId, partId, locationId } = await setup()
    const cChannel = await addCChannel(t, admin, workspaceId)
    await expect(
      admin.mutation(api.bin.adjustStock, {
        workspaceId,
        partId: cChannel,
        locationId,
        delta: 1,
      })
    ).rejects.toThrow("Choose a material, width, and length")
    await expect(
      admin.mutation(api.bin.adjustStock, {
        workspaceId,
        partId: cChannel,
        locationId,
        variant: "steel-2x36",
        delta: 1,
      })
    ).rejects.toThrow("does not exist")
    await expect(
      admin.mutation(api.bin.adjustStock, {
        workspaceId,
        partId,
        locationId,
        variant: "steel-2x35",
        delta: 1,
      })
    ).rejects.toThrow("has no options")
  })

  it("keeps loans and history with the size they were made for", async () => {
    const { t, admin, member, workspaceId, locationId } = await setup()
    const partId = await addCChannel(t, admin, workspaceId)
    await admin.mutation(api.bin.adjustStock, {
      workspaceId,
      partId,
      locationId,
      variant: "steel-2x35",
      delta: 3,
    })
    await member.mutation(api.bin.borrow, {
      workspaceId,
      partId,
      locationId,
      variant: "steel-2x35",
      quantity: 2,
    })

    const otherSize = await admin.query(api.bin.partDetail, {
      workspaceId,
      partId,
      variant: "steel-3x35",
    })
    expect(otherSize.stock).toEqual([])
    expect(otherSize.loans).toEqual([])
    expect(otherSize.movements).toEqual([])

    const inventory = await admin.query(api.bin.inventory, { workspaceId })
    expect(inventory.loans[0].partName).toBe("C-Channel, Steel · 2 × 35")
    const history = await admin.query(api.bin.history, { workspaceId })
    expect(history[0].partName).toBe("C-Channel, Steel · 2 × 35")
  })

  it("folds the old VEX C-channel parts into one C-Channel with their stock", async () => {
    const { t, admin, member, workspaceId, locationId } = await setup()
    const oldSteel = await admin.mutation(api.bin.createPart, {
      workspaceId,
      name: "1x2x1x35 Steel C-Channel",
      partType: "Structure",
    })
    const oldAluminum = await admin.mutation(api.bin.createPart, {
      workspaceId,
      name: "1x5x1x25 Aluminum C-Channel",
      partType: "Structure",
    })
    await admin.mutation(api.bin.adjustStock, {
      workspaceId,
      partId: oldSteel,
      locationId,
      delta: 5,
    })
    await member.mutation(api.bin.borrow, {
      workspaceId,
      partId: oldSteel,
      locationId,
      quantity: 2,
    })
    await admin.mutation(api.bin.adjustStock, {
      workspaceId,
      partId: oldAluminum,
      locationId,
      delta: 1,
    })

    const result = await t.mutation(
      internal.binCatalog.consolidateCChannels,
      {}
    )
    expect(result).toEqual({ folded: 2, stockRows: 2, loans: 1, movements: 3 })

    const inventory = await admin.query(api.bin.inventory, { workspaceId })
    const cChannels = inventory.parts.filter((part) => part.options)
    expect(cChannels).toHaveLength(1)
    expect(cChannels[0].onHand).toBe(4)
    const steel = await admin.query(api.bin.partDetail, {
      workspaceId,
      partId: cChannels[0]._id,
      variant: "steel-2x35",
    })
    expect(steel.stock[0].quantity).toBe(3)
    expect(steel.loans[0].borrowerName).toBe("Grace")
    expect(steel.movements).toHaveLength(2)
    const aluminum = await admin.query(api.bin.partDetail, {
      workspaceId,
      partId: cChannels[0]._id,
      variant: "aluminum-5x25",
    })
    expect(aluminum.stock[0].quantity).toBe(1)

    // Running it again finds nothing left to move.
    const again = await t.mutation(internal.binCatalog.consolidateCChannels, {})
    expect(again).toEqual({ folded: 0, stockRows: 0, loans: 0, movements: 0 })
  })
})
