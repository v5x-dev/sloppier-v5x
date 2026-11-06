import { describe, expect, it } from "vitest"
import { generateCutPart } from "@/catalog/cut-part"
import { partById } from "@/catalog/catalog"
import type { CutPart } from "@/catalog/types"
import {
  buildPartsList,
  csvCell,
  formatMass,
  partsListCsv,
  unitMassG,
} from "@/design/parts-list"
import type { PlacedPart } from "@/design/model"

const IDENTITY = [0, 0, 0, 1] as const
let next = 0
function part(catalogId: string, lengthMm?: number): PlacedPart {
  next += 1
  return {
    id: `p${next}`,
    catalogId,
    position: [0, 0, 0],
    rotation: IDENTITY,
    color: "#c4cad3",
    ...(lengthMm === undefined ? {} : { lengthMm }),
  }
}

const STEEL_CHANNEL = "channel-1x2x1-steel"
const ALUMINUM_CHANNEL = "channel-1x2x1-aluminum"
const MOTOR = "motor-v5-smart-11w"
const STANDOFF = "standoff-1-2"

describe("grouping the parts", () => {
  it("makes one row for each kind, and one row per length of Cut Part", () => {
    const list = buildPartsList([
      part(STANDOFF),
      part(STANDOFF),
      part(STEEL_CHANNEL, 127),
      part(STEEL_CHANNEL, 127),
      part(STEEL_CHANNEL, 254),
    ])
    expect(list.rows.map((r) => [r.name, r.quantity, r.lengthMm])).toEqual([
      ["1/2 in Standoff", 2, undefined],
      ["1x2x1 Steel C-Channel", 2, 127],
      ["1x2x1 Steel C-Channel", 1, 254],
    ])
  })

  it("gives each Cut Part row the length to cut in total, and its length in holes", () => {
    const list = buildPartsList([
      part(STEEL_CHANNEL, 127),
      part(STEEL_CHANNEL, 127),
      part(STEEL_CHANNEL, 254),
    ])
    const [ten, twenty] = list.rows
    expect(ten.lengthHoles).toBe(10)
    expect(ten.totalLengthMm).toBe(254)
    expect(twenty.lengthHoles).toBe(20)
    expect(twenty.totalLengthMm).toBe(254)
    expect(list.totals.cutLengthMm).toBe(508)
  })

  it("leaves cut lengths empty for fixed Parts", () => {
    const [row] = buildPartsList([part(STANDOFF)]).rows
    expect(row.kind).toBe("fixed")
    expect(row.lengthMm).toBeUndefined()
    expect(row.totalLengthMm).toBeUndefined()
  })

  it("sorts by family in the order the panel shows them", () => {
    const list = buildPartsList([
      part(STEEL_CHANNEL, 127),
      part(STANDOFF),
      part(MOTOR),
    ])
    expect(list.rows.map((r) => r.family)).toEqual([
      "motor",
      "standoff",
      "channel",
    ])
  })

  it("counts an empty Design as nothing", () => {
    expect(buildPartsList([])).toEqual({
      rows: [],
      totals: {
        partCount: 0,
        estimatedMassG: 0,
        unknownMassParts: 0,
        cutLengthMm: 0,
      },
    })
  })
})

describe("weight", () => {
  it("takes a Cut Part's mass from its own build at that length", () => {
    const entry = partById(STEEL_CHANNEL) as CutPart
    const expected = generateCutPart(entry, 127).mass.massG
    expect(expected).toBeGreaterThan(0)
    expect(unitMassG(STEEL_CHANNEL, 127)).toBe(expected)
    const [row] = buildPartsList([
      part(STEEL_CHANNEL, 127),
      part(STEEL_CHANNEL, 127),
    ]).rows
    expect(row.totalMassG).toBeCloseTo((expected ?? 0) * 2, 3)
  })

  it("estimates steel and aluminum Cut Parts, which have a density", () => {
    expect(unitMassG(ALUMINUM_CHANNEL, 127)).not.toBeNull()
    expect(unitMassG("shaft-square-1-4", 127)).not.toBeNull()
  })

  it("uses the catalog's mass for a fixed Part", () => {
    expect(unitMassG(STANDOFF)).toBe(
      partById(STANDOFF).kind === "model" ? partById(STANDOFF).mass.massG : null
    )
  })

  it("leaves out Parts with no mass, and says how many", () => {
    const list = buildPartsList([
      part(MOTOR),
      part(MOTOR),
      part(STANDOFF),
      part(STEEL_CHANNEL, 127),
    ])
    const standoff = partById(STANDOFF)
    const standoffMass =
      standoff.kind === "model" ? (standoff.mass.massG ?? 0) : 0
    const channel =
      generateCutPart(partById(STEEL_CHANNEL) as CutPart, 127).mass.massG ?? 0
    expect(list.totals.unknownMassParts).toBe(2)
    expect(list.totals.estimatedMassG).toBeCloseTo(standoffMass + channel, 3)
    expect(list.rows.find((r) => r.catalogId === MOTOR)?.totalMassG).toBeNull()
  })

  it("reads a figure as grams or kilograms", () => {
    expect(formatMass(412.4)).toBe("412 g")
    expect(formatMass(1240)).toBe("1.24 kg")
  })
})

describe("CSV", () => {
  it("quotes a cell that holds a comma, a quote, or a line break, and doubles the quotes", () => {
    expect(csvCell("plain")).toBe("plain")
    expect(csvCell("a,b")).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"')
    expect(csvCell("carriage\rreturn")).toBe('"carriage\rreturn"')
  })

  it("stops a text cell being read as a formula", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell("+1")).toBe("'+1")
    expect(csvCell("-2")).toBe("'-2")
    expect(csvCell("@sum")).toBe("'@sum")
  })

  it("writes numbers and empty cells as they are", () => {
    expect(csvCell(12.5)).toBe("12.5")
    expect(csvCell(null)).toBe("")
  })

  it("writes one header row, one line per row, and marks unknown masses", () => {
    const text = partsListCsv(
      buildPartsList([part(MOTOR), part(STEEL_CHANNEL, 127), part(STANDOFF)])
    )
    expect(text.startsWith("﻿")).toBe(true)
    const lines = text.slice(1).split("\r\n").filter(Boolean)
    expect(lines[0]).toBe(
      "Part,SKU,Family,Quantity,Cut length each (mm),Cut length each (holes),Total cut length (mm),Unit mass estimate (g),Total mass estimate (g)"
    )
    expect(lines).toHaveLength(4)
    const motorLine = lines.find((l) => l.startsWith("V5 Smart Motor"))
    expect(motorLine?.endsWith(",unknown,unknown")).toBe(true)
  })
})
