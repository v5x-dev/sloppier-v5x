import { ConvexError, v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { mutation, query } from "./_generated/server"
import { requireIdentity, requireWorkspaceMembership } from "./lib/auth"
import { compareNames } from "./lib/binSort"
import { screwColorForName } from "./lib/binScrewColors"

type DbCtx = QueryCtx | MutationCtx

// The bin catalog is global (every workspace reads the same VEX parts).
// Inventory, locations, stock, and loans belong to a workspace and are checked here.

async function requireAdmin(ctx: DbCtx, workspaceId: Id<"workspaces">) {
  const access = await requireWorkspaceMembership(ctx, workspaceId)
  if (access.membership.role !== "admin") {
    throw new ConvexError("Only workspace admins can do that.")
  }
  return access
}

async function getPartInWorkspace(
  ctx: DbCtx,
  workspaceId: Id<"workspaces">,
  partId: Id<"binParts">
) {
  const part = await ctx.db.get(partId)
  if (!part || part.workspaceId !== workspaceId) {
    throw new ConvexError("Part not found in this workspace.")
  }
  return part
}

async function getLocationInWorkspace(
  ctx: DbCtx,
  workspaceId: Id<"workspaces">,
  locationId: Id<"binLocations">
) {
  const location = await ctx.db.get(locationId)
  if (!location || location.workspaceId !== workspaceId) {
    throw new ConvexError("Location not found in this workspace.")
  }
  return location
}

async function getStockRow(
  ctx: DbCtx,
  partId: Id<"binParts">,
  locationId: Id<"binLocations">
) {
  return ctx.db
    .query("binStock")
    .withIndex("by_part_location", (q) =>
      q.eq("partId", partId).eq("locationId", locationId)
    )
    .unique()
}

async function addStock(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  partId: Id<"binParts">,
  locationId: Id<"binLocations">,
  delta: number
) {
  const row = await getStockRow(ctx, partId, locationId)
  const current = row?.quantity ?? 0
  const next = current + delta
  if (next < 0) {
    throw new ConvexError(`Only ${current} on hand at that location.`)
  }
  if (row) {
    await ctx.db.patch(row._id, { quantity: next })
  } else if (next > 0) {
    await ctx.db.insert("binStock", {
      workspaceId,
      partId,
      locationId,
      quantity: next,
    })
  }
  return next
}

async function displayNames(ctx: DbCtx, userIds: string[]) {
  const names = new Map<string, string>()
  for (const userId of new Set(userIds)) {
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique()
    names.set(userId, profile?.name ?? "Teammate")
  }
  return names
}

function validInteger(value: number, min: number, label: string) {
  if (!Number.isInteger(value) || value < min) {
    throw new ConvexError(`${label} must be a whole number of at least ${min}.`)
  }
}

function cleanName(value: string, label: string, max: number) {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new ConvexError(`${label} must be between 1 and ${max} characters.`)
  }
  return trimmed
}

export const catalogSearch = query({
  args: { query: v.string() },
  handler: async (ctx, { query: text }) => {
    await requireIdentity(ctx)
    const needle = text.trim().toLowerCase()
    if (needle.length === 0) return []
    const parts = await ctx.db.query("binCatalogParts").collect()
    return parts
      .filter(
        (part) =>
          part.name.toLowerCase().includes(needle) ||
          part.sku.toLowerCase().includes(needle)
      )
      .slice(0, 40)
  },
})

