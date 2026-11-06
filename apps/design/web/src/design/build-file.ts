// Imports a Protobot `.Build` file: a robot saved in the Protobot desktop app. Nothing here
// is a copy of Protobot's code. It reads the saved file as data, for interoperability.
//
// The shape this reads is the one the team reported. It has not been checked against a
// real saved file yet, so every conversion here is marked unverified until build-mapping.ts
// holds checked entries:
//
//   { "name", "fileName", "parts": [{ "xPos","yPos","zPos","xRot","yRot","zRot",
//     "rColor","gColor","bColor","states","partId" }], "camera", "lastWriteTime", "version" }
//
// Positions are Unity units (left-handed, Y up). Rotations are Unity Euler degrees, applied
// Z first, then X, then Y. Colours are 0 to 1. The conversion turns these into a Design:
// right-handed, Y up, millimetres, with each Part's origin at its bounding-box centre.

import { Euler, Matrix4, Quaternion, Vector3 } from "three"
import type { Vec3 } from "@/catalog/types"
import { catalog } from "@/catalog/catalog"
import { connectionsForSelection } from "./connect"
import type { Connection } from "./connections"
import {
  cleanName,
  parseDesignFile,
  designFileFrom,
  designFileText,
  type ParsedDesign,
} from "./design-file"
import type { BuildMapping, Calibration } from "./build-mapping"
import { BUILD_MAPPINGS } from "./build-mapping"
import type { PlacedPart, Quat } from "./model"

export const BUILD_FILE_EXTENSION = ".Build"
/** The same size limit as a Design file. */
export const MAX_BUILD_FILE_CHARS = 5_000_000
export const MAX_BUILD_PARTS = 5_000
const MAX_UNITS = 100_000
const MAX_ANGLE_DEG = 1_000_000
const MAX_PART_ID_CHARS = 200
const MAX_STATES_CHARS = 1_000
const DEG = Math.PI / 180

/** A Part as the file gives it, after its fields are checked. */
export type BuildPart = {
  /** Its place in the file's parts list, counted from 1. */
  number: number
  partId: string
  position: Vec3
  /** Unity Euler angles, in degrees. */
  rotation: Vec3
  /** A hex colour, #rrggbb. */
  color: string
  states?: string
}

/** A part entry that could not be read, and why. */
export type RejectedPart = {
  number: number
  partId?: string
  reason: string
}

export type BuildParseResult =
  | { ok: true; name: string; parts: BuildPart[]; rejected: RejectedPart[] }
  | { ok: false; problems: string[] }

/**
 * Reads a `.Build` file. A file that is not a robot at all is refused. A part entry that is
 * malformed is set aside with its reason, and the rest of the file is still read. Nothing is
 * changed by this; `planBuildImport` decides what can be imported.
 */
export function parseBuildFile(text: string): BuildParseResult {
  if (text.length > MAX_BUILD_FILE_CHARS)
    return fail("The file is too large to be a Protobot Build file.")
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return fail("The file is not valid JSON.")
  }
  if (!isRecord(raw)) return fail("The file does not hold a Protobot robot.")
  if (!Array.isArray(raw.parts)) return fail("The file has no list of parts.")
  if (raw.parts.length > MAX_BUILD_PARTS)
    return fail(`A Build file holds at most ${MAX_BUILD_PARTS} parts.`)

  const name = typeof raw.name === "string" ? cleanName(raw.name) : ""
  const parts: BuildPart[] = []
  const rejected: RejectedPart[] = []
  raw.parts.forEach((entry: unknown, index: number) => {
    const read = readBuildPart(entry, index + 1)
    if (read.ok) parts.push(read.part)
    else rejected.push(read.rejected)
  })
  return { ok: true, name: name || "Imported Protobot Design", parts, rejected }
}

type PartRead =
  { ok: true; part: BuildPart } | { ok: false; rejected: RejectedPart }

