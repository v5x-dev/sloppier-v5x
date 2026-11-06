// Moving and turning Parts, as pure functions on poses. A Part's bounds are given in its
// own frame, so the lowest point after a turn can be found without its mesh.

import { Quaternion, Vector3 } from "three"
import type { Vec3 } from "@/catalog/types"
import type { Pose } from "./snap"
import type { Quat } from "./model"

/** A Part's extent in its own frame. The origin is the centre of the bounds in practice. */
export type Bounds = { lo: Vec3; hi: Vec3 }

export function quatOf(q: Quaternion): Quat {
  return [q.x, q.y, q.z, q.w]
}

export function axisRotation(axis: Vec3, angle: number): Quaternion {
  return new Quaternion().setFromAxisAngle(
    new Vector3(...axis).normalize(),
    angle
  )
}

export function translated(pose: Pose, delta: Vec3): Pose {
  return {
    position: [
      pose.position[0] + delta[0],
      pose.position[1] + delta[1],
      pose.position[2] + delta[2],
    ],
    rotation: pose.rotation,
  }
}

/** Turns a pose about a world-space axis through `pivot`. The pivot itself does not move. */
export function rotatedAbout(
  pose: Pose,
  pivot: Vec3,
  axis: Vec3,
  angle: number
): Pose {
  const turn = axisRotation(axis, angle)
  const offset = new Vector3(...pose.position)
    .sub(new Vector3(...pivot))
    .applyQuaternion(turn)
  const position = offset.add(new Vector3(...pivot))
  const rotation = turn.multiply(new Quaternion(...pose.rotation))
  return {
    position: [position.x, position.y, position.z],
    rotation: quatOf(rotation),
  }
}

/**
 * How far below its origin a Part reaches once turned by `rotation`. Exact for turns in
 * multiples of 90 degrees, and an upper bound otherwise.
 */
export function lowestOffset(rotation: Quat, bounds: Bounds): number {
  const q = new Quaternion(...rotation)
  let lowest = Infinity
  for (const x of [bounds.lo[0], bounds.hi[0]])
    for (const y of [bounds.lo[1], bounds.hi[1]])
      for (const z of [bounds.lo[2], bounds.hi[2]]) {
        const corner = new Vector3(x, y, z).applyQuaternion(q)
        if (corner.y < lowest) lowest = corner.y
      }
  return lowest
}

/** The lowest world height of a Part at this pose. */
export function lowestWorldY(pose: Pose, bounds: Bounds): number {
  return pose.position[1] + lowestOffset(pose.rotation, bounds)
}
