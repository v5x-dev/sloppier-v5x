// The Design document in Yjs. Two maps: `parts`, keyed by a stable id, and `connections`,
// keyed the same way. Each entry is a nested map whose fields are written separately, so
// two people moving two different Parts never conflict, and a concurrent move of the same
// Part keeps one of the two writes. Every local edit runs with LOCAL_ORIGIN and records the
// values it replaced, so the undo history can reverse exactly this person's edits.

import * as Y from "yjs"
import type { Vec3 } from "@/catalog/types"
import type { PlacedPart, PartRef, Quat } from "./model"
import type { Connection, ConnectionDraft } from "./connections"

export const PARTS_KEY = "parts"
export const CONNECTIONS_KEY = "connections"

/** The origin of every edit made on this device. */
export const LOCAL_ORIGIN = Symbol("local-edit")

export type PartsMap = Y.Map<Y.Map<unknown>>
export type ConnectionsMap = Y.Map<Y.Map<unknown>>

export function partsMap(doc: Y.Doc): PartsMap {
  return doc.getMap<Y.Map<unknown>>(PARTS_KEY)
}

export function connectionsMap(doc: Y.Doc): ConnectionsMap {
  return doc.getMap<Y.Map<unknown>>(CONNECTIONS_KEY)
}

/** One entry's fields, as plain values. */
export type Fields = Record<string, unknown>

/** One entry in one of the two maps. */
export type Ref = { map: "parts" | "connections"; id: string }

/** What one local action did to one entry: its fields before it and after it. Null is absent. */
export type Change = { ref: Ref; before: Fields | null; after: Fields | null }

const hooks = new WeakMap<Y.Doc, (changes: Change[]) => void>()

/** Lets the undo history hear about every local action on this document. */
export function listenForActions(
  doc: Y.Doc,
  hook: (changes: Change[]) => void
): () => void {
  hooks.set(doc, hook)
  return () => {
    if (hooks.get(doc) === hook) hooks.delete(doc)
  }
}

/** The fields of one entry, copied, or null when the entry is absent. */
export function snapshot(doc: Y.Doc, ref: Ref): Fields | null {
  const entry = mapOf(doc, ref.map).get(ref.id)
  if (!entry) return null
  const fields: Fields = {}
  for (const [key, value] of entry.entries()) fields[key] = clone(value)
  return fields
}

/**
 * Writes fields back. A null `target` deletes the entry. Otherwise `keys` are the fields to
 * set, and an entry that is absent is created from all of `target`.
 */
export function restore(
  doc: Y.Doc,
  ref: Ref,
  target: Fields | null,
  keys: readonly string[]
): void {
  const map = mapOf(doc, ref.map)
  if (target === null) {
    map.delete(ref.id)
    return
  }
  const entry = map.get(ref.id)
  if (!entry) {
    map.set(
      ref.id,
      new Y.Map(Object.entries(target).map(([k, v]) => [k, clone(v)]))
    )
    return
  }
  for (const key of keys) {
    if (target[key] === undefined) entry.delete(key)
    else entry.set(key, clone(target[key]))
  }
}

/**
 * Runs one local action in a single transaction, and records what it changed. Each entry
 * in `refs` is read before and after, so the whole action is one undo step.
 */
export function recorded(
  doc: Y.Doc,
  refs: readonly Ref[],
  fn: () => void
): void {
  const unique = [...new Map(refs.map((r) => [`${r.map}/${r.id}`, r])).values()]
  const before = unique.map((ref) => snapshot(doc, ref))
  doc.transact(fn, LOCAL_ORIGIN)
  const changes: Change[] = []
  unique.forEach((ref, i) => {
    const after = snapshot(doc, ref)
    if (!sameFields(before[i], after))
      changes.push({ ref, before: before[i], after })
  })
  if (changes.length > 0) hooks.get(doc)?.(changes)
}

