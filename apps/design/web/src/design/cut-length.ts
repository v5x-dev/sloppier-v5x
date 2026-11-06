// Cut Part lengths. Channels and angles are chosen in holes: one hole is one 0.5 in pitch,
// 12.7 mm, so a stock 35-hole channel is 444.5 mm. Shafts are chosen in millimetres.

import type { CutPart } from "@/catalog/types"
import { stockLengthMm } from "./library"

export const HOLE_PITCH_MM = 12.7
export const MIN_HOLES = 1
export const MAX_HOLES = 70
export const MIN_SHAFT_MM = 1
export const MAX_SHAFT_MM = 1000

/** Whether a Cut Part is measured in holes (channels, angles) or in millimetres (shafts). */
export function lengthUnit(part: CutPart): "holes" | "mm" {
  return part.family === "shaft" ? "mm" : "holes"
}

export function holesToMm(holes: number): number {
  return round(holes * HOLE_PITCH_MM)
}

export function mmToHoles(mm: number): number {
  return round(mm / HOLE_PITCH_MM)
}

/** The stock length in the unit the team picks it in. */
export function stockLength(part: CutPart): {
  value: number
  unit: "holes" | "mm"
} {
  const mm = stockLengthMm(part)
  return lengthUnit(part) === "holes"
    ? { value: Math.round(mm / HOLE_PITCH_MM), unit: "holes" }
    : { value: round(mm), unit: "mm" }
}

/** Turns what the team typed into a length in millimetres, or an error to show. */
export function lengthFromInput(
  part: CutPart,
  input: number
): { ok: true; lengthMm: number } | { ok: false; message: string } {
  if (!Number.isFinite(input)) return { ok: false, message: "Enter a number." }
  if (lengthUnit(part) === "holes") {
    if (!Number.isInteger(input))
      return { ok: false, message: "Use a whole number of holes." }
    if (input < MIN_HOLES || input > MAX_HOLES)
      return { ok: false, message: `Use ${MIN_HOLES} to ${MAX_HOLES} holes.` }
    return { ok: true, lengthMm: holesToMm(input) }
  }
  if (input < MIN_SHAFT_MM || input > MAX_SHAFT_MM)
    return { ok: false, message: `Use ${MIN_SHAFT_MM} to ${MAX_SHAFT_MM} mm.` }
  return { ok: true, lengthMm: round(input) }
}

const round = (x: number) => Math.round(x * 1e6) / 1e6
