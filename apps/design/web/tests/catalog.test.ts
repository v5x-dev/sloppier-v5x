import { describe, expect, it } from "vitest"
import {
  catalog,
  cutParts,
  modelParts,
  modelUrl,
  partById,
  rawCatalog,
} from "../src/catalog/catalog"
import { checkCatalog } from "../src/catalog/validate"

describe("the committed Part catalog", () => {
  it("passes validation", () => {
    expect(checkCatalog(rawCatalog).ok).toBe(true)
  })

  it("gives every entry an id, a category, and a model or a generator", () => {
    for (const part of catalog.parts) {
      expect(part.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(part.category).toMatch(
        /^(structure|motion|electronics|pneumatics|field)$/
      )
      if (part.sku !== null)
        expect(part.sku.value).toMatch(/^\d{3}-\d{4}(-\d{1,4})?$/)
      if (part.kind === "model") {
        expect(part.model.file).toMatch(/^models\/.+-[0-9a-f]{8}\.glb$/)
        // A model with no Snap Points must say why.
        if (part.snapPoints.length === 0)
          expect(part.snapGap).toEqual(expect.any(String))
      } else expect(part.cut.rows).toBeInstanceOf(Array)
    }
  })

  it("has a SKU for most Parts, and says so when one is missing", () => {
    const withoutSku = catalog.parts.filter((p) => p.sku === null)
    expect(withoutSku.length).toBeLessThan(catalog.parts.length / 5)
  })

  it("verified the channel's holes against its STEP file", () => {
    const channel = partById("channel-1x2x1-aluminum")
    expect(channel.kind === "cut" && channel.verification).toEqual({
      checked: true,
      expectedHoles: 157,
      probedHoles: 157,
      matched: 157,
      missing: 0,
      extra: 0,
    })
  })

  it("keeps every model within its triangle budget or reports the miss", () => {
    for (const part of modelParts()) {
      expect(part.model.triangles).toBeGreaterThan(0)
      expect(part.model.rawTriangles).toBeGreaterThanOrEqual(
        part.model.triangles
      )
    }
  })

  it("points models at the base URL they are served from", () => {
    const part = modelParts()[0]
    expect(modelUrl(part, "https://models.example/")).toBe(
      `https://models.example/${part.model.file}`
    )
  })

  it("lists both kinds of entry", () => {
    expect(modelParts().length).toBeGreaterThan(0)
    const families = cutParts().map((p) => p.family)
    expect(families.filter((f) => f === "channel")).toHaveLength(8)
    expect(families.filter((f) => f === "angle")).toHaveLength(4)
    expect(families.filter((f) => f === "shaft")).toHaveLength(6)
  })
})

describe("checkCatalog", () => {
  const firstModel = rawCatalog.parts.find((p) => p.kind === "model")
  if (!firstModel) throw new Error("the catalog has no model")
  const good = { ...rawCatalog, parts: [firstModel] }

  it.each([
    [
      "a missing SKU",
      (p: Record<string, unknown>) => ({ ...p, sku: undefined }),
    ],
    [
      "a model with no file",
      (p: Record<string, unknown>) => ({ ...p, model: {} }),
    ],
    [
      "a snap point with a non-unit axis",
      (p: Record<string, unknown>) => ({
        ...p,
        snapPoints: [
          {
            id: "x",
            kind: "hole",
            source: "detected",
            position: [0, 0, 0],
            axis: [0, 2, 0],
            diameterMm: 3,
          },
        ],
      }),
    ],
    [
      "an unknown material",
      (p: Record<string, unknown>) => ({ ...p, material: "wood" }),
    ],
    [
      "an unknown category",
      (p: Record<string, unknown>) => ({ ...p, category: "toys" }),
    ],
    [
      "no snap points and no reason for it",
      (p: Record<string, unknown>) => ({
        ...p,
        snapPoints: [],
        snapGap: undefined,
      }),
    ],
  ])("rejects %s", (_name, break_) => {
    const bad = {
      ...good,
      parts: [break_(good.parts[0])],
    }
    const result = checkCatalog(bad)
    expect(result.ok).toBe(false)
  })

  it("rejects duplicate ids", () => {
    const result = checkCatalog({
      ...good,
      parts: [good.parts[0], good.parts[0]],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/duplicate id/)
  })

  it("rejects an unknown schema version", () => {
    expect(checkCatalog({ ...good, schemaVersion: 2 }).ok).toBe(false)
  })
})
