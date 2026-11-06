// The parts panel's view of the catalog: Parts grouped by family, filtered by a search.

import { catalog } from "@/catalog/catalog"
import type { CatalogPart } from "@/catalog/types"

export const FAMILY_ORDER = [
  "motor",
  "wheel",
  "standoff",
  "screw",
  "nut",
  "spacer",
  "bearing",
  "collar",
  "gear",
  "plate",
  "gusset",
  "channel",
  "angle",
  "shaft",
] as const

export const FAMILY_LABELS: Record<string, string> = {
  motor: "Motors",
  wheel: "Wheels",
  standoff: "Standoffs",
  screw: "Screws",
  nut: "Nuts",
  spacer: "Spacers",
  bearing: "Bearings",
  collar: "Collars",
  gear: "Gears",
  plate: "Plates",
  gusset: "Gussets",
  channel: "Channels",
  angle: "Angles",
  shaft: "Shafts",
}

export type FamilyGroup = {
  family: string
  label: string
  parts: CatalogPart[]
}

export function groupCatalog(
  parts: readonly CatalogPart[],
  query: string
): FamilyGroup[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (part: CatalogPart) => {
    const text =
      `${part.name} ${part.sku.value} ${FAMILY_LABELS[part.family] ?? part.family}`.toLowerCase()
    return terms.every((term) => text.includes(term))
  }
  return FAMILY_ORDER.map((family) => ({
    family,
    label: FAMILY_LABELS[family] ?? family,
    parts: parts.filter((part) => part.family === family && matches(part)),
  })).filter((group) => group.parts.length > 0)
}

/** The name of a catalog entry, or its id if the catalog does not have it. */
export function catalogPartName(id: string): string {
  return catalog.parts.find((part) => part.id === id)?.name ?? id
}
