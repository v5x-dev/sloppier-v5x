// The Part catalog. infra/parts/build.mjs writes catalog.json; this file says what that
// JSON means. Every length is in millimetres. Positions and directions use the Part
// frame: Y up, origin at the centre of the Part's bounding box.

export type Vec3 = readonly [number, number, number]

/** "other" is for assemblies of several materials, such as field elements: no density, so no mass. */
export type Material = "aluminum" | "steel" | "nylon" | "electronics" | "other"

/**
 * A fit token says what a fastener is or what an opening takes. `screw:6-32` and `screw:8-32`
 * are screws of that thread; `shaft:1/8` and `shaft:1/4` are square shafts of that side.
 * A hole takes a fastener only when its `accepts` list has the fastener's token.
 */
export type FitToken = string

/** Snap Points are where another Part can line up: a hole's opening, a shank's end, or an axle. */
export type SnapPoint = {
  id: string
  kind: "hole" | "pin" | "axle"
  /**
   * For a fastener's pins: the head end, which is set into an opening head first, or the tip. A shaft's pins are "end": the shaft runs out of the opening it is set into.
   * Absent for every other Snap Point.
   */
  role?: "head" | "tip" | "end"
  /** detected: read from a STEP cylinder. probed: a square opening found by ray probes. lattice: a site on the plate lattice. computed: derived from the Part's size. manual: a hand correction. */
  source: "detected" | "probed" | "lattice" | "computed" | "manual"
  shape?: "square" | "rect"
  position: Vec3
  /** Unit vector along the hole, pointing out of the Part. */
  axis: Vec3
  diameterMm: number
  depthMm?: number
  openingMm?: readonly [number, number]
  /** The fit tokens this opening takes, such as ["screw:8-32", "shaft:1/8"]. Holes and axles only. */
  accepts?: readonly FitToken[]
}

export type Sku = {
  value: string
  /** filename: read from the file name. solidpython4vex-name: matched by name to that catalog. */
  source: "filename" | "solidpython4vex-name"
  note?: string
}

export type SourceRecord = {
  repo: string
  url: string
  commit: string
  path: string
  sha256: string
  declaredUnit: "mm" | "inch" | "m" | "unknown"
}

export type MassRecord = {
  densityGPerCm3: number | null
  massG: number | null
  basis: string
}

export type Size = { x: number; y: number; z: number }

/**
 * The Part panel's top-level groups. Field Elements are kept apart from the parts a
 * robot is built from.
 */
export type Category =
  "structure" | "motion" | "electronics" | "pneumatics" | "field"

/** Fixed-model families. Field Elements use one family per VEX season. */
export type FixedFamily =
  | "motor"
  | "wheel"
  | "standoff"
  | "screw"
  | "nut"
  | "plate"
  | "gusset"
  | "shaft"
  | "bracket"
  | "collar"
  | "spacer"
  | "washer"
  | "bearing"
  | "retainer"
  | "lock-bar"
  | "bumper"
  | "coupler"
  | "insert"
  | "gear"
  | "rack"
  | "sprocket"
  | "chain"
  | "tread"
  | "brain"
  | "battery"
  | "radio"
  | "controller"
  | "sensor"
  | "switch"
  | "expander"
  | "cylinder"
  | "reservoir"
  | "fitting"
  | "valve"
  | "regulator"
  | "gauge"
  | "manifold"
  | "override"
  | "push-back"
  | "high-stakes"
  | "spin-up"

type PartCommon = {
  id: string
  name: string
  /** Null when no source publishes a SKU for this Part. */
  sku: Sku | null
  category: Category
  material: Material
  source: SourceRecord
  notes: string[]
  /** What this Part is as a fastener: a screw's thread, or a shaft's side. Absent for other Parts. */
  fit?: FitToken
}

export type ModelPart = PartCommon & {
  kind: "model"
  family: FixedFamily
  /** Along the STEP file's axes, not the Part frame. See modelSizeInPartFrame. */
  sizeMm: Size
  volumeMm3: number
  mass: MassRecord
  model: {
    /** Path under the model base URL, with a content hash so it can be cached forever. */
    file: string
    sha256: string
    bytes: number
    triangles: number
    rawTriangles: number
    budgetTriangles: number
    maxErrorMm: number
    coordinates: string
  }
  snapPoints: SnapPoint[]
  /** Set when snapPoints is empty: why, and what would fix it. */
  snapGap?: string
}

/**
 * One row of holes in a Cut Part's wall. Holes sit at (k + phase) * pitch along the
 * length, centred on zero, for every whole k that keeps each hole half a pitch from an
 * end. `across` is the hole's position across the wall: Y for a web, Z for a side.
 */
export type HoleRow = {
  wall: "web" | "side"
  across: number
  pitch: number
  phase: number
}

export type ChannelSpec = {
  widthMm: number
  depthMm: number
  thicknessMm: number
  holeMm: number
  rows: HoleRow[]
  /** The fit tokens every hole in this Part takes. */
  holeAccepts?: FitToken[]
}

export type AngleSpec = {
  legMm: number
  thicknessMm: number
  holeMm: number
  rows: HoleRow[]
  holeAccepts?: FitToken[]
}

export type ShaftSpec = {
  sizeMm: number
  cornerRadiusMm: number
  rows: HoleRow[]
}

export type Verification = {
  checked: boolean
  expectedHoles?: number
  probedHoles?: number
  matched?: number
  missing?: number
  extra?: number
}

type CutCommon = PartCommon & {
  kind: "cut"
  sampleSizeMm: Size
  mass: MassRecord
  verification: Verification
}

export type CutPart = CutCommon &
  (
    | { family: "channel"; cut: ChannelSpec }
    | { family: "angle"; cut: AngleSpec }
    | { family: "shaft"; cut: ShaftSpec }
  )

export type CatalogPart = ModelPart | CutPart

export type Catalog = {
  schemaVersion: 1
  generatedBy: string
  units: "mm"
  frame: string
  credits: string[]
  parts: CatalogPart[]
}
