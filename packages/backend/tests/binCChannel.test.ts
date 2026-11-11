import { describe, expect, it } from "vitest"
import {
  allVexSkus,
  cChannelLabel,
  decodeCChannel,
  displayName,
  encodeCChannel,
  variantForVexName,
  vexSkuForVariant,
} from "../convex/lib/binCChannel"
import { binCatalogRows } from "../convex/binCatalogData"

describe("C-channel options", () => {
  it.each([
    ["steel-2x35", { material: "steel", width: 2, length: 35 }],
    ["aluminum-5x1", { material: "aluminum", width: 5, length: 1 }],
  ])("reads %s", (variant, options) => {
    expect(decodeCChannel(variant)).toEqual(options)
    expect(encodeCChannel(options as never)).toBe(variant)
  })

  it.each([
    "steel-4x35", // not a width the catalog sells
    "steel-2x36", // longer than 35
    "steel-2x0",
    "steel-02x35", // not the stored spelling
    "brass-2x35",
    "steel-2x3.5",
    "",
  ])("refuses %j", (variant) => {
    expect(decodeCChannel(variant)).toBeNull()
  })

  it("labels a size the way the part page shows it", () => {
    expect(cChannelLabel("steel-2x35")).toBe("Steel · 2 × 35")
    expect(displayName("C-Channel", "aluminum-5x1")).toBe(
      "C-Channel, Aluminum · 5 × 1"
    )
    expect(displayName("C-Channel", undefined)).toBe("C-Channel")
  })

  it("reads the VEX names the old parts were listed under", () => {
    expect(variantForVexName("1x2x1x35 Steel C-Channel")).toBe("steel-2x35")
    expect(variantForVexName("1x3x1x35 Aluminum C-Channel")).toBe(
      "aluminum-3x35"
    )
    expect(variantForVexName("1x4x1x35 Steel C-Channel")).toBeNull()
    expect(variantForVexName("2x2x2x20 Aluminum U-Channel")).toBeNull()
  })

  it("keeps a model for each VEX size the catalog sells", () => {
    const family = binCatalogRows.find((row) => row.sku === "C-CHANNEL")
    expect(family?.alternateSkus.sort()).toEqual(allVexSkus().sort())
    expect(vexSkuForVariant("steel-2x35")).toBe("276-2906")
    expect(vexSkuForVariant("steel-3x35")).toBeNull()
  })
})
