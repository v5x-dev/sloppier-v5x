// Where a Part goes while it is being placed. Without a snap, it sits on the ground, on the
// half-inch grid, with its lowest point at height zero. With a snap, the nearest pair of
// Snap Points within the radius decides the pose. Turns are about the vertical axis, plus a
// roll about the snapped axis.

import { Quaternion, Vector3 } from "three"
import type { SnapPoint, Vec3 } from "@/catalog/types"
import { findSnap, findSnapAlongRay, type Pose, type SnapIndex, type SnapMatch } from "./snap"
import { HOLE_PITCH_MM } from "./cut-length"
import type { Quat } from "./model"

export const SNAP_RADIUS_MM = 10
export const GRID_MM = HOLE_PITCH_MM

export type PlacementTurn = {
  /** Quarter turns about the vertical axis, counted from the catalog's orientation. */
  quarterTurns: number
  /** Roll about the snapped axis, in radians. Only used while snapped. */
  roll: number
}

export const START_TURN: PlacementTurn = { quarterTurns: 0, roll: 0 }

export function turnQuaternion(quarterTurns: number): Quat {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (quarterTurns * Math.PI) / 2)
  return [q.x, q.y, q.z, q.w]
}

export function snapToGrid(value: number): number {
  return Math.round(value / GRID_MM) * GRID_MM
}

export type PlacementShape = { snapPoints: readonly SnapPoint[]; minY: number }

export type PlacementResult = {
  pose: Pose
  snap: SnapMatch | null
}

/**
 * The pose for a Part under the pointer. A Snap Point under the pointer's ray wins. Failing
 * that, the Part sits on the ground at (x, z), and a Snap Point near that ground pose snaps.
 */
export function placementPose(
  shape: PlacementShape,
  ground: { x: number; z: number },
  turn: PlacementTurn,
  index: SnapIndex,
  ray?: { origin: Vector3; direction: Vector3 }
): PlacementResult {
  const free: Pose = {
    position: [snapToGrid(ground.x), -shape.minY, snapToGrid(ground.z)] as Vec3,
    rotation: turnQuaternion(turn.quarterTurns),
  }
  const underPointer = ray ? findSnapAlongRay(shape.snapPoints, ray, index, SNAP_RADIUS_MM, free, turn.roll) : null
  if (underPointer) return { pose: underPointer.pose, snap: underPointer }
  const nearGround = findSnap(shape.snapPoints, free, index, SNAP_RADIUS_MM, turn.roll)
  return nearGround ? { pose: nearGround.pose, snap: nearGround } : { pose: free, snap: null }
}
