// Planning edits to Parts: which Parts move, where they end up, and what Connections
// break. The plans are plain data, so a drag can compute one at the start and apply it on
// each pointer move, and only the commit writes to the document.
//
// A move carries the whole connected group: Parts joined by Connections move together. A
// plan does not lift anything out of the ground. The ground is a visual reference, so a
// Part may be moved or turned below it, as it may be on a real robot's floor plan.

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
import { rotatedAbout, type Bounds } from "./transform"

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

/** Moves every target by `delta`. Nothing is lifted, so a move may go below the ground. */
export function planMove(
  targets: readonly Target[],
  delta: Vec3,
  alone = false
): Plan {
  return {
    changes: targets.map((t) => ({
      id: t.id,
      position: [
        t.pose.position[0] + delta[0],
        t.pose.position[1] + delta[1],
        t.pose.position[2] + delta[2],
      ],
      rotation: t.pose.rotation,
    })),
    breakParts: alone ? targets.map((t) => t.id) : [],
  }
}

/**
 * Turns every target by `angle` about an axis through `pivot`. Nothing is lifted: a turn
 * about a fastener keeps the fastener's axis, wherever that puts the Parts.
 */
export function planTurn(
  targets: readonly Target[],
  pivot: Vec3,
  axis: Vec3,
  angle: number,
  options: { alone?: boolean } = {}
): Plan {
  return {
    changes: targets.map((t) => {
      const turned = rotatedAbout(t.pose, pivot, axis, angle)
      return { id: t.id, position: turned.position, rotation: turned.rotation }
    }),
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
