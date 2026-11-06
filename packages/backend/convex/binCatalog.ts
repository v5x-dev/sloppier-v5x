import type { Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { internalMutation } from "./_generated/server"
import { binCatalogRows } from "./binCatalogData"

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
