// Snapping, as pure functions. A Snap Point on the Part being placed is aligned with one
// on a placed Part: the two sit at the same position, and their axes point at each other
// (anti-parallel), so the openings face one another. Roll turns the Part around that
// shared axis. Kind is not checked: any two Snap Points can line up. Which pairs make a
// Connection is decided in a later change.

import { Quaternion, Vector3 } from "three"
import type { FitToken, SnapPoint, Vec3 } from "@/catalog/types"
import type { Quat } from "./model"

export type Pose = { position: Vec3; rotation: Quat }

/**
 * A Snap Point in the world frame. `axis` is a unit vector pointing out of its Part. `kind`
 * and `accepts` tell a placement which openings a fastener can be set into.
 */
export type WorldSnap = {
  owner: string
  snapId: string
  position: Vector3
  axis: Vector3
  kind?: SnapPoint["kind"]
  accepts?: readonly FitToken[]
}

export function toWorldSnap(
  local: SnapPoint,
  pose: Pose
): { position: Vector3; axis: Vector3 } {
  const q = new Quaternion(...pose.rotation)
  const position = new Vector3(...local.position)
    .applyQuaternion(q)
    .add(new Vector3(...pose.position))
  const axis = new Vector3(...local.axis).applyQuaternion(q).normalize()
  return { position, axis }
}

/**
 * The pose that puts `candidate` so its Snap Point sits on `target`, facing it. `base` is
 * the orientation before aligning. `roll` turns the Part about the shared axis (radians).
 */
export function alignToSnap(
  candidate: SnapPoint,
  target: { position: Vector3; axis: Vector3 },
  base: Quat,
  roll = 0
): Pose {
  const q0 = new Quaternion(...base)
  const from = new Vector3(...candidate.axis).applyQuaternion(q0).normalize()
  // A fastener's end pin goes into an opening, so its body runs into the Part: the pin's
  // axis lines up with the opening's. Other Snap Points face the opening.
  const along = target.axis.clone().normalize()
  const facing =
    candidate.kind === "pin" && candidate.role !== "end"
      ? along
      : along.negate()
  const q1 = new Quaternion().setFromUnitVectors(from, facing).multiply(q0)
  const q2 = new Quaternion().setFromAxisAngle(facing, roll).multiply(q1)
  const offset = new Vector3(...candidate.position).applyQuaternion(q2)
  const position = target.position.clone().sub(offset)
  return {
    position: [position.x, position.y, position.z],
    rotation: [q2.x, q2.y, q2.z, q2.w],
  }
}

/**
 * A placed shaft's line in the world frame. A hole or axle that takes the shaft's fit can
 * slide onto it anywhere along its length, so a line is not a point in the grid.
 */
export type ShaftLine = {
  owner: string
  origin: Vector3
  /** Unit vector along the shaft. */
  direction: Vector3
  fit: string
  lengthMm: number
}

/** Placed Snap Points in a uniform grid, so a query looks at a few cells, not every point. */
export class SnapIndex {
  private readonly cells = new Map<string, WorldSnap[]>()
  private readonly everything: WorldSnap[] = []
  private readonly shafts: ShaftLine[] = []

  constructor(private readonly cellMm: number) {
    if (!(cellMm > 0)) throw new RangeError("Cell size must be positive")
  }

  /** Adds a shaft that other Parts can slide onto. */
  addLine(line: ShaftLine): void {
    this.shafts.push(line)
  }

  /** Every shaft line in the index. */
  lines(): readonly ShaftLine[] {
    return this.shafts
  }

  add(entry: WorldSnap): void {
    this.everything.push(entry)
    const key = this.keyOf(entry.position)
    const cell = this.cells.get(key)
    if (cell) cell.push(entry)
    else this.cells.set(key, [entry])
  }

  /** Every entry in the index. */
  all(): readonly WorldSnap[] {
    return this.everything
  }

  /** Every entry whose cell touches the cube of half-width `radius` around `point`. */
  near(point: Vector3, radius: number): WorldSnap[] {
    const found: WorldSnap[] = []
    const lo = this.cellOf(point.clone().subScalar(radius))
    const hi = this.cellOf(point.clone().addScalar(radius))
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          const cell = this.cells.get(`${x},${y},${z}`)
          if (cell) found.push(...cell)
        }
    return found
  }

  private cellOf(p: Vector3): [number, number, number] {
    return [
      Math.floor(p.x / this.cellMm),
      Math.floor(p.y / this.cellMm),
      Math.floor(p.z / this.cellMm),
    ]
  }

  private keyOf(p: Vector3): string {
    return this.cellOf(p).join(",")
  }
}

export type SnapMatch = {
  /** The candidate's Snap Point that matched. */
  candidate: SnapPoint
  target: WorldSnap
  distance: number
  /** The aligned pose for the candidate. */
  pose: Pose
}

/**
 * The nearest pair of Snap Points within `radius`, if any. The candidate's Snap Points are
 * taken where the Part would sit at `pose` without snapping. Nothing is refused for where the
 * aligned Part lands: the ground does not limit a snap.
 */
export function findSnap(
  candidates: readonly SnapPoint[],
  pose: Pose,
  index: SnapIndex,
  radius: number,
  roll = 0,
  fit?: FitToken
): SnapMatch | null {
  let best: SnapMatch | undefined
  for (const candidate of candidates) {
    const at = toWorldSnap(candidate, pose).position
    for (const target of index.near(at, radius)) {
      const distance = at.distanceTo(target.position)
      if (distance > radius || (best && distance >= best.distance)) continue
      if (!fitsOpening(target, candidate, fit)) continue
      const aligned = alignToSnap(candidate, target, pose.rotation, roll)
      best = { candidate, target, distance, pose: aligned }
    }
  }
  return best ?? null
}

