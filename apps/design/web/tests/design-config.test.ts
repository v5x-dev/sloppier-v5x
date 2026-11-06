import { describe, expect, it } from "vitest"
import { catalog, partById } from "../src/catalog/catalog"
import type { CutPart } from "../src/catalog/types"
import { groupKey } from "../src/design/instances"
import { groupCatalog } from "../src/design/catalog-view"
import {
  holesToMm,
  lengthFromInput,
  mmToHoles,
  stockLength,
} from "../src/design/cut-length"
import { canDraw, partShape } from "../src/design/library"
import { readModelsBase } from "../src/design/models-base"

const channel = partById("channel-1x2x1-aluminum") as CutPart
const shaft = partById("shaft-square-1-4") as CutPart

describe("the models base", () => {
  it("accepts an https base and drops a trailing slash", () => {
    expect(readModelsBase("https://models.example/")).toEqual({
      ok: true,
      url: "https://models.example",
    })
  })

  it("allows http only on localhost", () => {
    expect(readModelsBase("http://localhost:8787/models").ok).toBe(true)
    expect(readModelsBase("http://models.example").ok).toBe(false)
  })

  it("says what to set when the base is missing or not a URL", () => {
    const missing = readModelsBase(undefined)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.message).toContain("VITE_DESIGN_MODELS_URL")
    expect(readModelsBase("pub-161649.r2.dev").ok).toBe(false)
  })
})

describe("Cut Part lengths", () => {
  it("measures channels and angles in 0.5 in holes", () => {
    expect(holesToMm(35)).toBe(444.5)
    expect(mmToHoles(444.5)).toBe(35)
  })

  it("starts a channel at its stock length", () => {
    expect(stockLength(channel)).toEqual({ value: 35, unit: "holes" })
  })

  it("starts a shaft at its stock length in millimetres", () => {
    expect(stockLength(shaft)).toEqual({ value: 49.8, unit: "mm" })
  })

  it("rejects a fraction of a hole and a length out of range", () => {
    expect(lengthFromInput(channel, 2.5).ok).toBe(false)
    expect(lengthFromInput(channel, 0).ok).toBe(false)
    expect(lengthFromInput(channel, 10)).toEqual({ ok: true, lengthMm: 127 })
  })

  it("takes a shaft length in millimetres as typed", () => {
    expect(lengthFromInput(shaft, 25.5)).toEqual({ ok: true, lengthMm: 25.5 })
  })
})

describe("Part shapes", () => {
  it("gives a placed channel its Snap Points and centres it on the ground", () => {
    const shape = partShape({ catalogId: channel.id, lengthMm: 444.5 })
    // One Snap Point per hole on each outside face: more than the 157 holes in the STEP web.
    expect(shape.snapPoints.length).toBeGreaterThan(157)
    expect(shape.sizeMm[0]).toBeCloseTo(444.5, 3)
    expect(shape.bounds.lo[1]).toBeCloseTo(-shape.sizeMm[1] / 2, 3)
  })

  it("gives a fixed model its catalog Snap Points and size", () => {
    const screw = partById("screw-6-32-1-4")
    if (screw.kind !== "model") throw new Error("expected a model")
    const shape = partShape({ catalogId: screw.id })
    expect(shape.snapPoints).toBe(screw.snapPoints)
    expect(shape.bounds.lo[1]).toBeCloseTo(-screw.sizeMm.z / 2, 9)
  })

  it("measures a fixed model in the Part frame, where its Snap Points are", () => {
    // A 1/2 in standoff's bore runs along Part Z, so its length is Z and it lies on its side.
    const shape = partShape({ catalogId: "standoff-1-2" })
    expect(shape.sizeMm[2]).toBeCloseTo(12.7, 1)
    expect(shape.sizeMm[1]).toBeLessThan(12)
    expect(Math.abs(shape.snapPoints[0].position[2])).toBeGreaterThan(6)
    expect(Math.abs(shape.snapPoints[0].position[2])).toBeLessThanOrEqual(
      shape.sizeMm[2] / 2
    )
  })

  it("shares one shape per length", () => {
    expect(partShape({ catalogId: channel.id, lengthMm: 127 })).toBe(
      partShape({ catalogId: channel.id, lengthMm: 127 })
    )
    expect(groupKey({ catalogId: channel.id, lengthMm: 127 })).not.toBe(
      groupKey({ catalogId: channel.id })
    )
  })
})

describe("saved Parts this app cannot draw", () => {
  it("rejects an unknown catalog id, a length on a fixed Part, and an impossible length", () => {
    expect(canDraw({ catalogId: channel.id, lengthMm: 444.5 })).toBe(true)
    expect(canDraw({ catalogId: "screw-6-32-1-4" })).toBe(true)
    expect(canDraw({ catalogId: "from-a-newer-catalog" })).toBe(false)
    expect(canDraw({ catalogId: "screw-6-32-1-4", lengthMm: 10 })).toBe(false)
    expect(canDraw({ catalogId: channel.id, lengthMm: 1e9 })).toBe(false)
  })
})

describe("the parts panel's grouping", () => {
  it("lists every Part in its family and filters by name or SKU", () => {
    const all = groupCatalog(catalog.parts, "")
    expect(all.flatMap((g) => g.parts)).toHaveLength(catalog.parts.length)
    const screws = groupCatalog(catalog.parts, "screw 8-32")
    expect(screws.map((g) => g.family)).toEqual(["screw"])
    expect(
      screws[0].parts.every(
        (p) => p.family === "screw" && p.name.includes("8-32")
      )
    ).toBe(true)
    expect(groupCatalog(catalog.parts, "no such part")).toEqual([])
  })

  it("orders categories as the panel shows them, with Field Elements last", () => {
    const categories = groupCatalog(catalog.parts, "").map((g) => g.category)
    const order = ["structure", "motion", "electronics", "pneumatics", "field"]
    const ranks = categories.map((c) => order.indexOf(c))
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    const fields = groupCatalog(catalog.parts, "")
      .filter((g) => g.category === "field")
      .map((g) => g.family)
    expect(fields).toEqual(["push-back"])
  })
})
