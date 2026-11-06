// Which Connections a placement or a Connect action makes. Built on the rules in
// connections.ts: a fastener is a screw or a shaft, and a host is any other Part with
// Snap Points. Nothing here looks at distances between Parts that are not aligned.

import { catalog } from "@/catalog/catalog"
import type * as Y from "yjs"
import { Vector3 } from "three"
import {
  connectionsFor,
  connectionKey,
  pivotAxis,
  type ConnectionDraft,
  type FastenerPart,
  type HostPart,
} from "./connections"
import type { PlacedPart } from "./model"
import { partShape } from "./library"
import { readPlacedParts } from "./document"

/** The fastener this Part is, if it is a screw or a shaft. */
export function fastenerOf(part: PlacedPart): FastenerPart | undefined {
  const shape = partShape(part)
  if (shape.family === "screw")
    return {
      role: "screw",
      id: part.id,
      fit: shape.catalog.fit,
      snaps: shape.snapPoints,
      pose: pose(part),
    }
  const entry = catalog.parts.find((p) => p.id === part.catalogId)
  if (entry?.kind === "cut" && entry.family === "shaft")
    return {
      role: "shaft",
      id: part.id,
      fit: entry.fit,
      lengthMm: shape.sizeMm[0],
      sizeMm: Math.max(shape.sizeMm[1], shape.sizeMm[2]),
      pose: pose(part),
    }
  return undefined
}

/** The Part as something a fastener can join to. */
export function hostOf(part: PlacedPart): HostPart {
  return { id: part.id, snaps: partShape(part).snapPoints, pose: pose(part) }
}

/** The Connections a newly placed Part makes with the Parts already there. */
export function connectionsForNew(
  parts: readonly PlacedPart[],
  added: PlacedPart
): ConnectionDraft[] {
  const others = parts.filter((p) => p.id !== added.id)
  const drafts: ConnectionDraft[] = []
  const self = fastenerOf(added)
  if (self) drafts.push(...connectionsFor(self, others.map(hostOf)))
  const host = hostOf(added)
  for (const other of others) {
    const fastener = fastenerOf(other)
    if (fastener) drafts.push(...connectionsFor(fastener, [host]))
  }
  return unique(drafts)
}

/**
 * The Connections a Connect action makes for a selection: each selected fastener joins
 * every Part it passes through, and each selected Part joins the fasteners through it.
 */
export function connectionsForSelection(
  parts: readonly PlacedPart[],
  selection: ReadonlySet<string>
): ConnectionDraft[] {
  const drafts: ConnectionDraft[] = []
  for (const part of parts) {
    if (!selection.has(part.id)) continue
    const self = fastenerOf(part)
    if (self)
      drafts.push(
        ...connectionsFor(
          self,
          parts.filter((p) => p.id !== part.id).map(hostOf)
        )
      )
    else
      for (const other of parts) {
        if (other.id === part.id || selection.has(other.id)) continue
        const fastener = fastenerOf(other)
        if (fastener) drafts.push(...connectionsFor(fastener, [hostOf(part)]))
      }
  }
  return unique(drafts)
}

function pose(part: PlacedPart) {
  return { position: part.position, rotation: part.rotation }
}

function unique(drafts: ConnectionDraft[]): ConnectionDraft[] {
  const seen = new Set<string>()
  return drafts.filter((d) => {
    const key = connectionKey(d)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The hinge a screw or shaft turns about, at the Part's current pose. */
export function hingeOf(
  doc: Y.Doc,
  id: string
): { point: Vector3; direction: Vector3 } | undefined {
  const part = readPlacedParts(doc).parts.find((p) => p.id === id)
  if (!part) return undefined
  const fastener = fastenerOf(part)
  if (!fastener) return undefined
  const axis = pivotAxis(fastener)
  return {
    point: new Vector3(...axis.point),
    direction: new Vector3(...axis.direction).normalize(),
  }
}
