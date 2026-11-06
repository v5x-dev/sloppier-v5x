// What the viewport and the snapping code need to know about a Part: its Snap Points,
// its size, and for a Cut Part, its generated geometry. Fixed models come from the
// catalog. Cut Parts are generated once per (Part, length) and then shared.

import { catalog, partById } from "@/catalog/catalog"
import { generateCutPart, type GeneratedCutPart } from "@/catalog/cut-part"
import type { CatalogPart, CutPart, SnapPoint, Vec3 } from "@/catalog/types"
import { groupKey } from "./instances"
import type { PartRef } from "./model"

/** Everything that depends only on the Part and its length, not on where it is. */
export type PartShape = {
  key: string
  catalog: CatalogPart
  lengthMm?: number
  /** Snap Points in the Part frame. */
  snapPoints: readonly SnapPoint[]
  /** Size along each axis, in the Part frame. */
  sizeMm: Vec3
  /** Lowest point of the Part in the Part frame. Lifting by -minY puts it on the ground. */
  minY: number
  /** Only for Cut Parts: the generated mesh. Fixed models load their mesh separately. */
  cut?: GeneratedCutPart
}

const shapes = new Map<string, PartShape>()

/** The shape of a placed Part, computed once per (Part, length). */
export function partShape(ref: PartRef): PartShape {
  const key = groupKey(ref)
  const cached = shapes.get(key)
  if (cached) return cached
  const part = partById(ref.catalogId)
  const shape = part.kind === "cut" ? cutShape(part, ref.lengthMm, key) : modelShape(part, key)
  shapes.set(key, shape)
  return shape
}

function modelShape(part: Extract<CatalogPart, { kind: "model" }>, key: string): PartShape {
  return {
    key,
    catalog: part,
    snapPoints: part.snapPoints,
    sizeMm: [part.sizeMm.x, part.sizeMm.y, part.sizeMm.z],
    minY: -part.sizeMm.y / 2,
  }
}

function cutShape(part: CutPart, lengthMm: number | undefined, key: string): PartShape {
  const length = lengthMm ?? stockLengthMm(part)
  const cut = generateCutPart(part, length)
  const minY = lowestY(cut)
  const size = boundsSize(cut)
  return {
    key,
    catalog: part,
    lengthMm: length,
    snapPoints: cut.snapPoints,
    sizeMm: size,
    minY,
    cut,
  }
}

/** The length the catalog's sample has: the longest side of its sample size. */
export function stockLengthMm(part: CutPart): number {
  const { x, y, z } = part.sampleSizeMm
  return Math.max(x, y, z)
}

function lowestY(cut: GeneratedCutPart): number {
  let min = Infinity
  const p = cut.geometry.positions
  for (let i = 1; i < p.length; i += 3) if (p[i] < min) min = p[i]
  return Number.isFinite(min) ? min : 0
}

function boundsSize(cut: GeneratedCutPart): Vec3 {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  const p = cut.geometry.positions
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < lo[k]) lo[k] = p[i + k]
      if (p[i + k] > hi[k]) hi[k] = p[i + k]
    }
  return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]
}

/** Every Part in the catalog, in a stable order for the parts panel. */
export function catalogParts(): CatalogPart[] {
  return catalog.parts.slice()
}