export const inventory = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    const { identity, membership } = await requireWorkspaceMembership(
      ctx,
      workspaceId
    )
    const [parts, locations, stock, loans] = await Promise.all([
      ctx.db
        .query("binParts")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("binLocations")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("binStock")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("binLoans")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
    ])

    const locationNames = new Map(locations.map((l) => [l._id, l.name]))
    const partNames = new Map(parts.map((p) => [p._id, p.name]))
    const openLoans = loans.filter((loan) => loan.returnedAt === undefined)
    const names = await displayNames(
      ctx,
      openLoans.map((loan) => loan.borrowerId)
    )

    return {
      role: membership.role,
      currentUserId: identity.subject,
      locations: locations
        .map((l) => ({ _id: l._id, name: l.name }))
        .sort((a, b) => compareNames(a.name, b.name)),
      parts: parts
        .map((part) => {
          const partStock = stock.filter(
            (row) => row.partId === part._id && row.quantity > 0
          )
          return {
            _id: part._id,
            name: part.name,
            sku: part.sku ?? null,
            partType: part.partType,
            minQuantity: part.minQuantity ?? null,
            screwColor: screwColorForName(part.name),
            onHand: partStock.reduce((sum, row) => sum + row.quantity, 0),
            stock: partStock.map((row) => ({
              locationId: row.locationId,
              locationName:
                locationNames.get(row.locationId) ?? "a deleted location",
              quantity: row.quantity,
            })),
          }
        })
        .sort((a, b) => compareNames(a.name, b.name)),
      loans: openLoans
        .map((loan) => ({
          _id: loan._id,
          partId: loan.partId,
          partName: partNames.get(loan.partId) ?? "a deleted part",
          locationId: loan.locationId,
          locationName:
            locationNames.get(loan.locationId) ?? "a deleted location",
          quantity: loan.quantity,
          borrowerId: loan.borrowerId,
          borrowerName: names.get(loan.borrowerId) ?? "Teammate",
          borrowedAt: loan.borrowedAt,
        }))
        .sort((a, b) => b.borrowedAt - a.borrowedAt),
    }
  },
})

export const partDetail = query({
  args: { workspaceId: v.id("workspaces"), partId: v.id("binParts") },
  handler: async (ctx, { workspaceId, partId }) => {
    const { identity, membership } = await requireWorkspaceMembership(
      ctx,
      workspaceId
    )
    const part = await getPartInWorkspace(ctx, workspaceId, partId)
    const [stock, loans, movements, locations] = await Promise.all([
      ctx.db
        .query("binStock")
        .withIndex("by_part_location", (q) => q.eq("partId", partId))
        .collect(),
      ctx.db
        .query("binLoans")
        .withIndex("by_part", (q) => q.eq("partId", partId))
        .collect(),
      ctx.db
        .query("binMovements")
        .withIndex("by_part", (q) => q.eq("partId", partId))
        .collect(),
      ctx.db
        .query("binLocations")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
    ])
    const locationNames = new Map(locations.map((l) => [l._id, l.name]))
    const openLoans = loans.filter((loan) => loan.returnedAt === undefined)
    const recent = movements
      .sort(
        (a, b) => b.createdAt - a.createdAt || b._creationTime - a._creationTime
      )
      .slice(0, 50)
    const names = await displayNames(ctx, [
      ...openLoans.map((loan) => loan.borrowerId),
      ...recent.map((movement) => movement.actorId),
    ])

    return {
      role: membership.role,
      currentUserId: identity.subject,
      part: {
        _id: part._id,
        name: part.name,
        sku: part.sku ?? null,
        partType: part.partType,
        minQuantity: part.minQuantity ?? null,
        screwColor: screwColorForName(part.name),
      },
      locations: locations
        .map((l) => ({ _id: l._id, name: l.name }))
        .sort((a, b) => compareNames(a.name, b.name)),
      stock: stock
        .filter((row) => row.quantity > 0)
        .map((row) => ({
          locationId: row.locationId,
          locationName:
            locationNames.get(row.locationId) ?? "a deleted location",
          quantity: row.quantity,
        })),
      loans: openLoans.map((loan) => ({
        _id: loan._id,
        locationId: loan.locationId,
        locationName:
          locationNames.get(loan.locationId) ?? "a deleted location",
        quantity: loan.quantity,
        borrowerId: loan.borrowerId,
        borrowerName: names.get(loan.borrowerId) ?? "Teammate",
        borrowedAt: loan.borrowedAt,
      })),
      movements: recent.map((movement) => ({
        _id: movement._id,
        kind: movement.kind,
        delta: movement.delta,
        locationName:
          locationNames.get(movement.locationId) ?? "a deleted location",
        actorName: names.get(movement.actorId) ?? "Teammate",
        note: movement.note ?? null,
        createdAt: movement.createdAt,
      })),
    }
  },
})

