// What the viewport and the snapping code need to know about a Part: its Snap Points,
// its size, and for a Cut Part, its generated geometry. Fixed models come from the
// catalog. Cut Parts are generated once per (Part, length) and then shared.

import { catalog, partById } from "@/catalog/catalog"
import { generateCutPart, type GeneratedCutPart } from "@/catalog/cut-part"
import type {
  CatalogPart,
  CutPart,
  ModelPart,
  SnapPoint,
  Vec3,
} from "@/catalog/types"
import { groupKey } from "./instances"
import type { PartRef } from "./model"
import type { Bounds } from "./transform"

/** Everything that depends only on the Part and its length, not on where it is. */
export type PartShape = {
  key: string
  catalog: CatalogPart
  lengthMm?: number
  /** Snap Points in the Part frame. */
  snapPoints: readonly SnapPoint[]
  /** Size along each axis, in the Part frame. */
  sizeMm: Vec3
  /** The Part's extent in its own frame. */
  bounds: Bounds
  /** The catalog family, such as "screw" or "channel". */
  family: string
  /** Only for Cut Parts: the generated mesh. Fixed models load their mesh separately. */
  cut?: GeneratedCutPart
}

const shapes = new Map<string, PartShape>()

/** The longest Cut Part the app will generate, well past any stock length. */
const MAX_CUT_MM = 5000

/**
 * Whether this app can draw a saved Part. A Part from a newer catalog, or one with an
 * impossible length, is reported to the user instead of breaking the scene.
 */
export function canDraw(ref: PartRef): boolean {
  const part = catalog.parts.find((entry) => entry.id === ref.catalogId)
  if (!part) return false
  return (
    ref.lengthMm === undefined ||
    (part.kind === "cut" && ref.lengthMm <= MAX_CUT_MM)
  )
}

/** The shape of a placed Part, computed once per (Part, length). */
export function partShape(ref: PartRef): PartShape {
  const key = groupKey(ref)
  const cached = shapes.get(key)
  if (cached) return cached
  const part = partById(ref.catalogId)
  const shape =
    part.kind === "cut"
      ? cutShape(part, ref.lengthMm, key)
      : modelShape(part, key)
  shapes.set(key, shape)
  return shape
}

/**
 * A fixed model's size in the Part frame. The catalog records `sizeMm` along the STEP file's
 * axes, and the Part frame maps STEP (x, y, z) to (x, z, -y), so its height is the STEP z.
 */
export function modelSizeInPartFrame(part: ModelPart): Vec3 {
  return [part.sizeMm.x, part.sizeMm.z, part.sizeMm.y]
}

function modelShape(part: ModelPart, key: string): PartShape {
  const size = modelSizeInPartFrame(part)
  const half = size.map((v) => v / 2) as unknown as Vec3
  return {
    key,
    catalog: part,
    family: part.family,
    snapPoints: part.snapPoints,
    sizeMm: size,
    bounds: { lo: [-half[0], -half[1], -half[2]], hi: half },
  }
}

function cutShape(
  part: CutPart,
  lengthMm: number | undefined,
  key: string
): PartShape {
  const length = lengthMm ?? stockLengthMm(part)
  const cut = generateCutPart(part, length)
  const bounds = boundsOf(cut)
  return {
    key,
    catalog: part,
    family: part.family,
    lengthMm: length,
    snapPoints: cut.snapPoints,
    sizeMm: [
      bounds.hi[0] - bounds.lo[0],
      bounds.hi[1] - bounds.lo[1],
      bounds.hi[2] - bounds.lo[2],
    ],
    bounds,
    cut,
  }
}

/** The length the catalog's sample has: the longest side of its sample size. */
export function stockLengthMm(part: CutPart): number {
  const { x, y, z } = part.sampleSizeMm
  return Math.max(x, y, z)
}

function boundsOf(cut: GeneratedCutPart): Bounds {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity]
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  const p = cut.geometry.positions
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < lo[k]) lo[k] = p[i + k]
      if (p[i + k] > hi[k]) hi[k] = p[i + k]
    }
  return { lo, hi }
}
