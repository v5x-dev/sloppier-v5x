// Connections: which Snap Points join a fastener to the Parts it passes through. Pure
// functions, so the rules can be tested without a scene.
//
// Fit comes from the catalog. A fastener has a fit token (a screw's thread, a shaft's
// side), and an opening lists the tokens it takes. A fastener joins an opening only when
// the opening takes its token and the two line up:
//
// - A screw joins every opening on its shank: its end pins sit in a hole, or a hole lies on
//   the shank between them. So a screw joins a channel, a spacer, a second channel and a nut
//   in one line, not only the two Parts at its ends.
// - A shaft joins every opening whose axis runs along it and sits on its line, anywhere
//   along its length. A wheel, gear, collar or spacer on that line is joined wherever it
//   sits.
//
// Nothing else connects: two holes side by side, or a Part that is merely touching another.

import { Quaternion, Vector3 } from "three"
import type { FitToken, SnapPoint, Vec3 } from "@/catalog/types"
import { toWorldSnap, type Pose } from "./snap"

/** How far apart two Snap Points may be and still count as aligned. */
export const CONNECT_TOLERANCE_MM = 0.5
/** Axes within about 10 degrees of parallel or anti-parallel count as aligned. */
const ALIGNED_COS = 0.985

/**
 * A saved link. `fastenerSnap` is the screw's end pin when the link is an end-on joint, and
 * absent when the link is a shank or shaft passing through the opening.
 */
export type Connection = {
  id: string
  fastener: string
  host: string
  fastenerSnap?: string
  hostSnap: string
}

export type ConnectionDraft = Omit<Connection, "id">

export type FastenerPart =
  | {
      role: "screw"
      id: string
      /** The screw's thread, such as "screw:8-32". Absent: the screw joins nothing. */
      fit?: FitToken
      snaps: readonly SnapPoint[]
      pose: Pose
    }
  | {
      role: "shaft"
      id: string
      /** The shaft's side, such as "shaft:1/8". Absent: the shaft joins nothing. */
      fit?: FitToken
      /** Length along the shaft's own X axis, in millimetres. */
      lengthMm: number
      /** Width across the shaft, in millimetres. */
      sizeMm: number
      pose: Pose
    }

export type HostPart = {
  id: string
  snaps: readonly SnapPoint[]
  pose: Pose
}

/** Whether an opening takes a fit token. An absent token takes nothing. */
export function takesFit(
  opening: { accepts?: readonly FitToken[] },
  fit: FitToken | undefined
): boolean {
  return fit !== undefined && (opening.accepts?.includes(fit) ?? false)
}

/**
 * Every Connection a fastener makes with the Parts around it. A screw's shank is checked
 * against every host opening along it; a shaft's line against every opening on it.
 */
export function connectionsFor(
  fastener: FastenerPart,
  hosts: readonly HostPart[]
): ConnectionDraft[] {
  const found: ConnectionDraft[] = []
  for (const host of hosts) {
    if (host.id === fastener.id) continue
    if (fastener.role === "screw") {
      const shank = shankOf(fastener)
      const pins = fastener.snaps.filter((snap) => snap.kind === "pin")
      for (const hole of host.snaps) {
        if (hole.kind !== "hole" || !takesFit(hole, fastener.fit)) continue
        const there = toWorldSnap(hole, host.pose)
        const endOn = pins.find((pin) =>
          pinEntersHole(toWorldSnap(pin, fastener.pose), there)
        )
        if (endOn) {
          found.push({
            fastener: fastener.id,
            host: host.id,
            fastenerSnap: endOn.id,
            hostSnap: hole.id,
          })
          continue
        }
        if (shank && shankPasses(shank, there))
          found.push({
            fastener: fastener.id,
            host: host.id,
            hostSnap: hole.id,
          })
      }
    } else {
      const line = shaftLine(fastener)
      for (const point of host.snaps) {
        if (point.kind !== "hole" && point.kind !== "axle") continue
        if (!takesFit(point, fastener.fit)) continue
        const there = toWorldSnap(point, host.pose)
        if (shaftPasses(line, fastener.lengthMm, there))
          found.push({
            fastener: fastener.id,
            host: host.id,
            hostSnap: point.id,
          })
      }
    }
  }
  return found
}

/** Whether a screw's end pin sits in an opening: at the same place, with the axes facing. */
export function pinEntersHole(
  pin: { position: Vector3; axis: Vector3 },
  hole: { position: Vector3; axis: Vector3 }
): boolean {
  return (
    pin.position.distanceTo(hole.position) <= CONNECT_TOLERANCE_MM &&
    pin.axis.dot(hole.axis) <= -ALIGNED_COS
  )
}

/** The line a shaft lies on: its centre and its unit length axis, in the world frame. */
export function shaftLine(shaft: { pose: Pose }): {
  origin: Vector3
  direction: Vector3
} {
  const q = new Quaternion(...shaft.pose.rotation)
  return {
    origin: new Vector3(...shaft.pose.position),
    direction: new Vector3(1, 0, 0).applyQuaternion(q).normalize(),
  }
}

