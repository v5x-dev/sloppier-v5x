// The validated Part catalog, plus the lookups the editor needs. The JSON is generated
// by infra/parts/build.mjs; edit the manifest there, not this file.

import rawCatalog from "./catalog.json"
import { parseCatalog } from "./validate"
import type { CatalogPart, CutPart, ModelPart } from "./types"

/** The JSON as generated, before validation. Tests use it to check the validator itself. */
export { rawCatalog }

export const catalog = parseCatalog(rawCatalog)

const byId = new Map<string, CatalogPart>(
  catalog.parts.map((part) => [part.id, part])
)

export function partById(id: string): CatalogPart {
  const part = byId.get(id)
  if (!part) throw new Error(`No Part with id "${id}" in the catalog`)
  return part
}

export function modelParts(): ModelPart[] {
  return catalog.parts.filter(
    (part): part is ModelPart => part.kind === "model"
  )
}

export function cutParts(): CutPart[] {
  return catalog.parts.filter((part): part is CutPart => part.kind === "cut")
}

/**
 * The URL of a fixed Part's GLB under the model base. The base comes from the stage's
 * configuration, so preview and production stages can point at different buckets.
 */
export function modelUrl(part: ModelPart, base: string): string {
  return `${base.replace(/\/$/, "")}/${part.model.file}`
}
