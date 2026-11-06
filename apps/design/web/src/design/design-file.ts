// The Design file: a versioned JSON copy of a Design's Parts and Connections, for keeping,
// sending to a teammate, or opening as a new Design. Import is strict. Each Part and
// Connection is checked against the catalog and the Snap Points it names, and a file with any
// problem is refused with a list of what is wrong, so a damaged file never half-opens.
//
// Version 1 layout:
//   { "format": "v5x-design", "version": 1, "name": "...", "units": "mm",
//     "parts":       [{ "id", "catalog", "position": [x,y,z], "rotation": [x,y,z,w],
//                       "color": "#rrggbb", "lengthMm"? }],
//     "connections": [{ "id", "fastener", "host", "hostSnap", "fastenerSnap"? }] }
// Positions are millimetres with Y up, as the Design document stores them.

import * as Y from "yjs"
import { catalog } from "@/catalog/catalog"
import { generateCutPart } from "@/catalog/cut-part"
import type { CatalogPart, CutPart } from "@/catalog/types"
import { fastenerOf } from "./connect"
import type { Connection } from "./connections"
import {
  connectionsMap,
  isQuat,
  isVec3,
  partsMap,
  readConnections,
  readPlacedParts,
} from "./document"
import {
  HOLE_PITCH_MM,
  MAX_HOLES,
  MAX_SHAFT_MM,
  MIN_SHAFT_MM,
  lengthUnit,
} from "./cut-length"
import type { PlacedPart, Quat } from "./model"

export const DESIGN_FILE_FORMAT = "v5x-design"
export const DESIGN_FILE_VERSION = 1
/** The extension a saved Design file gets. */
export const DESIGN_FILE_EXTENSION = ".v5x-design.json"

export const MAX_FILE_CHARS = 5_000_000
export const MAX_FILE_PARTS = 5_000
export const MAX_FILE_CONNECTIONS = 20_000
const MAX_NAME_CHARS = 120
const MAX_REPORTED_PROBLEMS = 20
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const MAX_COORDINATE_MM = 100_000

/** A Design read from a file and checked. Its ids are the ids the file gave. */
export type ParsedDesign = {
  name: string
  parts: PlacedPart[]
  connections: Connection[]
}

export type ParseResult =
  { ok: true; design: ParsedDesign } | { ok: false; problems: string[] }

/** The JSON shape of version 1. */
export type DesignFileV1 = {
  format: typeof DESIGN_FILE_FORMAT
  version: typeof DESIGN_FILE_VERSION
  name: string
  units: "mm"
  parts: FilePart[]
  connections: FileConnection[]
}

type FilePart = {
  id: string
  catalog: string
  position: number[]
  rotation: number[]
  color: string
  lengthMm?: number
}

type FileConnection = {
  id: string
  fastener: string
  host: string
  hostSnap: string
  fastenerSnap?: string
}

/** Builds the file for a Design's current Parts and Connections. */
export function designFileFrom(
  name: string,
  parts: readonly PlacedPart[],
  connections: readonly Connection[]
): DesignFileV1 {
  return {
    format: DESIGN_FILE_FORMAT,
    version: DESIGN_FILE_VERSION,
    name: cleanName(name) || "Design",
    units: "mm",
    parts: [...parts]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((part) => {
        const entry: FilePart = {
          id: part.id,
          catalog: part.catalogId,
          position: [...part.position],
          rotation: [...part.rotation],
          color: part.color,
        }
        if (part.lengthMm !== undefined) entry.lengthMm = part.lengthMm
        return entry
      }),
    connections: [...connections]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((c) => {
        const entry: FileConnection = {
          id: c.id,
          fastener: c.fastener,
          host: c.host,
          hostSnap: c.hostSnap,
        }
        if (c.fastenerSnap !== undefined) entry.fastenerSnap = c.fastenerSnap
        return entry
      }),
  }
}

/** The text of a Design file, indented so a person can read it. */
export function designFileText(file: DesignFileV1): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

