// Snapping, as pure functions. A Snap Point on the Part being placed is aligned with one
// on a placed Part: the two sit at the same position, and their axes point at each other
// (anti-parallel), so the openings face one another. Roll turns the Part around that
// shared axis. Kind is not checked: any two Snap Points can line up. Which pairs make a
// Connection is decided in a later change.

import { Quaternion, Vector3 } from "three"
import type { SnapPoint, Vec3 } from "@/catalog/types"
import type { Quat } from "./model"

export type Pose = { position: Vec3; rotation: Quat }

/** A Snap Point in the world frame. `axis` is a unit vector pointing out of its Part. */
export type WorldSnap = {
  owner: string
  snapId: string
  position: Vector3
  axis: Vector3
}

export function toWorldSnap(local: SnapPoint, pose: Pose): { position: Vector3; axis: Vector3 } {
  const q = new Quaternion(...pose.rotation)
  const position = new Vector3(...local.position).applyQuaternion(q).add(new Vector3(...pose.position))
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
  const facing = target.axis.clone().normalize().negate()
  const q1 = new Quaternion().setFromUnitVectors(from, facing).multiply(q0)
  const q2 = new Quaternion().setFromAxisAngle(facing, roll).multiply(q1)
  const offset = new Vector3(...candidate.position).applyQuaternion(q2)
  const position = target.position.clone().sub(offset)
  return {
    position: [position.x, position.y, position.z],
    rotation: [q2.x, q2.y, q2.z, q2.w],
  }
}

/** Placed Snap Points in a uniform grid, so a query looks at a few cells, not every point. */
export class SnapIndex {
  private readonly cells = new Map<string, WorldSnap[]>()

  constructor(private readonly cellMm: number) {
    if (!(cellMm > 0)) throw new RangeError("Cell size must be positive")
  }

  add(entry: WorldSnap): void {
    const key = this.keyOf(entry.position)
    const cell = this.cells.get(key)
    if (cell) cell.push(entry)
    else this.cells.set(key, [entry])
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
    return [Math.floor(p.x / this.cellMm), Math.floor(p.y / this.cellMm), Math.floor(p.z / this.cellMm)]
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
 * taken where the Part would sit at `pose` without snapping.
 */
export function findSnap(
  candidates: readonly SnapPoint[],
  pose: Pose,
  index: SnapIndex,
  radius: number,
  roll = 0
): SnapMatch | null {
  let best: { candidate: SnapPoint; target: WorldSnap; distance: number } | undefined
  for (const candidate of candidates) {
    const at = toWorldSnap(candidate, pose).position
    for (const target of index.near(at, radius)) {
      const distance = at.distanceTo(target.position)
      if (distance <= radius && (!best || distance < best.distance)) {
        best = { candidate, target, distance }
      }
    }
  }
  if (!best) return null
  return {
    ...best,
    pose: alignToSnap(best.candidate, best.target, pose.rotation, roll),
  }
}
