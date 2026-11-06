// Where a Part goes while it is being placed. Without a snap, it rests on the ground, on the
// half-inch grid, in the orientation its family sits in, turned by the team's quarter turns.
// With a snap, the nearest pair of Snap Points within the radius decides the pose, wherever
// that puts the Part. The ground is a visual reference, not a physical rule: a Part that
// snaps below it is shown below it, because a wheel on a shaft near the floor is still a
// valid assembly. Turns are about the vertical axis, plus a roll about the snapped axis.

import { Quaternion, Vector3 } from "three"
import type { SnapPoint, Vec3 } from "@/catalog/types"
import {
  findLineSnapAlongRay,
  findSnap,
  findSnapAlongRay,
  type Pose,
  type SnapIndex,
  type SnapMatch,
} from "./snap"
import { HOLE_PITCH_MM } from "./cut-length"
import type { Quat } from "./model"
import { restingQuat } from "./orientation"
import { lowestOffset, quatOf, type Bounds } from "./transform"

export const SNAP_RADIUS_MM = 10
export const GRID_MM = HOLE_PITCH_MM

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

/**
 * The Snap Points a Part being placed can offer. A screw goes in head first, so its tip is
 * never the end that is set into an opening; the tip is still a target for other Parts.
 */
export function placeableSnaps(snapPoints: readonly SnapPoint[]): SnapPoint[] {
  return snapPoints.filter((s) => !(s.kind === "pin" && s.role === "tip"))
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
 * that, a shaft's line takes a hole that fits it. Failing that, the Part sits on the ground
 * at (x, z), and a Snap Point near that ground pose snaps. Nothing is refused for being
 * below the ground.
 */
export function placementPose(
  shape: PlacementShape,
  ground: { x: number; z: number },
  turn: PlacementTurn,
  index: SnapIndex,
  ray?: { origin: Vector3; direction: Vector3 }
): PlacementResult {
  const free = freePose(shape, ground, turn)
  const candidates = placeableSnaps(shape.snapPoints)
  const underPointer = ray
    ? findSnapAlongRay(candidates, ray, index, SNAP_RADIUS_MM, free, turn.roll)
    : null
  if (underPointer) return { pose: underPointer.pose, snap: underPointer }
  // A shaft is a line, so a hole or axle that takes its fit slides on anywhere along it.
  const onShaft = ray
    ? findLineSnapAlongRay(
        candidates,
        ray,
        index.lines(),
        SNAP_RADIUS_MM,
        free,
        turn.roll
      )
    : null
  if (onShaft) return { pose: onShaft.pose, snap: onShaft }
  const nearGround = findSnap(
    candidates,
    free,
    index,
    SNAP_RADIUS_MM,
    turn.roll
  )
  return nearGround
    ? { pose: nearGround.pose, snap: nearGround }
    : { pose: free, snap: null }
}