/** The Design file for the Parts and Connections in a document. */
export function designFileOf(doc: Y.Doc, name: string): DesignFileV1 {
  return designFileFrom(name, readPlacedParts(doc).parts, readConnections(doc))
}

/**
 * Reads a Design file. Returns every problem found (up to a limit), or the Design. Nothing is
 * changed in a Design by this; `designUpdates` writes it once the file is accepted.
 */
export function parseDesignFile(text: string): ParseResult {
  if (text.length > MAX_FILE_CHARS)
    return { ok: false, problems: ["The file is too large to be a Design."] }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, problems: ["The file is not valid JSON."] }
  }
  if (!isRecord(raw)) return fail("The file does not hold a Design.")
  if (raw.format !== DESIGN_FILE_FORMAT)
    return fail("The file is not a v5x Design file.")
  if (raw.version !== DESIGN_FILE_VERSION)
    return fail(
      `This file is version ${String(raw.version)}. This app reads version ${DESIGN_FILE_VERSION}.`
    )
  if (raw.units !== "mm")
    return fail('The file must use millimetres (units: "mm").')

  const problems: string[] = []
  const name = typeof raw.name === "string" ? cleanName(raw.name) : ""
  if (raw.name !== undefined && typeof raw.name !== "string")
    problems.push("The name must be text.")

  if (!Array.isArray(raw.parts)) problems.push("The parts must be a list.")
  if (!Array.isArray(raw.connections))
    problems.push("The connections must be a list.")
  if (problems.length > 0) return { ok: false, problems }
  const rawParts = raw.parts as unknown[]
  const rawConnections = raw.connections as unknown[]
  if (rawParts.length > MAX_FILE_PARTS)
    return fail(`A Design file holds at most ${MAX_FILE_PARTS} Parts.`)
  if (rawConnections.length > MAX_FILE_CONNECTIONS)
    return fail(
      `A Design file holds at most ${MAX_FILE_CONNECTIONS} Connections.`
    )

  const parts: PlacedPart[] = []
  const seen = new Set<string>()
  rawParts.forEach((entry, index) => {
    const label = `Part ${index + 1}`
    const part = readPart(entry, label, problems)
    if (!part) return
    if (seen.has(part.id))
      problems.push(`${label}: the id "${part.id}" is used twice.`)
    seen.add(part.id)
    parts.push(part)
  })

  const byId = new Map(parts.map((p) => [p.id, p]))
  const connections: Connection[] = []
  const seenLinks = new Set<string>()
  rawConnections.forEach((entry, index) => {
    const label = `Connection ${index + 1}`
    const link = readConnection(entry, label, byId, problems)
    if (!link) return
    if (seenLinks.has(link.id))
      problems.push(`${label}: the id "${link.id}" is used twice.`)
    seenLinks.add(link.id)
    connections.push(link)
  })

  if (problems.length > 0)
    return { ok: false, problems: problems.slice(0, MAX_REPORTED_PROBLEMS) }
  return {
    ok: true,
    design: { name: name || "Imported Design", parts, connections },
  }
}

/** Parts and Connections written per update, so each update stays well under the server's limit. */
export const UPDATE_CHUNK = 500

/**
 * The Yjs updates that write a parsed Design into an empty document, in order. The Design
 * is written in chunks so each update is small, and each chunk is one edit. The updates are
 * meant to be stored on the server before the Design is opened.
 */
export function designUpdates(design: ParsedDesign): Uint8Array[] {
  const scratch = new Y.Doc()
  const updates: Uint8Array[] = []
  scratch.on("update", (update: Uint8Array) => updates.push(update))
  for (let i = 0; i < design.parts.length; i += UPDATE_CHUNK)
    scratch.transact(() => {
      for (const part of design.parts.slice(i, i + UPDATE_CHUNK))
        writePart(scratch, part)
    })
  for (let i = 0; i < design.connections.length; i += UPDATE_CHUNK)
    scratch.transact(() => {
      for (const c of design.connections.slice(i, i + UPDATE_CHUNK))
        writeConnection(scratch, c)
    })
  scratch.destroy()
  return updates
}