function readBuildPart(entry: unknown, number: number): PartRead {
  if (!isRecord(entry)) return reject(number, undefined, "it is not an object")

  const partId = entry.partId
  if (
    typeof partId !== "string" ||
    partId.trim() === "" ||
    partId.length > MAX_PART_ID_CHARS
  )
    return reject(number, undefined, "it has no part id")

  const problems: string[] = []
  const position = readVec(entry, ["xPos", "yPos", "zPos"], MAX_UNITS, problems)
  const rotation = readVec(
    entry,
    ["xRot", "yRot", "zRot"],
    MAX_ANGLE_DEG,
    problems
  )
  const colour = readVec(entry, ["rColor", "gColor", "bColor"], 1, problems, 0)
  let states: string | undefined
  if (entry.states !== undefined && entry.states !== null) {
    if (
      typeof entry.states !== "string" ||
      entry.states.length > MAX_STATES_CHARS
    )
      problems.push("states must be text")
    else states = entry.states
  }
  if (problems.length > 0 || !position || !rotation || !colour)
    return reject(number, partId, problems.join("; ") || "a field is missing")

  return {
    ok: true,
    part: {
      number,
      partId,
      position,
      rotation,
      color: hexColour(colour),
      ...(states !== undefined ? { states } : {}),
    },
  }
}

/** Three numbers from named fields, each finite and within `limit` in size, or 0 to `limit`. */
function readVec(
  entry: Record<string, unknown>,
  fields: string[],
  limit: number,
  problems: string[],
  floor?: number
): Vec3 | undefined {
  const values: number[] = []
  for (const field of fields) {
    const value = entry[field]
    const ok =
      typeof value === "number" &&
      Number.isFinite(value) &&
      (floor === undefined
        ? Math.abs(value) <= limit
        : value >= floor && value <= limit)
    if (!ok) {
      problems.push(
        floor === undefined
          ? `${field} must be a number between -${limit} and ${limit}`
          : `${field} must be a number from 0 to 1`
      )
      return undefined
    }
    values.push(value as number)
  }
  return [values[0], values[1], values[2]]
}

