// The edits the editor's buttons, keys and menus make, each as one step of the undo
// history. They take the document and the selection, and read the Parts they need.

import type * as Y from "yjs"
import type { Vec3 } from "@/catalog/types"
import { connectionsForSelection, hingeOf } from "./connect"
import { connectionKey } from "./connections"
import {
  addConnections,
  breakConnections,
  duplicateParts,
  readConnections,
  readPlacedParts,
  removeParts,
  setColors,
} from "./document"
import { HOLE_PITCH_MM } from "./cut-length"
import {
  commitPlan,
  groupOf,
  planMove,
  planTurn,
  targetsOf,
  type Target,
} from "./edit"

/** How far a duplicate is placed from its original, along X and Z: one hole. */
export const DUPLICATE_OFFSET: Vec3 = [HOLE_PITCH_MM, 0, HOLE_PITCH_MM]

/** Moves the selection (and what is connected to it) by a typed offset, in millimetres. */
export function moveBy(
  doc: Y.Doc,
  selection: ReadonlySet<string>,
  delta: Vec3,
  alone = false
): void {
  const targets = targetsOf(doc, groupOf(doc, selection, { alone }))
  commitPlan(doc, planMove(targets, delta, alone))
}

/**
 * Turns the selection about its centre, or about a screw or shaft if `pivotFastener` is
 * given. Nothing is refused for where the Parts end up, below the ground or not.
 */
export function turnBy(
  doc: Y.Doc,
  selection: ReadonlySet<string>,
  options: {
    angle: number
    axis: Vec3
    pivotFastener?: string
    alone?: boolean
  }
): void {
  const hinge = options.pivotFastener
    ? hingeOf(doc, options.pivotFastener)
    : undefined
  const group = groupOf(doc, selection, {
    pivot: hinge ? options.pivotFastener : undefined,
    alone: options.alone,
  })
  const targets: Target[] = targetsOf(doc, group)
  const centre = centreOf(targetsOf(doc, [...selection]))
  const pivot: Vec3 = hinge
    ? [hinge.point.x, hinge.point.y, hinge.point.z]
    : centre
  const axis: Vec3 = hinge
    ? [hinge.direction.x, hinge.direction.y, hinge.direction.z]
    : options.axis
  const plan = planTurn(targets, pivot, axis, options.angle, {
    alone: options.alone,
  })
  commitPlan(doc, plan)
}

/** Joins the selection's screws and shafts to the Parts they pass through. Returns how many were made. */
export function connectSelection(
  doc: Y.Doc,
  selection: ReadonlySet<string>
): number {
  const existing = new Set(readConnections(doc).map(connectionKey))
  const drafts = connectionsForSelection(
    readPlacedParts(doc).parts,
    selection
  ).filter((draft) => !existing.has(connectionKey(draft)))
  if (drafts.length === 0) return 0
  return addConnections(doc, drafts).length
}

/** Breaks every Connection that touches the selection. The Parts stay where they are. */
export function disconnectSelection(
  doc: Y.Doc,
  selection: ReadonlySet<string>
): void {
  breakConnections(doc, selection)
}

/** Copies the selection, and returns the copies' ids. */
export function duplicateSelection(
  doc: Y.Doc,
  selection: ReadonlySet<string>
): string[] {
  return duplicateParts(doc, [...selection], DUPLICATE_OFFSET)
}

export function recolorSelection(
  doc: Y.Doc,
  selection: ReadonlySet<string>,
  color: string
): void {
  setColors(doc, [...selection], color)
}

export function deleteSelection(
  doc: Y.Doc,
  selection: ReadonlySet<string>
): void {
  removeParts(doc, [...selection])
}

function centreOf(targets: readonly Target[]): Vec3 {
  if (targets.length === 0) return [0, 0, 0]
  const sum = [0, 0, 0]
  for (const t of targets)
    for (let k = 0; k < 3; k++) sum[k] += t.pose.position[k]
  return [
    sum[0] / targets.length,
    sum[1] / targets.length,
    sum[2] / targets.length,
  ]
}