function writePart(doc: Y.Doc, part: PlacedPart): void {
  const fields: [string, unknown][] = [
    ["catalog", part.catalogId],
    ["position", [...part.position]],
    ["rotation", [...part.rotation]],
    ["color", part.color],
  ]
  if (part.lengthMm !== undefined) fields.push(["lengthMm", part.lengthMm])
  partsMap(doc).set(part.id, new Y.Map(fields))
}

function writeConnection(doc: Y.Doc, c: Connection): void {
  const fields: [string, unknown][] = [
    ["fastener", c.fastener],
    ["host", c.host],
    ["hostSnap", c.hostSnap],
  ]
  if (c.fastenerSnap !== undefined)
    fields.push(["fastenerSnap", c.fastenerSnap])
  connectionsMap(doc).set(c.id, new Y.Map(fields))
}

function readPart(
  entry: unknown,
  label: string,
  problems: string[]
): PlacedPart | undefined {
  if (!isRecord(entry)) {
    problems.push(`${label}: it is not an object.`)
    return undefined
  }
  const before = problems.length
  const id =
    typeof entry.id === "string" && ID_PATTERN.test(entry.id)
      ? entry.id
      : undefined
  if (id === undefined)
    problems.push(
      `${label}: the id must be 1 to 64 letters, digits, "-" or "_".`
    )
  const named = label + (id ? ` (${id})` : "")

  const entryPart =
    typeof entry.catalog === "string" ? catalogEntry(entry.catalog) : undefined
  if (entryPart === undefined)
    problems.push(
      `${named}: "${String(entry.catalog)}" is not a Part in this app's catalog.`
    )

  const position =
    isVec3(entry.position) &&
    entry.position.every((v) => Math.abs(v) <= MAX_COORDINATE_MM)
      ? entry.position
      : undefined
  if (position === undefined)
    problems.push(
      `${named}: the position must be three numbers, in millimetres.`
    )

  const rotation =
    isQuat(entry.rotation) && Math.abs(lengthOf(entry.rotation) - 1) < 1e-3
      ? entry.rotation
      : undefined
  if (rotation === undefined)
    problems.push(
      `${named}: the rotation must be a unit quaternion [x, y, z, w].`
    )

  const color =
    typeof entry.color === "string" && COLOR_PATTERN.test(entry.color)
      ? entry.color
      : undefined
  if (color === undefined)
    problems.push(`${named}: the colour must be a hex colour such as #c4cad3.`)

  let lengthMm: number | undefined
  if (entryPart?.kind === "cut") {
    if (
      typeof entry.lengthMm !== "number" ||
      !lengthIsValid(entryPart, entry.lengthMm)
    )
      problems.push(`${named}: the length does not fit this Cut Part.`)
    else lengthMm = entry.lengthMm
  } else if (entry.lengthMm !== undefined) {
    problems.push(`${named}: only a Cut Part has a length.`)
  }

  if (
    problems.length > before ||
    !id ||
    !entryPart ||
    !position ||
    !rotation ||
    !color
  )
    return undefined
  const part: PlacedPart = {
    id,
    catalogId: entryPart.id,
    position,
    rotation,
    color,
  }
  if (lengthMm !== undefined) part.lengthMm = lengthMm
  return part
}