export const createPart = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    catalogPartId: v.optional(v.id("binCatalogParts")),
    name: v.optional(v.string()),
    partType: v.optional(v.string()),
    minQuantity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireAdmin(ctx, args.workspaceId)
    if (args.minQuantity !== undefined) {
      validInteger(args.minQuantity, 0, "Minimum quantity")
    }

    let name: string
    let partType: string
    let sku: string | undefined
    if (args.catalogPartId !== undefined) {
      const catalog = await ctx.db.get(args.catalogPartId)
      if (!catalog) throw new ConvexError("That VEX part does not exist.")
      const existing = await ctx.db
        .query("binParts")
        .withIndex("by_workspace_catalog_part", (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("catalogPartId", args.catalogPartId)
        )
        .unique()
      if (existing) throw new ConvexError("That part is already in inventory.")
      name = catalog.name
      partType = catalog.partType
      sku = catalog.sku
    } else {
      name = cleanName(args.name ?? "", "Part name", 120)
      partType = cleanName(args.partType ?? "Other", "Part type", 40)
    }

    return ctx.db.insert("binParts", {
      workspaceId: args.workspaceId,
      catalogPartId: args.catalogPartId,
      name,
      sku,
      partType,
      minQuantity: args.minQuantity,
      createdBy: identity.subject,
      createdAt: Date.now(),
    })
  },
})

// Deletes a part from this workspace (the catalog keeps the VEX part). Only
// parts with nothing on hand and nothing out on loan can go. Their history stays
// and says "a deleted part".
export const deletePart = mutation({
  args: { workspaceId: v.id("workspaces"), partId: v.id("binParts") },
  handler: async (ctx, { workspaceId, partId }) => {
    await requireAdmin(ctx, workspaceId)
    const part = await getPartInWorkspace(ctx, workspaceId, partId)
    const stock = await ctx.db
      .query("binStock")
      .withIndex("by_part_location", (q) => q.eq("partId", partId))
      .collect()
    const onHand = stock.reduce((sum, row) => sum + row.quantity, 0)
    if (onHand > 0) {
      throw new ConvexError(
        `${part.name} still has ${onHand} ${onHand === 1 ? "piece" : "pieces"} on hand. Set the count to 0 before deleting it.`
      )
    }
    const loans = await ctx.db
      .query("binLoans")
      .withIndex("by_part", (q) => q.eq("partId", partId))
      .collect()
    if (loans.some((loan) => loan.returnedAt === undefined)) {
      throw new ConvexError(
        `${part.name} is still out on loan. Return it before deleting it.`
      )
    }
    for (const row of stock) await ctx.db.delete(row._id)
    await ctx.db.delete(partId)
  },
})

export const setMinQuantity = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    partId: v.id("binParts"),
    minQuantity: v.union(v.number(), v.null()),
  },
  handler: async (ctx, { workspaceId, partId, minQuantity }) => {
    await requireAdmin(ctx, workspaceId)
    await getPartInWorkspace(ctx, workspaceId, partId)
    if (minQuantity !== null) validInteger(minQuantity, 0, "Minimum quantity")
    await ctx.db.patch(partId, {
      minQuantity: minQuantity ?? undefined,
    })
  },
})

// A location is one bin. Where it sits is up to the people who use it.
export const createLocation = mutation({
  args: { workspaceId: v.id("workspaces"), name: v.string() },
  handler: async (ctx, { workspaceId, name }) => {
    await requireAdmin(ctx, workspaceId)
    return ctx.db.insert("binLocations", {
      workspaceId,
      name: cleanName(name, "Location name", 80),
      createdAt: Date.now(),
    })
  },
})

