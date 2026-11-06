// Generates a Cut Part at any length: a channel, an angle, or a square shaft. The
// cross-section and hole rows come from the catalog, which the pipeline verified
// against the STEP file. Nothing here fetches a mesh.
//
// The profile is built in STEP-style axes (X along the length, Y across the web, Z up
// the web) and then converted to the Part frame: Y up, origin at the centre.

import { holePositions } from "./hole-rows"
import type { CutPart, HoleRow, MassRecord, SnapPoint, Vec3 } from "./types"

/** Flat-shaded triangles in the Part frame: 9 floats per triangle, one normal per face. */
export type CutGeometry = {
  positions: Float32Array
  normals: Float32Array
  triangles: number
}

export type GeneratedCutPart = {
  lengthMm: number
  geometry: CutGeometry
  snapPoints: SnapPoint[]
  volumeMm3: number
  mass: MassRecord
}

type Point = readonly [number, number, number]

/** A hole through a plate: its centre and size on the two axes across the plate. */
type Hole = {
  a: number
  b: number
  sizeMm: number
  wall: HoleRow["wall"]
  index: number
}

/**
 * A plate with holes through it. `holeAxis` is the axis the holes run along (2 for a
 * web, 1 for a side). `outward` is the sign of the face that the Part's outside faces,
 * so each hole gets one Snap Point on that face.
 */
type Plate = {
  min: Point
  max: Point
  holeAxis: 1 | 2
  outward: -1 | 1
  holes: Hole[]
}

