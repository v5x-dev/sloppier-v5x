// Checks catalog.json when the app loads it, so a bad entry fails loudly with the Part's
// id instead of rendering a wrong model. Every entry needs an id, a SKU, and either a
// model file (fixed Parts) or a generator spec (Cut Parts).

import type { Catalog, CatalogPart, Material, SnapPoint, Vec3 } from "./types"

const MATERIALS: readonly Material[] = [
  "aluminum",
  "steel",
  "nylon",
  "electronics",
]
const FIXED_FAMILIES = [
  "motor",
  "wheel",
  "standoff",
  "screw",
  "nut",
  "plate",
  "gusset",
  "bearing",
  "collar",
  "spacer",
  "gear",
]
const CUT_FAMILIES = ["channel", "angle", "shaft"]
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/

export type CatalogCheck =
  { ok: true; catalog: Catalog } | { ok: false; errors: string[] }

export function checkCatalog(value: unknown): CatalogCheck {
  const errors: string[] = []
  const root = asRecord(value)
  if (!root) return { ok: false, errors: ["The catalog must be a JSON object"] }
  if (root.schemaVersion !== 1)
    errors.push(`Unsupported schemaVersion ${String(root.schemaVersion)}`)
  if (root.units !== "mm")
    errors.push(`Units must be "mm", not ${String(root.units)}`)
  if (!Array.isArray(root.parts)) errors.push("parts must be an array")
  if (!Array.isArray(root.credits)) errors.push("credits must be an array")

  const seen = new Set<string>()
  for (const [i, raw] of (Array.isArray(root.parts)
    ? root.parts
    : []
  ).entries()) {
    const part = asRecord(raw)
    const where = typeof part?.id === "string" ? part.id : `parts[${i}]`
    if (!part) {
      errors.push(`${where}: not an object`)
      continue
    }
    if (typeof part.id !== "string" || !KEBAB.test(part.id))
      errors.push(`${where}: id must be kebab-case`)
    if (seen.has(where)) errors.push(`${where}: duplicate id`)
    seen.add(where)
    if (typeof part.name !== "string" || part.name === "")
      errors.push(`${where}: missing name`)
    const sku = asRecord(part.sku)
    if (!sku || typeof sku.value !== "string" || sku.value === "")
      errors.push(`${where}: missing SKU`)
    if (!MATERIALS.includes(part.material as Material))
      errors.push(`${where}: unknown material`)
    if (!asRecord(part.source)) errors.push(`${where}: missing source record`)

    if (part.kind === "model") {
      if (!FIXED_FAMILIES.includes(String(part.family)))
        errors.push(`${where}: unknown model family`)
      const model = asRecord(part.model)
      if (!model || typeof model.file !== "string")
        errors.push(`${where}: a model needs model.file`)
      if (!Array.isArray(part.snapPoints))
        errors.push(`${where}: snapPoints must be an array`)
      else
        for (const sp of part.snapPoints) errors.push(...snapErrors(where, sp))
    } else if (part.kind === "cut") {
      if (!CUT_FAMILIES.includes(String(part.family)))
        errors.push(`${where}: unknown cut family`)
      const cut = asRecord(part.cut)
      if (!cut || !Array.isArray(cut.rows))
        errors.push(`${where}: a cut part needs a generator spec with rows`)
    } else {
      errors.push(`${where}: kind must be "model" or "cut"`)
    }
  }
  if (errors.length) return { ok: false, errors }
  return { ok: true, catalog: value as Catalog }
}

/** Throws when the catalog is invalid. The message lists every problem. */
export function parseCatalog(value: unknown): Catalog {
  const result = checkCatalog(value)
  if (!result.ok)
    throw new Error(`Invalid Part catalog:\n${result.errors.join("\n")}`)
  return result.catalog
}

function snapErrors(where: string, value: unknown): string[] {
  const sp = asRecord(value) as Partial<SnapPoint> | null
  if (!sp || typeof sp.id !== "string")
    return [`${where}: a snap point needs an id`]
  const errors: string[] = []
  if (!isVec3(sp.position))
    errors.push(`${where}/${sp.id}: position must be three numbers`)
  if (!isVec3(sp.axis) || Math.abs(Math.hypot(...sp.axis) - 1) > 1e-3)
    errors.push(`${where}/${sp.id}: axis must be a unit vector`)
  if (!(typeof sp.diameterMm === "number" && sp.diameterMm > 0))
    errors.push(`${where}/${sp.id}: diameterMm must be positive`)
  if (
    sp.accepts !== undefined &&
    (!Array.isArray(sp.accepts) ||
      !sp.accepts.every((t) => typeof t === "string"))
  )
    errors.push(`${where}/${sp.id}: accepts must be a list of fit tokens`)
  return errors
}

function isVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export type { CatalogPart }
