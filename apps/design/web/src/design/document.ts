// The Design document in Yjs. One map of Parts, keyed by a stable id. Each Part is a
// nested map whose fields are written separately, so two people moving two different
// Parts never conflict, and a concurrent move of the same Part keeps the last write.

import * as Y from "yjs"
import type { Vec3 } from "@/catalog/types"
import type { PlacedPart, PartRef, Quat } from "./model"

export const PARTS_KEY = "parts"

export type PartsMap = Y.Map<Y.Map<unknown>>

export function partsMap(doc: Y.Doc): PartsMap {
  return doc.getMap<Y.Map<unknown>>(PARTS_KEY)
}

export type ReadResult = {
  parts: PlacedPart[]
  /** Ids whose entries could not be read, such as a Part from a newer app version. */
  invalid: string[]
}

/** Every Part in the document, in a stable order. Entries that do not read are listed in `invalid`. */
export function readPlacedParts(doc: Y.Doc): ReadResult {
  const parts: PlacedPart[] = []
  const invalid: string[] = []
  const map = partsMap(doc)
  for (const id of [...map.keys()].sort()) {
    const part = readPart(id, map.get(id))
    if (part) parts.push(part)
    else invalid.push(id)
  }
  return { parts, invalid }
}

export function readPart(id: string, entry: Y.Map<unknown> | undefined): PlacedPart | undefined {
  if (!entry) return undefined
  const catalogId = entry.get("catalog")
  const position = entry.get("position")
  const rotation = entry.get("rotation")
  const color = entry.get("color")
  const lengthMm = entry.get("lengthMm")
  if (typeof catalogId !== "string" || catalogId === "") return undefined
  if (!isVec3(position) || !isQuat(rotation)) return undefined
  if (typeof color !== "string") return undefined
  if (lengthMm !== undefined && !(typeof lengthMm === "number" && lengthMm > 0 && Number.isFinite(lengthMm)))
    return undefined
  const part: PlacedPart = { id, catalogId, position, rotation, color }
  if (lengthMm !== undefined) part.lengthMm = lengthMm as number
  return part
}

export type NewPart = PartRef & {
  position: Vec3
  rotation: Quat
  color: string
}

/** Adds a Part and returns its id. The id is random, so two people placing at once never collide. */
export function placePart(doc: Y.Doc, part: NewPart, id: string = crypto.randomUUID()): string {
  doc.transact(() => {
    const fields: [string, unknown][] = [
      ["catalog", part.catalogId],
      ["position", [...part.position]],
      ["rotation", [...part.rotation]],
      ["color", part.color],
    ]
    if (part.lengthMm !== undefined) fields.push(["lengthMm", part.lengthMm])
    partsMap(doc).set(id, new Y.Map(fields))
  })
  return id
}

/** Deletes a Part. Deleting beats a move: a move to a deleted Part is simply not visible. */
export function removePart(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    partsMap(doc).delete(id)
  })
}

/** Moves a Part. Each field is written on its own; a missing Part is left alone. */
export function setPose(doc: Y.Doc, id: string, position: Vec3, rotation: Quat): void {
  const entry = partsMap(doc).get(id)
  if (!entry) return
  doc.transact(() => {
    entry.set("position", [...position])
    entry.set("rotation", [...rotation])
  })
}

export function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber)
}

export function isQuat(value: unknown): value is Quat {
  return Array.isArray(value) && value.length === 4 && value.every(isFiniteNumber)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}
