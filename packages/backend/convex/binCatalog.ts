import type { Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { internalMutation } from "./_generated/server"
import { binCatalogRows } from "./binCatalogData"
import { C_CHANNEL_SKU, variantForVexName } from "./lib/binCChannel"

type CatalogRow = (typeof binCatalogRows)[number]

// Brings the catalog in line with convex/binCatalogData.ts, matching rows by SKU.
// A renamed row keeps its document, and workspace parts copied from it take the
// new name. Rows the data no longer lists are deleted; workspace parts copied
// from them keep their name but stop being linked to the catalog. Safe to run
// again. Run with: npx convex run binCatalog:seed
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const wantedBySku = new Map<string, CatalogRow[]>()
    for (const row of binCatalogRows) {
      wantedBySku.set(row.sku, [...(wantedBySku.get(row.sku) ?? []), row])
    }

    let inserted = 0
    let renamed = 0
    let deleted = 0
    for (const [sku, wanted] of wantedBySku) {
      const existing = await ctx.db
        .query("binCatalogParts")
        .withIndex("by_sku", (q) => q.eq("sku", sku))
        .collect()
      // Rows already named right stay put. The rest are renamed in place, and
      // only then are new rows inserted. Leftover rows are deleted.
      const unmatched = wanted.filter(
        (row) => !existing.some((part) => part.name === row.name)
      )
      const spare = existing.filter(
        (part) => !wanted.some((row) => row.name === part.name)
      )
      for (const row of unmatched) {
        const target = spare.shift()
        const fields = {
          sku: row.sku,
          name: row.name,
          partType: row.partType,
          alternateSkus: [...row.alternateSkus],
          retrievedAt: row.retrievedAt,
        }
        if (target) {
          await ctx.db.patch(target._id, fields)
          renamed++
        } else {
          await ctx.db.insert("binCatalogParts", fields)
          inserted++
        }
      }
      for (const part of spare) {
        await unlinkWorkspaceParts(ctx, part._id)
        await ctx.db.delete(part._id)
        deleted++
      }
    }

    // SKUs the data no longer lists at all.
    const stale = (await ctx.db.query("binCatalogParts").collect()).filter(
      (part) => !wantedBySku.has(part.sku)
    )
    for (const part of stale) {
      await unlinkWorkspaceParts(ctx, part._id)
      await ctx.db.delete(part._id)
      deleted++
    }

    // Workspace parts copied from a catalog row keep the row's name in step.
    const catalogNames = new Map(
      (await ctx.db.query("binCatalogParts").collect()).map((part) => [
        part._id,
        part.name,
      ])
    )
    let partsRenamed = 0
    for (const part of await ctx.db.query("binParts").collect()) {
      if (part.catalogPartId === undefined) continue
      const name = catalogNames.get(part.catalogPartId)
      if (name !== undefined && name !== part.name) {
        await ctx.db.patch(part._id, { name })
        partsRenamed++
      }
    }

    return { inserted, renamed, deleted, partsRenamed }
  },
})

// Workspace parts copied from a catalog row stop pointing at it. They keep their
// name and everything else, so no stock or history is lost.
async function unlinkWorkspaceParts(
  ctx: MutationCtx,
  catalogPartId: Id<"binCatalogParts">
) {
  for (const part of await ctx.db.query("binParts").collect()) {
    if (part.catalogPartId === catalogPartId) {
      await ctx.db.patch(part._id, { catalogPartId: undefined })
    }
  }
}

// Folds the eight VEX C-channel parts that workspaces may hold into the one
// C-Channel part. Each part's stock, loans, and history move to its option set,
// and counts are added together where a size is already in the same bin. The
// part's own low-stock level is not carried over. Safe to run again: once the
// old parts are gone there is nothing left to move. Run after binCatalog:seed,
// with: npx convex run binCatalog:consolidateCChannels
export const consolidateCChannels = internalMutation({
  args: {},
  handler: async (ctx) => {
    const family = await ctx.db
      .query("binCatalogParts")
      .withIndex("by_sku", (q) => q.eq("sku", C_CHANNEL_SKU))
      .unique()
    if (!family) {
      throw new Error("Run binCatalog:seed first, so the C-Channel row exists.")
    }

    const oldParts = (await ctx.db.query("binParts").collect())
      .filter((part) => variantForVexName(part.name) !== null)
      .sort((a, b) => a.createdAt - b.createdAt)

    let folded = 0
    let stockRows = 0
    let loans = 0
    let movements = 0
    for (const old of oldParts) {
      const variant = variantForVexName(old.name)
      if (variant === null) continue
      let target = await ctx.db
        .query("binParts")
        .withIndex("by_workspace_catalog_part", (q) =>
          q.eq("workspaceId", old.workspaceId).eq("catalogPartId", family._id)
        )
        .unique()
      if (!target) {
        const targetId = await ctx.db.insert("binParts", {
          workspaceId: old.workspaceId,
          catalogPartId: family._id,
          name: family.name,
          sku: C_CHANNEL_SKU,
          partType: family.partType,
          createdBy: old.createdBy,
          createdAt: old.createdAt,
        })
        target = await ctx.db.get(targetId)
        if (!target) throw new Error("The C-Channel part did not save.")
      }

      const stock = await ctx.db
        .query("binStock")
        .withIndex("by_part_location_variant", (q) => q.eq("partId", old._id))
        .collect()
      for (const row of stock) {
        const existing = await ctx.db
          .query("binStock")
          .withIndex("by_part_location_variant", (q) =>
            q
              .eq("partId", target._id)
              .eq("locationId", row.locationId)
              .eq("variant", variant)
          )
          .unique()
        if (existing) {
          await ctx.db.patch(existing._id, {
            quantity: existing.quantity + row.quantity,
          })
          await ctx.db.delete(row._id)
        } else {
          await ctx.db.patch(row._id, {
            partId: target._id,
            variant,
          })
        }
        stockRows++
      }

      for (const loan of await ctx.db
        .query("binLoans")
        .withIndex("by_part", (q) => q.eq("partId", old._id))
        .collect()) {
        await ctx.db.patch(loan._id, { partId: target._id, variant })
        loans++
      }
      for (const movement of await ctx.db
        .query("binMovements")
        .withIndex("by_part", (q) => q.eq("partId", old._id))
        .collect()) {
        await ctx.db.patch(movement._id, { partId: target._id, variant })
        movements++
      }
      await ctx.db.delete(old._id)
      folded++
    }

    return { folded, stockRows, loans, movements }
  },
})
