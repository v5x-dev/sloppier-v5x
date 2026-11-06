// The parts list: how many of each Part a Design needs, the length of stock each Cut Part
// needs in total, and an estimate of the weight. Pure functions, so the grouping, the weights,
// and the CSV can be tested without a page.
//
// A Cut Part's row gives the length of each piece and the total length the team must cut. It
// does not work out how many full sticks to buy: stock lengths and offcuts are the team's call.
// Weight is an estimate. A Part with no mass in the catalog (a motor, for now) is left out of
// the total, and the list says how many were left out.

import { catalog } from "@/catalog/catalog"
import { generateCutPart } from "@/catalog/cut-part"
import type { CatalogPart, CutPart } from "@/catalog/types"
import { FAMILY_ORDER, FAMILY_LABELS } from "./catalog-view"
import { lengthUnit, mmToHoles } from "./cut-length"
import type { PlacedPart } from "./model"

export type PartsListRow = {
  key: string
  catalogId: string
  name: string
  sku: string
  family: string
  familyLabel: string
  kind: "fixed" | "cut"
  quantity: number
  /** Cut Parts only: the length of one piece, in millimetres. */
  lengthMm?: number
  /** Cut Parts only: the same length in holes, for channels and angles. */
  lengthHoles?: number
  /** Cut Parts only: the length to cut for this row, in millimetres. */
  totalLengthMm?: number
  /** Grams for one Part, or null when the catalog has no mass for it. */
  unitMassG: number | null
  /** Grams for every Part in this row, or null when the mass of one is unknown. */
  totalMassG: number | null
}

export type PartsListTotals = {
  partCount: number
  /** Estimated grams for every Part with a known mass. */
  estimatedMassG: number
  /** Parts left out of the estimate because the catalog has no mass for them. */
  unknownMassParts: number
  /** Total Cut Part length to cut, in millimetres, across every channel, angle, and shaft. */
  cutLengthMm: number
}

export type PartsList = { rows: PartsListRow[]; totals: PartsListTotals }

const round = (x: number, places: number) => {
  const scale = 10 ** places
  return Math.round(x * scale) / scale
}

/** The catalog entry for an id, or undefined when this app does not know it. */
function entryFor(catalogId: string): CatalogPart | undefined {
  return catalog.parts.find((part) => part.id === catalogId)
}

/**
 * The mass of one Part, in grams, or null when it is not known. A fixed Part uses the
 * catalog's mass. A Cut Part is built at its length and uses that build's mass.
 */
export function unitMassG(catalogId: string, lengthMm?: number): number | null {
  const entry = entryFor(catalogId)
  if (!entry) return null
  if (entry.kind === "model") return entry.mass.massG
  if (lengthMm === undefined) return null
  return generateCutPart(entry, lengthMm).mass.massG
}

/** Groups Parts by kind and, for Cut Parts, by length. Each group is one row. */
export function buildPartsList(parts: readonly PlacedPart[]): PartsList {
  const groups = new Map<
    string,
    { catalogId: string; lengthMm?: number; quantity: number }
  >()
  for (const part of parts) {
    const key =
      part.lengthMm === undefined
        ? part.catalogId
        : `${part.catalogId}@${part.lengthMm}`
    const group = groups.get(key)
    if (group) group.quantity += 1
    else
      groups.set(key, {
        catalogId: part.catalogId,
        lengthMm: part.lengthMm,
        quantity: 1,
      })
  }

  const rows: PartsListRow[] = [...groups.entries()].map(([key, group]) => {
    const entry = entryFor(group.catalogId)
    const unit = unitMassG(group.catalogId, group.lengthMm)
    const family = entry?.family ?? "unknown"
    const row: PartsListRow = {
      key,
      catalogId: group.catalogId,
      name: entry?.name ?? group.catalogId,
      sku: entry?.sku?.value ?? "",
      family,
      familyLabel: FAMILY_LABELS[family] ?? family,
      kind: entry?.kind === "cut" ? "cut" : "fixed",
      quantity: group.quantity,
      unitMassG: unit === null ? null : round(unit, 3),
      totalMassG: unit === null ? null : round(unit * group.quantity, 3),
    }
    if (group.lengthMm !== undefined && entry?.kind === "cut") {
      row.lengthMm = group.lengthMm
      row.lengthHoles = cutLengthInUnits(entry, group.lengthMm)
      row.totalLengthMm = round(group.lengthMm * group.quantity, 3)
    }
    return row
  })

  rows.sort(
    (a, b) =>
      familyRank(a.family) - familyRank(b.family) ||
      a.name.localeCompare(b.name) ||
      (a.lengthMm ?? 0) - (b.lengthMm ?? 0)
  )

  const totals: PartsListTotals = {
    partCount: parts.length,
    estimatedMassG: 0,
    unknownMassParts: 0,
    cutLengthMm: 0,
  }
  for (const row of rows) {
    if (row.totalMassG === null) totals.unknownMassParts += row.quantity
    else totals.estimatedMassG += row.totalMassG
    if (row.totalLengthMm !== undefined) totals.cutLengthMm += row.totalLengthMm
  }
  totals.estimatedMassG = round(totals.estimatedMassG, 3)
  totals.cutLengthMm = round(totals.cutLengthMm, 3)
  return { rows, totals }
}

/** Holes for a channel or angle, whole millimetres for a shaft. */
function cutLengthInUnits(
  entry: CutPart,
  lengthMm: number
): number | undefined {
  if (lengthUnit(entry) === "holes") return mmToHoles(lengthMm)
  return undefined
}

function familyRank(family: string): number {
  const index = (FAMILY_ORDER as readonly string[]).indexOf(family)
  return index === -1 ? FAMILY_ORDER.length : index
}

/** Grams as a readable weight, such as "412 g" or "1.24 kg". */
export function formatMass(grams: number): string {
  if (grams >= 1000) return `${(grams / 1000).toFixed(2)} kg`
  return `${Math.round(grams)} g`
}

/** A length in millimetres, with at most one decimal. */
export function formatMm(mm: number): string {
  return `${round(mm, 1)} mm`
}

export const CSV_HEADERS = [
  "Part",
  "SKU",
  "Family",
  "Quantity",
  "Cut length each (mm)",
  "Cut length each (holes)",
  "Total cut length (mm)",
  "Unit mass estimate (g)",
  "Total mass estimate (g)",
] as const

type CsvCell = string | number | null

/**
 * One CSV cell. Text is quoted when it holds a comma, quote, or line break, and a quote inside
 * it is doubled. Text that a spreadsheet would read as a formula gets a leading apostrophe, so
 * a part name cannot run as code when the file is opened. Numbers are written as they are.
 */
export function csvCell(value: CsvCell): string {
  if (value === null) return ""
  if (typeof value === "number") return String(value)
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

/**
 * The parts list as CSV. A byte-order mark at the start lets spreadsheets read the text as
 * UTF-8. Missing values, such as the cut length of a fixed Part, are empty cells, and an
 * unknown mass is written as "unknown", not as a figure.
 */
export function partsListCsv(list: PartsList): string {
  const lines: CsvCell[][] = [[...CSV_HEADERS]]
  for (const row of list.rows) {
    lines.push([
      row.name,
      row.sku,
      row.familyLabel,
      row.quantity,
      row.lengthMm ?? null,
      row.lengthHoles === undefined ? null : round(row.lengthHoles, 0),
      row.totalLengthMm ?? null,
      row.unitMassG ?? "unknown",
      row.totalMassG ?? "unknown",
    ])
  }
  return (
    "﻿" +
    lines.map((cells) => cells.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  )
}