function mapOf(doc: Y.Doc, map: Ref["map"]): ConnectionsMap {
  return map === "parts" ? partsMap(doc) : connectionsMap(doc)
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

export function readPart(
  id: string,
  entry: Y.Map<unknown> | undefined
): PlacedPart | undefined {
  if (!entry) return undefined
  const catalogId = entry.get("catalog")
  const position = entry.get("position")
  const rotation = entry.get("rotation")
  const color = entry.get("color")
  const lengthMm = entry.get("lengthMm")
  if (typeof catalogId !== "string" || catalogId === "") return undefined
  if (!isVec3(position) || !isQuat(rotation)) return undefined
  if (typeof color !== "string") return undefined
  if (
    lengthMm !== undefined &&
    !(typeof lengthMm === "number" && lengthMm > 0 && Number.isFinite(lengthMm))
  )
    return undefined
  const part: PlacedPart = { id, catalogId, position, rotation, color }
  if (lengthMm !== undefined) part.lengthMm = lengthMm
  return part
}

/** Every saved Connection whose two Parts are both in the document. */
export function readConnections(doc: Y.Doc): Connection[] {
  const parts = partsMap(doc)
  const connections = connectionsMap(doc)
  const found: Connection[] = []
  for (const id of [...connections.keys()].sort()) {
    const entry = connections.get(id)
    if (!entry) continue
    const fastener = entry.get("fastener")
    const host = entry.get("host")
    const hostSnap = entry.get("hostSnap")
    const fastenerSnap = entry.get("fastenerSnap")
    if (typeof fastener !== "string" || typeof host !== "string") continue
    if (typeof hostSnap !== "string") continue
    if (fastenerSnap !== undefined && typeof fastenerSnap !== "string") continue
    if (!parts.has(fastener) || !parts.has(host)) continue
    const connection: Connection = { id, fastener, host, hostSnap }
    if (fastenerSnap !== undefined) connection.fastenerSnap = fastenerSnap
    found.push(connection)
  }
  return found
}

export type NewPart = PartRef & {
  position: Vec3
  rotation: Quat
  color: string
}

type Link = { id: string; draft: ConnectionDraft }

function linksFor(drafts: readonly ConnectionDraft[]): Link[] {
  return drafts.map((draft) => ({ id: crypto.randomUUID(), draft }))
}

/**
 * Adds a Part, and any Connections it makes, in one edit. The ids are random, so two people
 * placing at once never collide.
 */
export function placePart(
  doc: Y.Doc,
  part: NewPart,
  id: string = crypto.randomUUID(),
  connections: readonly ConnectionDraft[] = []
): string {
  const links = linksFor(connections)
  recorded(
    doc,
    [
      { map: "parts", id },
      ...links.map((l) => ({ map: "connections" as const, id: l.id })),
    ],
    () => {
      const fields: [string, unknown][] = [
        ["catalog", part.catalogId],
        ["position", [...part.position]],
        ["rotation", [...part.rotation]],
        ["color", part.color],
      ]
      if (part.lengthMm !== undefined) fields.push(["lengthMm", part.lengthMm])
      partsMap(doc).set(id, new Y.Map(fields))
      writeLinks(doc, links)
    }
  )
  return id
}

/** Saves Connections between Parts that already exist. Returns their ids. */
export function addConnections(
  doc: Y.Doc,
  drafts: readonly ConnectionDraft[]
): string[] {
  const links = linksFor(drafts)
  recorded(
    doc,
    links.map((l) => ({ map: "connections" as const, id: l.id })),
    () => writeLinks(doc, links)
  )
  return links.map((l) => l.id)
}

function writeLinks(doc: Y.Doc, links: readonly Link[]): void {
  for (const { id, draft } of links) {
    const fields: [string, unknown][] = [
      ["fastener", draft.fastener],
      ["host", draft.host],
      ["hostSnap", draft.hostSnap],
    ]
    if (draft.fastenerSnap !== undefined)
      fields.push(["fastenerSnap", draft.fastenerSnap])
    connectionsMap(doc).set(id, new Y.Map(fields))
  }
}

/** The ids of every Connection that touches one of these Parts. */
export function connectionIdsTouching(
  doc: Y.Doc,
  ids: ReadonlySet<string>
): string[] {
  const found: string[] = []
  const connections = connectionsMap(doc)
  for (const key of connections.keys()) {
    const entry = connections.get(key)
    if (!entry) continue
    if (
      ids.has(entry.get("fastener") as string) ||
      ids.has(entry.get("host") as string)
    )
      found.push(key)
  }
  return found
}

/**
 * Deletes Parts, and every Connection that touches them, in one edit. Deleting beats a
 * move: a move to a deleted Part is simply not visible.
 */
export function removeParts(doc: Y.Doc, ids: readonly string[]): void {
  const gone = new Set(ids)
  const links = connectionIdsTouching(doc, gone)
  recorded(
    doc,
    [
      ...[...gone].map((id) => ({ map: "parts" as const, id })),
      ...links.map((id) => ({ map: "connections" as const, id })),
    ],
    () => {
      for (const id of gone) partsMap(doc).delete(id)
      for (const id of links) connectionsMap(doc).delete(id)
    }
  )
}

export function removePart(doc: Y.Doc, id: string): void {
  removeParts(doc, [id])
}

/** Removes every Connection that touches one of these Parts. The Parts stay where they are. */
export function breakConnections(doc: Y.Doc, ids: Iterable<string>): void {
  const links = connectionIdsTouching(doc, new Set(ids))
  if (links.length === 0) return
  recorded(
    doc,
    links.map((id) => ({ map: "connections" as const, id })),
    () => {
      for (const id of links) connectionsMap(doc).delete(id)
    }
  )
}

export type PoseChange = { id: string; position: Vec3; rotation: Quat }

/**
 * Moves or turns Parts and, in the same step, breaks every Connection that touches the
 * Parts named in `breakParts`. One call is one undo step.
 */
export function commitPoses(
  doc: Y.Doc,
  changes: readonly PoseChange[],
  breakParts: Iterable<string> = []
): void {
  const broken = new Set(breakParts)
  const links = connectionIdsTouching(doc, broken)
  recorded(
    doc,
    [
      ...changes.map((c) => ({ map: "parts" as const, id: c.id })),
      ...links.map((id) => ({ map: "connections" as const, id })),
    ],
    () => {
      for (const change of changes) {
        const entry = partsMap(doc).get(change.id)
        if (!entry) continue
        entry.set("position", [...change.position])
        entry.set("rotation", [...change.rotation])
      }
      for (const id of links) connectionsMap(doc).delete(id)
    }
  )
}

/** Moves or turns several Parts in one edit. A missing Part is left alone. */
export function setPoses(doc: Y.Doc, changes: readonly PoseChange[]): void {
  recorded(
    doc,
    changes.map((c) => ({ map: "parts" as const, id: c.id })),
    () => {
      for (const change of changes) {
        const entry = partsMap(doc).get(change.id)
        if (!entry) continue
        entry.set("position", [...change.position])
        entry.set("rotation", [...change.rotation])
      }
    }
  )
}

/** Moves a Part. Each field is written on its own; a missing Part is left alone. */
export function setPose(
  doc: Y.Doc,
  id: string,
  position: Vec3,
  rotation: Quat
): void {
  setPoses(doc, [{ id, position, rotation }])
}

/** Changes the colour of several Parts in one edit. */
export function setColors(
  doc: Y.Doc,
  ids: readonly string[],
  color: string
): void {
  recorded(
    doc,
    ids.map((id) => ({ map: "parts" as const, id })),
    () => {
      for (const id of ids) partsMap(doc).get(id)?.set("color", color)
    }
  )
}

/**
 * Copies Parts, offset by `offset`, with new ids. A Connection is copied too when both of
 * its Parts are copied, so a copied sub-assembly keeps its screws. Returns the new ids in
 * the order of `ids`.
 */
export function duplicateParts(
  doc: Y.Doc,
  ids: readonly string[],
  offset: Vec3
): string[] {
  const sources = [...new Set(ids)].filter((id) => partsMap(doc).has(id))
  const copies = new Map<string, string>(
    sources.map((id): [string, string] => [id, crypto.randomUUID()])
  )
  const inside = new Set(sources)
  const links: Link[] = readConnections(doc)
    .filter((c) => inside.has(c.fastener) && inside.has(c.host))
    .map((c) => ({
      id: crypto.randomUUID(),
      draft: {
        fastener: copies.get(c.fastener) as string,
        host: copies.get(c.host) as string,
        hostSnap: c.hostSnap,
        ...(c.fastenerSnap !== undefined
          ? { fastenerSnap: c.fastenerSnap }
          : {}),
      },
    }))
  const refs: Ref[] = [
    ...[...copies.values()].map((id) => ({ map: "parts" as const, id })),
    ...links.map((l) => ({ map: "connections" as const, id: l.id })),
  ]
  recorded(doc, refs, () => {
    for (const source of sources) {
      const entry = partsMap(doc).get(source)
      if (!entry) continue
      const position = entry.get("position") as Vec3
      const fields: [string, unknown][] = [
        ["catalog", entry.get("catalog")],
        [
          "position",
          [
            position[0] + offset[0],
            position[1] + offset[1],
            position[2] + offset[2],
          ],
        ],
        ["rotation", [...(entry.get("rotation") as Quat)]],
        ["color", entry.get("color")],
      ]
      const length = entry.get("lengthMm")
      if (length !== undefined) fields.push(["lengthMm", length])
      partsMap(doc).set(copies.get(source) as string, new Y.Map(fields))
    }
    writeLinks(doc, links)
  })
  return ids
    .map((id) => copies.get(id))
    .filter((id): id is string => id !== undefined)
}

export function isVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber)
  )
}

export function isQuat(value: unknown): value is Quat {
  return (
    Array.isArray(value) && value.length === 4 && value.every(isFiniteNumber)
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function clone<T>(value: T): T {
  return Array.isArray(value) ? ([...value] as T) : value
}

/** Equal as stored values, so two copies of the same array are the same. */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function sameFields(a: Fields | null, b: Fields | null): boolean {
  if (a === null || b === null) return a === b
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((key) => sameValue(a[key], b[key]))
}

/** The fields an action changed: those that differ before and after. */
export function changedKeys(
  before: Fields | null,
  after: Fields | null
): string[] {
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ])
  return [...keys].filter((key) => !sameValue(before?.[key], after?.[key]))
}