const EPS = 1e-9
const X = 0
const AXES: Point[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

/** Builds the Cut Part at `lengthMm`. */
export function generateCutPart(
  part: CutPart,
  lengthMm: number
): GeneratedCutPart {
  if (!(lengthMm > 0))
    throw new RangeError("Length must be a positive number of millimetres")
  const plates = buildPlates(part, lengthMm)
  const mesh: Mesh = { positions: [], normals: [] }
  for (const plate of plates) addPlate(mesh, plate)
  return {
    lengthMm,
    geometry: toPartFrame(mesh),
    snapPoints: snapPointsOf(part, plates, lengthMm),
    volumeMm3: cutVolume(part, lengthMm),
    mass: massFor(part, cutVolume(part, lengthMm)),
  }
}

/**
 * Every hole in a Cut Part, before the outside-face choice: its wall, its position
 * along the length, and its position across the wall (STEP axes, centred).
 */
export function cutHoles(
  part: CutPart,
  lengthMm: number
): Array<{ wall: string; x: number; across: number }> {
  return buildPlates(part, lengthMm).flatMap((plate) =>
    plate.holes.map((h) => ({ wall: h.wall, x: h.a, across: h.b }))
  )
}

// ---- The profile -----------------------------------------------------------

function buildPlates(part: CutPart, length: number): Plate[] {
  const half = length / 2
  if (part.family === "channel") {
    const { widthMm: W, depthMm: H, thicknessMm: t, holeMm, rows } = part.cut
    const web: Plate = {
      min: [-half, -W / 2, H / 2 - t],
      max: [half, W / 2, H / 2],
      holeAxis: 2,
      outward: 1,
      holes: holesFor(rows, "web", length, holeMm),
    }
    // The side walls run the full depth. Where a side meets the web the two overlap by a
    // t x t corner, which the real part also has, because its holes reach into it.
    const negativeSide: Plate = {
      min: [-half, -W / 2, -H / 2],
      max: [half, -W / 2 + t, H / 2],
      holeAxis: 1,
      outward: -1,
      holes: holesFor(rows, "side", length, holeMm),
    }
    const positiveSide: Plate = {
      min: [-half, W / 2 - t, -H / 2],
      max: [half, W / 2, H / 2],
      holeAxis: 1,
      outward: 1,
      holes: holesFor(rows, "side", length, holeMm),
    }
    return [web, negativeSide, positiveSide]
  }
  if (part.family === "angle") {
    // Leg A lies along Y at the low Z end, leg B runs up Z at the high Y end. The outer
    // corner is at (+Y, -Z), and leg B starts above leg A so their faces do not coincide.
    const { legMm: S, thicknessMm: t, holeMm, rows } = part.cut
    const h = S / 2
    const legA: Plate = {
      min: [-half, -h, -h],
      max: [half, h, -h + t],
      holeAxis: 2,
      outward: -1,
      holes: holesFor(rows, "web", length, holeMm),
    }
    // Leg B runs the full height, so its holes near the low end lie inside the leg. The
    // corner it shares with leg A overlaps by a t x t square.
    const legB: Plate = {
      min: [-half, h - t, -h],
      max: [half, h, h],
      holeAxis: 1,
      outward: 1,
      holes: holesFor(rows, "side", length, holeMm),
    }
    return [legA, legB]
  }
  // A square shaft is a solid bar with no holes; its faces are plain quads.
  const s = part.cut.sizeMm / 2
  return [
    {
      min: [-half, -s, -s],
      max: [half, s, s],
      holeAxis: 2,
      outward: 1,
      holes: [],
    },
  ]
}

function holesFor(
  rows: HoleRow[],
  wall: HoleRow["wall"],
  length: number,
  sizeMm: number
): Hole[] {
  const holes: Hole[] = []
  for (const row of rows) {
    if (row.wall !== wall) continue
    for (const a of holePositions(row, length)) {
      holes.push({ a, b: row.across, sizeMm, wall, index: holes.length })
    }
  }
  return holes
}

// ---- Triangles -------------------------------------------------------------

type Mesh = { positions: number[]; normals: number[] }

/**
 * Adds one plate. Its two faces normal to the hole axis are split into strips around
 * the holes; the other four faces are plain quads; each hole gets four walls.
 */
function addPlate(mesh: Mesh, plate: Plate) {
  const P = plate.holeAxis
  const A = X
  const B = 3 - P - A
  const at = (a: number, b: number, p: number): Point => {
    const out: [number, number, number] = [0, 0, 0]
    out[A] = a
    out[B] = b
    out[P] = p
    return out
  }
  const [a0, a1] = [plate.min[A], plate.max[A]]
  const [b0, b1] = [plate.min[B], plate.max[B]]
  const [p0, p1] = [plate.min[P], plate.max[P]]

  // The two faces normal to the hole axis are filled by stripFace below, so only the
  // four edge faces are plain quads here.
  quad(
    mesh,
    at(a0, b0, p0),
    at(a0, b0, p1),
    at(a0, b1, p1),
    at(a0, b1, p0),
    neg(A)
  )
  quad(
    mesh,
    at(a1, b0, p0),
    at(a1, b1, p0),
    at(a1, b1, p1),
    at(a1, b0, p1),
    AXES[A]
  )
  quad(
    mesh,
    at(a0, b0, p0),
    at(a1, b0, p0),
    at(a1, b0, p1),
    at(a0, b0, p1),
    neg(B)
  )
  quad(
    mesh,
    at(a0, b1, p0),
    at(a0, b1, p1),
    at(a1, b1, p1),
    at(a1, b1, p0),
    AXES[B]
  )

  for (const [p, normal] of [
    [p0, neg(P)],
    [p1, AXES[P]],
  ] as const) {
    stripFace(mesh, plate, { a0, a1, b0, b1 }, p, normal, at)
  }
  for (const h of plate.holes) holeWalls(mesh, h, A, B, p0, p1, at)
}

/**
 * Fills a rectangle with holes. The rectangle is cut into bands along B, at every
 * hole edge; within each band, the solid parts between holes are quads.
 */
function stripFace(
  mesh: Mesh,
  plate: Plate,
  r: { a0: number; a1: number; b0: number; b1: number },
  p: number,
  normal: Point,
  at: (a: number, b: number, p: number) => Point
) {
  const hb = plate.holes.flatMap((h) => [
    h.b - h.sizeMm / 2,
    h.b + h.sizeMm / 2,
  ])
  const edges = [r.b0, r.b1, ...hb]
    .filter((v) => v >= r.b0 - EPS && v <= r.b1 + EPS)
    .sort((x, y) => x - y)
    .filter((v, i, all) => i === 0 || v - all[i - 1] > EPS)
  for (let j = 0; j < edges.length - 1; j++) {
    const lo = edges[j],
      hi = edges[j + 1],
      mid = (lo + hi) / 2
    const cutting = plate.holes
      .filter((h) => mid > h.b - h.sizeMm / 2 && mid < h.b + h.sizeMm / 2)
      .sort((x, y) => x.a - y.a)
    let cursor = r.a0
    for (const h of cutting) {
      const left = h.a - h.sizeMm / 2,
        right = h.a + h.sizeMm / 2
      if (left - cursor > EPS)
        quad(
          mesh,
          at(cursor, lo, p),
          at(left, lo, p),
          at(left, hi, p),
          at(cursor, hi, p),
          normal
        )
      cursor = right
    }
    if (r.a1 - cursor > EPS)
      quad(
        mesh,
        at(cursor, lo, p),
        at(r.a1, lo, p),
        at(r.a1, hi, p),
        at(cursor, hi, p),
        normal
      )
  }
}

/** The four walls of one rectangular hole through a plate, each facing into the hole. */
function holeWalls(
  mesh: Mesh,
  h: Hole,
  A: number,
  B: number,
  p0: number,
  p1: number,
  at: (a: number, b: number, p: number) => Point
) {
  const aL = h.a - h.sizeMm / 2,
    aR = h.a + h.sizeMm / 2
  const bL = h.b - h.sizeMm / 2,
    bR = h.b + h.sizeMm / 2
  quad(
    mesh,
    at(aL, bL, p0),
    at(aL, bR, p0),
    at(aL, bR, p1),
    at(aL, bL, p1),
    AXES[A]
  )
  quad(
    mesh,
    at(aR, bL, p0),
    at(aR, bL, p1),
    at(aR, bR, p1),
    at(aR, bR, p0),
    neg(A)
  )
  quad(
    mesh,
    at(aL, bL, p0),
    at(aL, bL, p1),
    at(aR, bL, p1),
    at(aR, bL, p0),
    AXES[B]
  )
  quad(
    mesh,
    at(aL, bR, p0),
    at(aR, bR, p0),
    at(aR, bR, p1),
    at(aL, bR, p1),
    neg(B)
  )
}

function neg(axis: number): Point {
  return scale(AXES[axis], -1)
}

function quad(
  mesh: Mesh,
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  normal: Point
) {
  triangle(mesh, a, b, c, normal)
  triangle(mesh, a, c, d, normal)
}

/** Adds one triangle, reversing its winding if needed so it faces `normal`. */
function triangle(mesh: Mesh, p: Point, q: Point, r: Point, normal: Point) {
  const n = cross(sub(q, p), sub(r, p))
  const [second, third] = dot(n, normal) < 0 ? [r, q] : [q, r]
  for (const v of [p, second, third]) {
    mesh.positions.push(v[0], v[1], v[2])
    mesh.normals.push(normal[0], normal[1], normal[2])
  }
}

/** STEP-style (Z up) to Part frame (Y up): (x, y, z) becomes (x, z, -y). */
function toPartFrame(mesh: Mesh): CutGeometry {
  const count = mesh.positions.length / 3
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const p = mesh.positions
  const n = mesh.normals
  for (let i = 0; i < count; i++) {
    positions.set([p[i * 3], p[i * 3 + 2], -p[i * 3 + 1]], i * 3)
    normals.set([n[i * 3], n[i * 3 + 2], -n[i * 3 + 1]], i * 3)
  }
  return { positions, normals, triangles: count / 3 }
}

// ---- Snap Points and mass --------------------------------------------------

/**
 * A channel's or angle's holes, each taking the fit tokens its spec lists. A shaft has no
 * holes: it gets a pin at each end, so it can be set into an opening end first.
 */
function snapPointsOf(
  part: CutPart,
  plates: Plate[],
  lengthMm: number
): SnapPoint[] {
  if (part.family === "shaft") {
    const half = lengthMm / 2
    const size = part.cut.sizeMm
    return [
      {
        id: "pin-start",
        kind: "pin",
        source: "computed",
        position: [-half, 0, 0],
        axis: [-1, 0, 0],
        diameterMm: size,
        role: "end",
      },
      {
        id: "pin-end",
        kind: "pin",
        source: "computed",
        position: [half, 0, 0],
        axis: [1, 0, 0],
        diameterMm: size,
        role: "end",
      },
    ]
  }
  const accepts = part.cut.holeAccepts
  return plates.flatMap((plate) =>
    holeSnaps(plate).map((snap) =>
      accepts ? { ...snap, accepts: [...accepts] } : snap
    )
  )
}

/**
 * Two Snap Points per hole, one at each opening of the through-hole: on the outside face of
 * its wall, and on the inside face. Each points out of the Part, so a screw can come from
 * either side. The inside opening is the one a Part set inside the channel meets.
 */
function holeSnaps(plate: Plate): SnapPoint[] {
  const P = plate.holeAxis
  const A = X
  const B = 3 - P - A
  const thickness = plate.max[P] - plate.min[P]
  const openings = [
    {
      suffix: "",
      sign: plate.outward,
      face: plate.outward < 0 ? plate.min[P] : plate.max[P],
    },
    {
      suffix: "-in",
      sign: -plate.outward,
      face: plate.outward < 0 ? plate.max[P] : plate.min[P],
    },
  ] as const
  return plate.holes.flatMap((h) =>
    openings.map((opening) => {
      const position: [number, number, number] = [0, 0, 0]
      position[A] = h.a
      position[B] = h.b
      position[P] = opening.face
      return {
        id: `hole-${h.wall}-${String(h.index).padStart(3, "0")}${opening.suffix}`,
        kind: "hole" as const,
        source: "computed" as const,
        shape: "square" as const,
        position: partPoint(position),
        axis: partPoint(scale(AXES[P], opening.sign)),
        diameterMm: h.sizeMm,
        depthMm: thickness,
      }
    })
  )
}

function cutVolume(part: CutPart, length: number): number {
  if (part.family === "channel") {
    const { widthMm: W, depthMm: H, thicknessMm: t, holeMm, rows } = part.cut
    const area = W * t + 2 * t * (H - t)
    // The side rows are drilled in both side walls.
    const holes =
      holeCount(
        rows.filter((r) => r.wall === "web"),
        length
      ) +
      2 *
        holeCount(
          rows.filter((r) => r.wall === "side"),
          length
        )
    return area * length - holes * holeMm * holeMm * t
  }
  if (part.family === "angle") {
    const { legMm: S, thicknessMm: t, holeMm, rows } = part.cut
    const area = S * t + t * (S - t)
    return area * length - holeCount(rows, length) * holeMm * holeMm * t
  }
  return part.cut.sizeMm * part.cut.sizeMm * length
}

function holeCount(rows: HoleRow[], length: number): number {
  return rows.reduce((n, row) => n + holePositions(row, length).length, 0)
}

/** Density comes from the material. Electronics and unknown materials are not estimated. */
function massFor(part: CutPart, volumeMm3: number): MassRecord {
  const density =
    part.material === "aluminum" ? 2.7 : part.material === "steel" ? 7.85 : null
  if (density === null)
    return { densityGPerCm3: null, massG: null, basis: "not estimated" }
  return {
    densityGPerCm3: density,
    massG: Math.round((volumeMm3 / 1000) * density * 1000) / 1000,
    basis: "profile area x length x density, holes removed",
  }
}

// ---- Vector helpers --------------------------------------------------------

function partPoint(p: readonly number[]): Vec3 {
  return [p[0], p[2], -p[1]]
}
function sub(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function cross(a: Point, b: Point): Point {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}
function dot(a: Point, b: Point): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function scale(a: Point, s: number): Point {
  return [a[0] * s, a[1] * s, a[2] * s]
}
