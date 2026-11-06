// The parts panel's view of the catalog: Parts grouped by category, then by family,
// filtered by a search. Field Elements come last, in season order.

import { catalog } from "@/catalog/catalog"
import type { CatalogPart, Category } from "@/catalog/types"

export const CATEGORY_ORDER: readonly Category[] = [
  "structure",
  "motion",
  "electronics",
  "pneumatics",
  "field",
]

export const CATEGORY_LABELS: Record<Category, string> = {
  structure: "Structure",
  motion: "Motion",
  electronics: "Electronics",
  pneumatics: "Pneumatics",
  field: "Field Elements",
}

/** Families in the order the panel shows them within their category. */
export const FAMILY_ORDER = [
  // Structure
  "channel",
  "angle",
  "plate",
  "gusset",
  "standoff",
  "bracket",
  "screw",
  "nut",
  // Motion
  "shaft",
  "collar",
  "spacer",
  "washer",
  "bearing",
  "retainer",
  "lock-bar",
  "bumper",
  "coupler",
  "insert",
  "gear",
  "rack",
  "sprocket",
  "chain",
  "tread",
  "wheel",
  // Electronics
  "motor",
  "brain",
  "battery",
  "radio",
  "controller",
  "sensor",
  "switch",
  "expander",
  // Pneumatics
  "cylinder",
  "reservoir",
  "fitting",
  "valve",
  "regulator",
  "gauge",
  "manifold",
  // Field Elements: Override, Push Back, High Stakes, Spin Up
  "override",
  "push-back",
  "high-stakes",
  "spin-up",
] as const

export const FAMILY_LABELS: Record<string, string> = {
  channel: "C-Channels",
  angle: "Angles",
  plate: "Plates",
  gusset: "Gussets",
  standoff: "Standoffs",
  bracket: "Brackets",
  screw: "Screws",
  nut: "Nuts",
  shaft: "Shafts",
  collar: "Shaft Collars",
  spacer: "Spacers",
  washer: "Washers",
  bearing: "Bearings",
  retainer: "Retainers",
  "lock-bar": "Lock Bars",
  bumper: "Bumpers",
  coupler: "Couplers",
  insert: "Inserts",
  gear: "Gears",
  rack: "Racks",
  sprocket: "Sprockets",
  chain: "Chains",
  tread: "Tank Tread",
  wheel: "Wheels",
  motor: "Motors",
  brain: "Brain",
  battery: "Batteries",
  radio: "Radio",
  controller: "Controller",
  sensor: "Sensors",
  switch: "Switches",
  expander: "Expanders",
  cylinder: "Cylinders",
  reservoir: "Reservoirs",
  fitting: "Fittings",
  valve: "Valves",
  regulator: "Regulators",
  gauge: "Gauges",
  manifold: "Manifolds",
  override: "Override (current season)",
  "push-back": "Push Back",
  "high-stakes": "High Stakes",
  "spin-up": "Spin Up",
}

export type FamilyGroup = {
  category: Category
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
      `${part.name} ${part.sku?.value ?? ""} ${FAMILY_LABELS[part.family] ?? part.family}`.toLowerCase()
    return terms.every((term) => text.includes(term))
  }
  const groups = new Map<string, FamilyGroup>()
  for (const part of parts) {
    if (!matches(part)) continue
    const key = `${part.category}/${part.family}`
    let group = groups.get(key)
    if (!group) {
      group = {
        category: part.category,
        family: part.family,
        label: FAMILY_LABELS[part.family] ?? part.family,
        parts: [],
      }
      groups.set(key, group)
    }
    group.parts.push(part)
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category) -
          CATEGORY_ORDER.indexOf(b.category) ||
        familyRank(a.family) - familyRank(b.family)
    )
    .map((group) => ({
      ...group,
      parts: group.parts.sort((a, b) => a.name.localeCompare(b.name)),
    }))
}

export function familyRank(family: string): number {
  const index = (FAMILY_ORDER as readonly string[]).indexOf(family)
  return index === -1 ? FAMILY_ORDER.length : index
}

/** The name of a catalog entry, or its id if the catalog does not have it. */
export function catalogPartName(id: string): string {
  return catalog.parts.find((part) => part.id === id)?.name ?? id
}