/**
 * The Snap Point the pointer is over, if any: the placed Snap Point nearest to the pointer's
 * ray, within `radius`, in front of the camera. The candidate's Snap Point that sits closest
 * to it, at the ground pose, is the one that mates. The result is aligned to that pair.
 */
/** How much an opening that faces away from the pointer is set back when ranking targets. */
const FACES_AWAY_RANK_MM = 3

export function findSnapAlongRay(
  candidates: readonly SnapPoint[],
  ray: { origin: Vector3; direction: Vector3 },
  index: SnapIndex,
  radius: number,
  groundPose: Pose,
  roll = 0,
  fit?: FitToken
): SnapMatch | null {
  if (candidates.length === 0) return null
  // Called on every pointer move against every placed Snap Point, so it allocates little.
  const direction = ray.direction.clone().normalize()
  const { x: ox, y: oy, z: oz } = ray.origin
  const reached: { target: WorldSnap; distance: number; rank: number }[] = []
  for (const target of index.all()) {
    const dx = target.position.x - ox
    const dy = target.position.y - oy
    const dz = target.position.z - oz
    const along = dx * direction.x + dy * direction.y + dz * direction.z
    if (along <= 0) continue
    const distance = Math.sqrt(
      Math.max(0, dx * dx + dy * dy + dz * dz - along * along)
    )
    if (distance > radius) continue
    // A through-hole has an opening on each face, and a ray passes both. The opening that
    // faces the pointer ranks first, so a pointer from above takes the top face.
    const facesAway = target.axis.dot(direction) > 0
    reached.push({
      target,
      distance,
      rank: distance + (facesAway ? FACES_AWAY_RANK_MM : 0),
    })
  }
  reached.sort((a, b) => a.rank - b.rank)
  for (const { target, distance } of reached) {
    let candidate: SnapPoint | undefined
    let nearest = Infinity
    for (const c of candidates) {
      if (!fitsOpening(target, c, fit)) continue
      const at = toWorldSnap(c, groundPose).position.distanceTo(target.position)
      if (at < nearest) {
        nearest = at
        candidate = c
      }
    }
    if (!candidate) continue
    const pose = alignToSnap(candidate, target, groundPose.rotation, roll)
    return { candidate, target, distance, pose }
  }
  return null
}

/**
 * Whether a candidate Snap Point can be set into this target. A fastener's pin only goes
 * into an opening that takes its fit, such as a shaft into a socket, or a screw into a hole
 * it threads. Other pairs are not limited by fit.
 */
function fitsOpening(
  target: WorldSnap,
  candidate: SnapPoint,
  fit: FitToken | undefined
): boolean {
  if (candidate.kind !== "pin" || fit === undefined) return true
  return target.kind === "hole" && (target.accepts?.includes(fit) ?? false)
}

/**
 * The point on a shaft's line that a pointer ray passes nearest to, if the ray gets within
 * `radius` of the shaft's length. A candidate hole or axle that takes the shaft's fit is
 * placed on that point, facing along the shaft, so a Part can slide on anywhere along it.
 */
export function findLineSnapAlongRay(
  candidates: readonly SnapPoint[],
  ray: { origin: Vector3; direction: Vector3 },
  lines: readonly ShaftLine[],
  radius: number,
  groundPose: Pose,
  roll = 0
): SnapMatch | null {
  const direction = ray.direction.clone().normalize()
  let best: SnapMatch | null = null
  for (const line of lines) {
    const takers = candidates.filter(
      (c) =>
        (c.kind === "hole" || c.kind === "axle") &&
        (c.accepts?.includes(line.fit) ?? false)
    )
    if (takers.length === 0) continue
    const on = nearestOnLine(ray.origin, direction, line)
    if (!on) continue
    const q = line.origin.clone().addScaledVector(line.direction, on.along)
    const reach = q.clone().sub(ray.origin)
    const ahead = reach.dot(direction)
    if (ahead <= 0) continue
    const distance = reach.clone().addScaledVector(direction, -ahead).length()
    if (distance > radius) continue
    if (best && distance >= best.distance) continue
    // The candidate taker nearest the line point decides which opening meets it.
    let candidate = takers[0]
    let nearest = Infinity
    for (const c of takers) {
      const at = toWorldSnap(c, groundPose).position.distanceTo(q)
      if (at < nearest) {
        nearest = at
        candidate = c
      }
    }
    // Face the shaft on the side the candidate already faces, so it does not flip over.
    const facing =
      toWorldSnap(candidate, groundPose).axis.dot(line.direction) >= 0 ? 1 : -1
    const target: WorldSnap = {
      owner: line.owner,
      snapId: "shaft-line",
      position: q,
      axis: line.direction.clone().multiplyScalar(-facing),
    }
    const pose = alignToSnap(candidate, target, groundPose.rotation, roll)
    best = { candidate, target, distance, pose }
  }
  return best
}

/** Where a ray passes nearest to a shaft's infinite line, clamped to the shaft's length. */
function nearestOnLine(
  origin: Vector3,
  direction: Vector3,
  line: ShaftLine
): { along: number } | null {
  const u = line.direction
  const w0 = origin.clone().sub(line.origin)
  const a = 1
  const b = direction.dot(u)
  const c = 1
  const d = direction.dot(w0)
  const e = u.dot(w0)
  const denom = a * c - b * b
  // A ray parallel to the shaft cannot pick out one point along it.
  if (Math.abs(denom) < 1e-9) return null
  const t = (a * e - b * d) / denom
  const half = line.lengthMm / 2
  return { along: Math.max(-half, Math.min(half, t)) }
}
