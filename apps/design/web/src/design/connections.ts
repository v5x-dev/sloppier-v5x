// Connections: which Snap Points join a fastener to the Parts it passes through. Pure
// functions, so the rules can be tested without a scene.
//
// A screw joins a hole when one of its end pins sits in the hole: the two are at the same
// place (within CONNECT_TOLERANCE_MM), their axes face each other, and the screw fits
// through the hole. A shaft joins a hole or an axle when that point lies on the shaft's
// length and the hole runs along the shaft, and the shaft fits. Nothing else connects:
// two holes side by side, or a Part that is merely touching another, make no Connection.

import { Quaternion, Vector3 } from "three"
import type { SnapPoint, Vec3 } from "@/catalog/types"
import { toWorldSnap, type Pose } from "./snap"

/** How far apart two Snap Points may be and still count as aligned. */
export const CONNECT_TOLERANCE_MM = 0.5
/** Axes within about 10 degrees of parallel or anti-parallel count as aligned. */
const ALIGNED_COS = 0.985

/** A saved link. `fastenerSnap` is absent for a shaft, whose connection runs along its length. */
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
      snaps: readonly SnapPoint[]
      pose: Pose
    }
  | {
      role: "shaft"
      id: string
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

/**
 * Every Connection a fastener makes with the Parts around it. A screw's pins are checked
 * against the holes and axles of each host; a shaft's line against the same kinds of point.
 */
export function connectionsFor(
  fastener: FastenerPart,
  hosts: readonly HostPart[]
): ConnectionDraft[] {
  const found: ConnectionDraft[] = []
  for (const host of hosts) {
    if (host.id === fastener.id) continue
    if (fastener.role === "screw") {
      for (const pin of fastener.snaps) {
        if (pin.kind !== "pin") continue
        const at = toWorldSnap(pin, fastener.pose)
        for (const hole of host.snaps) {
          if (hole.kind !== "hole") continue
          const there = toWorldSnap(hole, host.pose)
          if (pinEntersHole(at, pin.diameterMm, there, hole.diameterMm))
            found.push({
              fastener: fastener.id,
              host: host.id,
              fastenerSnap: pin.id,
              hostSnap: hole.id,
            })
        }
      }
    } else {
      const line = shaftLine(fastener)
      for (const point of host.snaps) {
        if (point.kind !== "hole" && point.kind !== "axle") continue
        const there = toWorldSnap(point, host.pose)
        if (
          shaftPasses(
            line,
            fastener.lengthMm,
            fastener.sizeMm,
            there,
            point.diameterMm
          )
        )
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

/** Whether a screw's pin sits in a hole: aligned, facing, and the pin fits through. */
export function pinEntersHole(
  pin: { position: Vector3; axis: Vector3 },
  pinDiameterMm: number,
  hole: { position: Vector3; axis: Vector3 },
  holeDiameterMm: number
): boolean {
  return (
    pin.position.distanceTo(hole.position) <= CONNECT_TOLERANCE_MM &&
    pin.axis.dot(hole.axis) <= -ALIGNED_COS &&
    pinDiameterMm <= holeDiameterMm + CONNECT_TOLERANCE_MM
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
 * Whether a shaft passes through a point: the point is on the shaft's line, within the
 * shaft's length, its hole runs along the shaft, and the shaft fits the hole.
 */
export function shaftPasses(
  line: { origin: Vector3; direction: Vector3 },
  lengthMm: number,
  sizeMm: number,
  point: { position: Vector3; axis: Vector3 },
  diameterMm: number
): boolean {
  if (Math.abs(point.axis.dot(line.direction)) < ALIGNED_COS) return false
  if (sizeMm > diameterMm + CONNECT_TOLERANCE_MM) return false
  const offset = point.position.clone().sub(line.origin)
  const along = offset.dot(line.direction)
  if (Math.abs(along) > lengthMm / 2 + CONNECT_TOLERANCE_MM) return false
  const across = offset.sub(line.direction.clone().multiplyScalar(along))
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
