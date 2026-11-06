// Where a Part goes while it is being placed. Without a snap, it rests on the ground, on the
// half-inch grid, in the orientation its family sits in, turned by the team's quarter turns.
// With a snap, the nearest pair of Snap Points within the radius decides the pose, as long
// as the Part stays above the ground. Turns are about the vertical axis, plus a roll about
// the snapped axis.

import { Quaternion, Vector3 } from "three"
import type { SnapPoint, Vec3 } from "@/catalog/types"
import {
  findSnap,
  findSnapAlongRay,
  type Pose,
  type SnapIndex,
  type SnapMatch,
} from "./snap"
import { HOLE_PITCH_MM } from "./cut-length"
import type { Quat } from "./model"
import { restingQuat } from "./orientation"
import { lowestOffset, lowestWorldY, quatOf, type Bounds } from "./transform"

export const SNAP_RADIUS_MM = 10
export const GRID_MM = HOLE_PITCH_MM
/** A snapped Part may touch the ground, but not sink into it, by more than this. */
const GROUND_EPS_MM = 1e-6

export type PlacementTurn = {
  /** Quarter turns about the vertical axis, counted from the resting orientation. */
  quarterTurns: number
  /** Roll about the snapped axis, in radians. Only used while snapped. */
  roll: number
}

export const START_TURN: PlacementTurn = { quarterTurns: 0, roll: 0 }

export function turnQuaternion(quarterTurns: number): Quat {
  const q = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    (quarterTurns * Math.PI) / 2
  )
  return [q.x, q.y, q.z, q.w]
}

export function snapToGrid(value: number): number {
  return Math.round(value / GRID_MM) * GRID_MM
}

export type PlacementShape = {
  snapPoints: readonly SnapPoint[]
  bounds: Bounds
  family: string
  sizeMm: Vec3
}

export type PlacementResult = {
  pose: Pose
  snap: SnapMatch | null
}

/** The orientation a Part takes on the ground: its resting pose, then the team's turns. */
export function groundRotation(
  shape: PlacementShape,
  quarterTurns: number
): Quat {
  const rest = new Quaternion(...restingQuat(shape.family, shape.sizeMm))
  const turn = new Quaternion(...turnQuaternion(quarterTurns))
  return quatOf(turn.multiply(rest))
}

/** The pose a Part takes with nothing to snap to: on the grid, with its lowest point on the ground. */
export function freePose(
  shape: PlacementShape,
  ground: { x: number; z: number },
  turn: PlacementTurn
): Pose {
  const rotation = groundRotation(shape, turn.quarterTurns)
  return {
    position: [
      snapToGrid(ground.x),
      -lowestOffset(rotation, shape.bounds),
      snapToGrid(ground.z),
    ],
    rotation,
  }
}

/**
 * The pose for a Part under the pointer. A Snap Point under the pointer's ray wins. Failing
 * that, the Part sits on the ground at (x, z), and a Snap Point near that ground pose snaps.
 * A snap that would put any of the Part below the ground is not taken.
 */
export function placementPose(
  shape: PlacementShape,
  ground: { x: number; z: number },
  turn: PlacementTurn,
  index: SnapIndex,
  ray?: { origin: Vector3; direction: Vector3 }
): PlacementResult {
  const free = freePose(shape, ground, turn)
  const aboveGround = (pose: Pose) =>
    lowestWorldY(pose, shape.bounds) >= -GROUND_EPS_MM
  const underPointer = ray
    ? findSnapAlongRay(
        shape.snapPoints,
        ray,
        index,
        SNAP_RADIUS_MM,
        free,
        turn.roll,
        aboveGround
      )
    : null
  if (underPointer) return { pose: underPointer.pose, snap: underPointer }
  const nearGround = findSnap(
    shape.snapPoints,
    free,
    index,
    SNAP_RADIUS_MM,
    turn.roll,
    aboveGround
  )
  return nearGround
    ? { pose: nearGround.pose, snap: nearGround }
    : { pose: free, snap: null }
}
