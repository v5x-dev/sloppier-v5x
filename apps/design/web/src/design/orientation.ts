// How a Part sits when it is set down on the ground, before the team turns it. Wheels and
// motors keep their catalog pose, which is upright for a wheel. Standoffs stand on end.
// Everything else lies on its largest face, so a plate or a screw does not stand on edge.

import { Quaternion, Vector3 } from "three"
import type { Vec3 } from "@/catalog/types"
import type { Quat } from "./model"

const UP = new Vector3(0, 1, 0)
const AXES = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]

export function restingQuat(family: string, sizeMm: Vec3): Quat {
  if (family === "wheel" || family === "motor") return [0, 0, 0, 1]
  if (family === "standoff") return turnAxisToUp(longestAxis(sizeMm))
  return turnAxisToUp(shortestAxis(sizeMm))
}

/** Index of the largest extent. Ties go to the earlier axis. */
function longestAxis(size: Vec3): number {
  return argBest(size, (a, b) => a > b)
}

/**
 * Index of the smallest extent. Ties prefer Y, then Z: a screw or shaft with a square or
 * round section keeps its length horizontal, not its section.
 */
function shortestAxis(size: Vec3): number {
  const order = [1, 2, 0]
  let best = order[0]
  for (const axis of order) if (size[axis] < size[best]) best = axis
  return best
}

function argBest(
  size: Vec3,
  better: (a: number, b: number) => boolean
): number {
  let best = 0
  for (let i = 1; i < 3; i++) if (better(size[i], size[best])) best = i
  return best
}

/** The shortest turn that points the chosen Part axis straight up. */
function turnAxisToUp(axis: number): Quat {
  if (axis === 1) return [0, 0, 0, 1]
  const q = new Quaternion().setFromAxisAngle(
    axis === 0 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0),
    Math.PI / 2
  )
  if (AXES[axis].clone().applyQuaternion(q).dot(UP) < 0) q.invert()
  return [q.x, q.y, q.z, q.w]
}