function readConnection(
  entry: unknown,
  label: string,
  parts: ReadonlyMap<string, PlacedPart>,
  problems: string[]
): Connection | undefined {
  if (!isRecord(entry)) {
    problems.push(`${label}: it is not an object.`)
    return undefined
  }
  const before = problems.length
  const id =
    typeof entry.id === "string" && ID_PATTERN.test(entry.id)
      ? entry.id
      : undefined
  if (id === undefined)
    problems.push(
      `${label}: the id must be 1 to 64 letters, digits, "-" or "_".`
    )
  const named = label + (id ? ` (${id})` : "")

  const fastener =
    typeof entry.fastener === "string" ? parts.get(entry.fastener) : undefined
  const host =
    typeof entry.host === "string" ? parts.get(entry.host) : undefined
  if (!fastener)
    problems.push(`${named}: the screw or shaft is not a Part in this file.`)
  if (!host) problems.push(`${named}: the Part it joins is not in this file.`)
  if (fastener && host && fastener.id === host.id)
    problems.push(`${named}: a Part cannot join itself.`)
  const fastenerIsFastener = fastener ? fastenerOf(fastener) : undefined
  if (fastener && !fastenerIsFastener)
    problems.push(`${named}: the first Part is not a screw or shaft.`)

  const hostSnap =
    typeof entry.hostSnap === "string" ? entry.hostSnap : undefined
  if (hostSnap === undefined || (host && !snapIdsOf(host).has(hostSnap)))
    problems.push(`${named}: the Snap Point on the host Part does not exist.`)

  let fastenerSnap: string | undefined
  if (entry.fastenerSnap !== undefined) {
    if (typeof entry.fastenerSnap !== "string")
      problems.push(`${named}: the fastener's Snap Point must be text.`)
    else fastenerSnap = entry.fastenerSnap
  }
  if (fastenerIsFastener?.role === "shaft" && fastenerSnap !== undefined)
    problems.push(`${named}: a shaft does not name a Snap Point on itself.`)
  if (fastenerIsFastener?.role === "screw") {
    if (
      fastenerSnap === undefined ||
      !snapIdsOf(fastener as PlacedPart).has(fastenerSnap)
    )
      problems.push(`${named}: the screw's Snap Point does not exist.`)
  }

  if (
    problems.length > before ||
    !id ||
    !fastener ||
    !host ||
    hostSnap === undefined
  )
    return undefined
  const link: Connection = {
    id,
    fastener: fastener.id,
    host: host.id,
    hostSnap,
  }
  if (fastenerSnap !== undefined) link.fastenerSnap = fastenerSnap
  return link
}

// Catalog lookups and the Snap Point ids a Part has. A Cut Part's ids depend on its length, so
// they come from building it at that length; builds are cached per length.
const snapCache = new Map<string, Set<string>>()

function snapIdsOf(part: PlacedPart): Set<string> {
  const key = `${part.catalogId}@${part.lengthMm ?? ""}`
  const cached = snapCache.get(key)
  if (cached) return cached
  const entry = catalogEntry(part.catalogId)
  let ids: Set<string>
  if (!entry) ids = new Set()
  else if (entry.kind === "model")
    ids = new Set(entry.snapPoints.map((s) => s.id))
  else if (part.lengthMm === undefined) ids = new Set()
  else
    ids = new Set(
      generateCutPart(entry, part.lengthMm).snapPoints.map((s) => s.id)
    )
  snapCache.set(key, ids)
  return ids
}

function catalogEntry(id: string): CatalogPart | undefined {
  return catalog.parts.find((part) => part.id === id)
}

/** Whether a length suits a Cut Part: a whole number of holes, or millimetres for a shaft. */
function lengthIsValid(part: CutPart, mm: number): boolean {
  if (!Number.isFinite(mm)) return false
  if (lengthUnit(part) === "mm") return mm >= MIN_SHAFT_MM && mm <= MAX_SHAFT_MM
  const holes = mm / HOLE_PITCH_MM
  return (
    Math.abs(holes - Math.round(holes)) < 1e-3 &&
    Math.round(holes) >= 1 &&
    Math.round(holes) <= MAX_HOLES
  )
}

function lengthOf(q: Quat | readonly number[]): number {
  return Math.hypot(q[0], q[1], q[2], q[3])
}

/** A Design name cut to one line of printable text, at most 120 characters. */
export function cleanName(name: string): string {
  // Keep it to one line of printable text.
  return Array.from(name, (char) => {
    const code = char.charCodeAt(0)
    return code < 32 || code === 127 ? " " : char
  })
    .join("")
    .trim()
    .slice(0, MAX_NAME_CHARS)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function fail(message: string): ParseResult {
  return { ok: false, problems: [message] }
}
