// Planning edits to Parts: which Parts move, where they end up, and what Connections
// break. The plans are plain data, so a drag can compute one at the start and apply it on
// each pointer move, and only the commit writes to the document.
//
// Two rules hold for every plan. A move carries the whole connected group: Parts joined by
// Connections move together. A plan never leaves a Part below the ground: a rigid move is
// lifted clear, and a turn about a single fastener is refused if it would dig in, because
// lifting it would pull the joint off its axis.

import type { Vec3 } from "@/catalog/types"
import { movingGroup } from "./connections"
import {
  commitPoses,
  readConnections,
  readPlacedParts,
  type PoseChange,
} from "./document"
import type * as Y from "yjs"
import { partShape } from "./library"
import type { Pose } from "./snap"
import { lowestOffset, rotatedAbout, type Bounds } from "./transform"

const GROUND_EPS_MM = 1e-6

/** A Part as a plan sees it: where it is now, and its extent in its own frame. */
export type Target = { id: string; pose: Pose; bounds: Bounds }

export type Plan = {
  changes: PoseChange[]
  /** Parts whose Connections break in the same step. Empty unless the move is alone. */
  breakParts: string[]
}

/** The Parts a move or turn of `selection` touches. Alone, only the selection itself moves. */
export function groupOf(
  doc: Y.Doc,
  selection: Iterable<string>,
  options: { pivot?: string; alone?: boolean } = {}
): string[] {
  const chosen = [...selection]
  if (options.alone) return chosen
  const edges = readConnections(doc).map((c) => ({
    fastener: c.fastener,
    host: c.host,
  }))
  return [...movingGroup(chosen, edges, options.pivot)].sort()
}

/** The current poses and bounds of these Parts. Missing Parts are skipped. */
export function targetsOf(doc: Y.Doc, ids: readonly string[]): Target[] {
  const wanted = new Set(ids)
  return readPlacedParts(doc)
    .parts.filter((part) => wanted.has(part.id))
    .map((part) => ({
      id: part.id,
      pose: { position: part.position, rotation: part.rotation },
      bounds: partShape(part).bounds,
    }))
}

/** Moves every target by `delta`, lifted just enough that none is below the ground. */
export function planMove(
  targets: readonly Target[],
  delta: Vec3,
  alone = false
): Plan {
  const d: [number, number, number] = [delta[0], delta[1], delta[2]]
  const lowest = lowestOf(targets, d)
  if (lowest < -GROUND_EPS_MM) d[1] -= lowest
  return {
    changes: targets.map((t) => ({
      id: t.id,
      position: [
        t.pose.position[0] + d[0],
        t.pose.position[1] + d[1],
        t.pose.position[2] + d[2],
      ],
      rotation: t.pose.rotation,
    })),
    breakParts: alone ? targets.map((t) => t.id) : [],
  }
}

/**
 * Turns every target by `angle` about an axis through `pivot`. A rigid group is lifted
 * clear of the ground. A turn about one fastener is refused instead, because lifting it
 * would move the Parts off the fastener's axis.
 */
export function planTurn(
  targets: readonly Target[],
  pivot: Vec3,
  axis: Vec3,
  angle: number,
  options: { alone?: boolean; liftAllowed: boolean }
): Plan | { blocked: "ground" } {
  const turned = targets.map((t) => ({
    id: t.id,
    pose: rotatedAbout(t.pose, pivot, axis, angle),
    bounds: t.bounds,
  }))
  const lowest = lowestOf(turned, [0, 0, 0])
  let lift = 0
  if (lowest < -GROUND_EPS_MM) {
    if (!options.liftAllowed) return { blocked: "ground" }
    lift = -lowest
  }
  return {
    changes: turned.map((t) => ({
      id: t.id,
      position: [
        t.pose.position[0],
        t.pose.position[1] + lift,
        t.pose.position[2],
      ],
      rotation: t.pose.rotation,
    })),
    breakParts: options.alone ? targets.map((t) => t.id) : [],
  }
}

/** Writes a plan as one undo step. */
export function commitPlan(doc: Y.Doc, plan: Plan): void {
  commitPoses(doc, plan.changes, plan.breakParts)
}

/** Rounds each component to `step`, for snapping moves to the half-inch grid. */
export function quantize(delta: Vec3, step: number): Vec3 {
  return [
    Math.round(delta[0] / step) * step,
    Math.round(delta[1] / step) * step,
    Math.round(delta[2] / step) * step,
  ]
}

/** An angle rounded to the nearest `step` radians. */
export function snapAngle(angle: number, step: number): number {
  return Math.round(angle / step) * step
}

/** The lowest point of any target, after moving it by `shift`. */
function lowestOf(
  targets: readonly { pose: Pose; bounds: Bounds }[],
  shift: Vec3
): number {
  let lowest = Infinity
  for (const t of targets) {
    const y =
      t.pose.position[1] + shift[1] + lowestOffset(t.pose.rotation, t.bounds)
    if (y < lowest) lowest = y
  }
  return lowest
}