export const renameLocation = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    locationId: v.id("binLocations"),
    name: v.string(),
  },
  handler: async (ctx, { workspaceId, locationId, name }) => {
    await requireAdmin(ctx, workspaceId)
    await getLocationInWorkspace(ctx, workspaceId, locationId)
    await ctx.db.patch(locationId, {
      name: cleanName(name, "Location name", 80),
    })
  },
})

// A location can only go once nothing is stored there and nothing is out on
// loan from it (a loan returns its parts to the place they came from).
export const deleteLocation = mutation({
  args: { workspaceId: v.id("workspaces"), locationId: v.id("binLocations") },
  handler: async (ctx, { workspaceId, locationId }) => {
    await requireAdmin(ctx, workspaceId)
    const location = await getLocationInWorkspace(ctx, workspaceId, locationId)

    const stock = (
      await ctx.db
        .query("binStock")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect()
    ).filter((row) => row.locationId === locationId)
    const pieces = stock.reduce((sum, row) => sum + row.quantity, 0)
    if (pieces > 0) {
      throw new ConvexError(
        `${location.name} still holds ${pieces} ${pieces === 1 ? "piece" : "pieces"}. Set those counts to 0 before deleting it.`
      )
    }

    const loans = (
      await ctx.db
        .query("binLoans")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect()
    ).filter(
      (loan) => loan.locationId === locationId && loan.returnedAt === undefined
    )
    if (loans.length > 0) {
      throw new ConvexError(
        `${loans.length} ${loans.length === 1 ? "loan is" : "loans are"} still out from ${location.name}. Parts return to the place they came from, so wait until they are back.`
      )
    }

    for (const row of stock) await ctx.db.delete(row._id)
    await ctx.db.delete(locationId)
  },
})

export const adjustStock = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    partId: v.id("binParts"),
    locationId: v.id("binLocations"),
    delta: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireAdmin(ctx, args.workspaceId)
    await getPartInWorkspace(ctx, args.workspaceId, args.partId)
    await getLocationInWorkspace(ctx, args.workspaceId, args.locationId)
    if (!Number.isInteger(args.delta) || args.delta === 0) {
      throw new ConvexError("Change must be a whole number other than zero.")
    }
    const note = args.note?.trim() || undefined
    if (note !== undefined && note.length > 200) {
      throw new ConvexError("Note must be 200 characters or fewer.")
    }

    const quantity = await addStock(
      ctx,
      args.workspaceId,
      args.partId,
      args.locationId,
      args.delta
    )
    await ctx.db.insert("binMovements", {
      workspaceId: args.workspaceId,
      partId: args.partId,
      locationId: args.locationId,
      kind: "adjust",
      delta: args.delta,
      actorId: identity.subject,
      note,
      createdAt: Date.now(),
    })
    return quantity
  },
})

// Sets the count at one location to what was counted. The server works out the
// difference, so a borrow made a moment earlier is not overwritten.
export const setStock = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    partId: v.id("binParts"),
    locationId: v.id("binLocations"),
    quantity: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireAdmin(ctx, args.workspaceId)
    await getPartInWorkspace(ctx, args.workspaceId, args.partId)
    await getLocationInWorkspace(ctx, args.workspaceId, args.locationId)
    validInteger(args.quantity, 0, "Count")
    const note = args.note?.trim() || undefined
    if (note !== undefined && note.length > 200) {
      throw new ConvexError("Note must be 200 characters or fewer.")
    }

    const row = await getStockRow(ctx, args.partId, args.locationId)
    const delta = args.quantity - (row?.quantity ?? 0)
    if (delta === 0) return args.quantity

    await addStock(ctx, args.workspaceId, args.partId, args.locationId, delta)
    await ctx.db.insert("binMovements", {
      workspaceId: args.workspaceId,
      partId: args.partId,
      locationId: args.locationId,
      kind: "adjust",
      delta,
      actorId: identity.subject,
      note: note ?? "Counted",
      createdAt: Date.now(),
    })
    return args.quantity
  },
})