/**
 * Whether a shaft passes through an opening: the opening's axis runs along the shaft, its
 * centre lies on the shaft's line, and it is within the shaft's length. The shaft's own fit
 * decides whether the opening takes it, so it is checked by the caller.
 */
export function shaftPasses(
  line: { origin: Vector3; direction: Vector3 },
  lengthMm: number,
  point: { position: Vector3; axis: Vector3 }
): boolean {
  if (Math.abs(point.axis.dot(line.direction)) < ALIGNED_COS) return false
  const offset = point.position.clone().sub(line.origin)
  const along = offset.dot(line.direction)
  if (Math.abs(along) > lengthMm / 2 + CONNECT_TOLERANCE_MM) return false
  const across = offset.sub(line.direction.clone().multiplyScalar(along))
  return across.length() <= CONNECT_TOLERANCE_MM
}

/** A screw's shank: the segment between its two end pins, in the world frame. */
type Shank = { origin: Vector3; direction: Vector3; length: number }

function shankOf(screw: {
  snaps: readonly SnapPoint[]
  pose: Pose
}): Shank | undefined {
  const pins = screw.snaps
    .filter((snap) => snap.kind === "pin")
    .map((snap) => toWorldSnap(snap, screw.pose).position)
  if (pins.length !== 2) return undefined
  const [a, b] = pins
  const span = b.clone().sub(a)
  const length = span.length()
  if (length === 0) return undefined
  return { origin: a, direction: span.normalize(), length }
}

/** Whether an opening lies on a screw's shank, with its axis along the shank. */
function shankPasses(
  shank: Shank,
  point: { position: Vector3; axis: Vector3 }
): boolean {
  if (Math.abs(point.axis.dot(shank.direction)) < ALIGNED_COS) return false
  const offset = point.position.clone().sub(shank.origin)
  const along = offset.dot(shank.direction)
  // An opening right at a tip belongs to its pin, so only openings strictly along the shank count.
  if (
    along < CONNECT_TOLERANCE_MM ||
    along > shank.length - CONNECT_TOLERANCE_MM
  )
    return false
  const across = offset.sub(shank.direction.clone().multiplyScalar(along))
  return across.length() <= CONNECT_TOLERANCE_MM
}

/** One Connection as the graph sees it: a fastener joined to one host. */
export type Edge = { fastener: string; host: string }

/**
 * The Parts that move with `seeds`, following Connections. Without `pivot`, every
 * Connection counts, so a connected group moves as one. With a pivot fastener, its own
 * Connections are skipped: the group turns about that fastener, and any Part still tied to
 * the group by another Connection turns with it. Two fasteners between the same Parts
 * therefore keep them rigid, while a single fastener lets one Part turn around it.
 */
export function movingGroup(
  seeds: Iterable<string>,
  edges: readonly Edge[],
  pivot?: string
): Set<string> {
  const adjacent = new Map<string, string[]>()
  const link = (a: string, b: string) => {
    const list = adjacent.get(a)
    if (list) list.push(b)
    else adjacent.set(a, [b])
  }
  for (const edge of edges) {
    if (pivot !== undefined && edge.fastener === pivot) continue
    link(edge.fastener, edge.host)
    link(edge.host, edge.fastener)
  }
  const group = new Set<string>()
  const queue: string[] = []
  for (const seed of seeds) {
    if (group.has(seed)) continue
    group.add(seed)
    queue.push(seed)
  }
  while (queue.length > 0) {
    const current = queue.pop() as string
    for (const next of adjacent.get(current) ?? []) {
      if (group.has(next)) continue
      group.add(next)
      queue.push(next)
    }
  }
  return group
}

/**
 * Fasteners that join the selection to Parts outside it, sorted by id. Each one can be a
 * pivot for rotating the selection.
 */
export function pivotsFor(
  selection: ReadonlySet<string>,
  edges: readonly Edge[]
): string[] {
  const found = new Set<string>()
  for (const edge of edges)
    if (!selection.has(edge.fastener) && selection.has(edge.host))
      found.add(edge.fastener)
  return [...found].sort()
}

/** The point and direction a pivot fastener turns about. */
export function pivotAxis(fastener: FastenerPart): {
  point: Vec3
  direction: Vec3
} {
  if (fastener.role === "shaft") {
    const line = shaftLine(fastener)
    return {
      point: [line.origin.x, line.origin.y, line.origin.z],
      direction: [line.direction.x, line.direction.y, line.direction.z],
    }
  }
  const pins = fastener.snaps
    .filter((snap) => snap.kind === "pin")
    .map((snap) => toWorldSnap(snap, fastener.pose).position)
  if (pins.length !== 2) {
    const at = fastener.pose.position
    return { point: [...at], direction: [1, 0, 0] }
  }
  const [a, b] = pins
  const point = a.clone().add(b).multiplyScalar(0.5)
  const direction = b.clone().sub(a).normalize()
  return {
    point: [point.x, point.y, point.z],
    direction: [direction.x, direction.y, direction.z],
  }
}
