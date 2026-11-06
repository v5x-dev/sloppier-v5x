// The geometry behind the move and rotate handles, as pure functions. A drag turns a
// pointer ray into a number along an axis, a point on a plane, or an angle on a ring.

import type { Vector3 } from "three"

export type Ray = { origin: Vector3; direction: Vector3 }

/**
 * The distance along an axis (`origin` + t * `direction`) that is closest to a ray. A drag
 * along an axis measures the axis position where the pointer is.
 */
export function closestOnAxis(
  ray: Ray,
  origin: Vector3,
  direction: Vector3
): number {
  const r = ray.direction.clone().normalize()
  const d = direction.clone().normalize()
  const w = ray.origin.clone().sub(origin)
  const a = r.dot(r)
  const b = r.dot(d)
  const c = d.dot(d)
  const e = d.dot(w)
  const f = r.dot(w)
  const denom = a * c - b * b
  if (Math.abs(denom) < 1e-12) return 0
  return (a * e - b * f) / denom
}

/** Where a ray meets a plane, or null when it is parallel or the plane is behind it. */
export function rayPlaneHit(
  ray: Ray,
  point: Vector3,
  normal: Vector3
): Vector3 | null {
  const denom = normal.dot(ray.direction)
  if (Math.abs(denom) < 1e-9) return null
  const t = point.clone().sub(ray.origin).dot(normal) / denom
  if (t < 0) return null
  return ray.origin.clone().addScaledVector(ray.direction, t)
}

/**
 * The signed angle, in radians, from `reference` to `hit` about `normal`, measured in the
 * plane through `center`. Positive is the right-hand turn about `normal`.
 */
export function angleOnRing(
  hit: Vector3,
  center: Vector3,
  normal: Vector3,
  reference: Vector3
): number {
  const n = normal.clone().normalize()
  const v = hit.clone().sub(center)
  v.addScaledVector(n, -v.dot(n))
  const ref = reference.clone()
  ref.addScaledVector(n, -ref.dot(n))
  const sin = n.dot(ref.clone().cross(v))
  const cos = ref.dot(v)
  return Math.atan2(sin, cos)
}