export const borrow = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    partId: v.id("binParts"),
    locationId: v.id("binLocations"),
    quantity: v.number(),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireWorkspaceMembership(ctx, args.workspaceId)
    await getPartInWorkspace(ctx, args.workspaceId, args.partId)
    const location = await getLocationInWorkspace(
      ctx,
      args.workspaceId,
      args.locationId
    )
    validInteger(args.quantity, 1, "Quantity")

    const row = await getStockRow(ctx, args.partId, args.locationId)
    const onHand = row?.quantity ?? 0
    if (onHand < args.quantity) {
      throw new ConvexError(`Only ${onHand} on hand at ${location.name}.`)
    }
    await addStock(
      ctx,
      args.workspaceId,
      args.partId,
      args.locationId,
      -args.quantity
    )

    const now = Date.now()
    const loanId = await ctx.db.insert("binLoans", {
      workspaceId: args.workspaceId,
      partId: args.partId,
      locationId: args.locationId,
      quantity: args.quantity,
      borrowerId: identity.subject,
      borrowedAt: now,
    })
    await ctx.db.insert("binMovements", {
      workspaceId: args.workspaceId,
      partId: args.partId,
      locationId: args.locationId,
      kind: "borrow",
      delta: -args.quantity,
      actorId: identity.subject,
      createdAt: now,
    })
    return loanId
  },
})

export const returnLoan = mutation({
  args: { workspaceId: v.id("workspaces"), loanId: v.id("binLoans") },
  handler: async (ctx, { workspaceId, loanId }) => {
    const { identity, membership } = await requireWorkspaceMembership(
      ctx,
      workspaceId
    )
    const loan = await ctx.db.get(loanId)
    if (!loan || loan.workspaceId !== workspaceId) {
      throw new ConvexError("Loan not found in this workspace.")
    }
    if (loan.returnedAt !== undefined) {
      throw new ConvexError("That loan has already been returned.")
    }
    if (loan.borrowerId !== identity.subject && membership.role !== "admin") {
      throw new ConvexError("Only the borrower or an admin can return this.")
    }

    const now = Date.now()
    await addStock(
      ctx,
      workspaceId,
      loan.partId,
      loan.locationId,
      loan.quantity
    )
    await ctx.db.patch(loanId, {
      returnedAt: now,
      returnedBy: identity.subject,
    })
    await ctx.db.insert("binMovements", {
      workspaceId,
      partId: loan.partId,
      locationId: loan.locationId,
      kind: "return",
      delta: loan.quantity,
      actorId: identity.subject,
      createdAt: now,
    })
  },
})

// The workspace's most recent stock changes, newest first, for the History screen.
export const history = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    await requireWorkspaceMembership(ctx, workspaceId)
    const [movements, parts, locations] = await Promise.all([
      ctx.db
        .query("binMovements")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("binParts")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("binLocations")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
    ])
    const recent = movements
      .sort(
        (a, b) => b.createdAt - a.createdAt || b._creationTime - a._creationTime
      )
      .slice(0, 100)
    const partNames = new Map(parts.map((p) => [p._id, p.name]))
    const locationNames = new Map(locations.map((l) => [l._id, l.name]))
    const names = await displayNames(
      ctx,
      recent.map((movement) => movement.actorId)
    )
    return recent.map((movement) => ({
      _id: movement._id,
      kind: movement.kind,
      delta: movement.delta,
      partId: movement.partId,
      partName: partNames.get(movement.partId) ?? "a deleted part",
      locationName:
        locationNames.get(movement.locationId) ?? "a deleted location",
      actorName: names.get(movement.actorId) ?? "Teammate",
      note: movement.note ?? null,
      createdAt: movement.createdAt,
    }))
  },
})