function hexColour([r, g, b]: Vec3): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`
}

// ---- Conversion ------------------------------------------------------------

const X_AXIS = new Vector3(1, 0, 0)
const Y_AXIS = new Vector3(0, 1, 0)
const Z_AXIS = new Vector3(0, 0, 1)

/**
 * The rotation a Unity Euler triple describes, as a quaternion in Unity's own axes. Unity
 * applies Z first, then X, then Y, so the product is Y * X * Z.
 */
export function unityRotation(eulerDeg: Vec3): Quaternion {
  const [x, y, z] = eulerDeg.map((d) => d * DEG)
  return new Quaternion()
    .setFromAxisAngle(Y_AXIS, y)
    .multiply(new Quaternion().setFromAxisAngle(X_AXIS, x))
    .multiply(new Quaternion().setFromAxisAngle(Z_AXIS, z))
}

/**
 * Turns a rotation from left-handed to right-handed axes by mirroring across the YZ plane:
 * the rotation matrix becomes S * R * S, with S = diag(-1, 1, 1). Only the entries that touch
 * X on one side change sign.
 */
export function mirrorRotation(q: Quaternion): Quaternion {
  const m = new Matrix4().makeRotationFromQuaternion(q)
  const e = m.elements // column-major: element (row r, column c) is e[c * 4 + r]
  for (const i of [1, 2, 4, 8]) e[i] = -e[i]
  return new Quaternion().setFromRotationMatrix(m)
}

/**
 * The Design pose of a Protobot Part. The Protobot pivot is placed at the Part's pivot, so
 * the Part's bounding-box centre is found by taking the pivot's offset off the pivot's
 * position, rotated with the Part.
 */
export function designPose(
  position: Vec3,
  rotation: Vec3,
  calibration: Calibration
): { position: Vec3; rotation: Quat } {
  const unitsToMm = calibration.unitsToMm
  const pivotWorld = new Vector3(
    -position[0] * unitsToMm,
    position[1] * unitsToMm,
    position[2] * unitsToMm
  )
  const model = new Quaternion().setFromEuler(
    new Euler(...(calibration.modelTurnDeg.map((d) => d * DEG) as Vec3), "XYZ")
  )
  const turn = mirrorRotation(unityRotation(rotation)).multiply(model)
  const centre = pivotWorld.sub(
    new Vector3(...calibration.pivotMm).applyQuaternion(turn)
  )
  return {
    position: [centre.x, centre.y, centre.z],
    rotation: [turn.x, turn.y, turn.z, turn.w],
  }
}

// ---- Planning --------------------------------------------------------------

export type SkippedPart = {
  number: number
  partId: string
  reason: string
}

export type BuildPlan = {
  name: string
  /** The Parts that can be imported, in the Design's frame. */
  parts: PlacedPart[]
  /** Parts that cannot be imported, each with its reason. */
  skipped: SkippedPart[]
  /** Entries that could not be read at all. */
  rejected: RejectedPart[]
  /** Whether every mapping that was used is checked against a real file. */
  verified: boolean
}

/**
 * Decides what can be imported: each readable part is looked up by its part id in the
 * mapping table. A part with no mapping is skipped with the reason, and so is a mapping that
 * names a Catalog Part that does not exist. The mapping table is a parameter so tests can
 * use their own; the app passes the checked table.
 */
export function planBuildImport(
  parsed: Extract<BuildParseResult, { ok: true }>,
  mappings: readonly BuildMapping[] = BUILD_MAPPINGS
): BuildPlan {
  const byPartId = new Map<string, BuildMapping>()
  for (const mapping of mappings) byPartId.set(mapping.partId, mapping)

  const parts: PlacedPart[] = []
  const skipped: SkippedPart[] = []
  const used = new Set<BuildMapping>()
  for (const part of parsed.parts) {
    const mapping = byPartId.get(part.partId)
    if (!mapping) {
      skipped.push({
        number: part.number,
        partId: part.partId,
        reason: "no Catalog Part is mapped to this Protobot part yet",
      })
      continue
    }
    const entry = catalog.parts.find((p) => p.id === mapping.catalogId)
    if (!entry) {
      skipped.push({
        number: part.number,
        partId: part.partId,
        reason: `its mapping names "${mapping.catalogId}", which is not in the catalog`,
      })
      continue
    }
    used.add(mapping)
    const pose = designPose(part.position, part.rotation, mapping.calibration)
    const placed: PlacedPart = {
      id: `b${part.number}`,
      catalogId: entry.id,
      position: pose.position,
      rotation: pose.rotation,
      color: part.color,
    }
    if (mapping.lengthMm !== undefined && entry.kind === "cut")
      placed.lengthMm = mapping.lengthMm
    parts.push(placed)
  }
  return {
    name: parsed.name,
    parts,
    skipped,
    rejected: parsed.rejected,
    verified: used.size > 0 && [...used].every((m) => m.verified),
  }
}

/**
 * The Design an import makes from a plan. Connections come from aligned Snap Points, by the
 * same rules as placing a Part. The result is checked by the Design file reader, so an
 * imported Design is never one the app would refuse to open. Returns the problems if not.
 */
export function designFromPlan(
  plan: BuildPlan
): { ok: true; design: ParsedDesign } | { ok: false; problems: string[] } {
  const unknown = plan.parts.find(
    (p) => !catalog.parts.some((entry) => entry.id === p.catalogId)
  )
  if (unknown)
    return {
      ok: false,
      problems: [`"${unknown.catalogId}" is not a Part in this app's catalog.`],
    }
  const connections: Connection[] = connectionsForSelection(
    plan.parts,
    new Set(plan.parts.map((p) => p.id))
  ).map((draft, index) => ({ id: `c${index + 1}`, ...draft }))
  const file = designFileFrom(plan.name, plan.parts, connections)
  const checked = parseDesignFile(designFileText(file))
  if (!checked.ok) return { ok: false, problems: checked.problems }
  return { ok: true, design: checked.design }
}

function reject(
  number: number,
  partId: string | undefined,
  reason: string
): PartRead {
  return { ok: false, rejected: { number, partId, reason } }
}

function fail(message: string): BuildParseResult {
  return { ok: false, problems: [message] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
