import { describe, expect, it } from "vitest"
import { binCatalogRows } from "../convex/binCatalogData"
import { screwColorForName } from "../convex/lib/binScrewColors"

describe("screw length colors", () => {
  it.each([
    ['1/4" Star Drive Screw', "yellow", '0.290"'],
    ['3/8" Star Drive Screw', "orange", '0.375"'],
    ['1/2" Star Drive Screw', "red", '0.500"'],
    ['5/8" Star Drive Screw', "bright green", '0.625"'],
    ['3/4" Star Drive Screw', "dark green", '0.750"'],
    ['7/8" Star Drive Screw', "light blue", '0.875"'],
    ['1" Star Drive Screw', "blue", '1.000"'],
    ['1.25" Star Drive Screw', "pink", '1.250"'],
    ['1.5" Star Drive Screw', "magenta", '1.500"'],
    ['1.75" Star Drive Screw', "white", '1.750"'],
    ['2" Star Drive Screw', "black", '2.000"'],
    ['2.25" Star Drive Screw', "tan", '2.250"'],
    ['2.5" Star Drive Screw', "brown", '2.500"'],
  ])("colors %s as %s", (name, color, length) => {
    expect(screwColorForName(name)).toMatchObject({ name: color, length })
  })

  it.each([
    '1/4" Locking Star Drive Screw',
    '0.125" Star Drive Set Screw',
    '1/4" Hex Screw',
    '1/2" Thumbscrew',
    "Lead Screw",
    '2.75" Star Drive Screw',
    "Star Drive Screw",
  ])("leaves %s uncolored", (name) => {
    expect(screwColorForName(name)).toBeNull()
  })

  it("colors every plain star drive screw in the catalog", () => {
    const starDrive = binCatalogRows.filter(
      (row) =>
        /Star Drive Screw$/.test(row.name) &&
        !/Locking|Set Screw/.test(row.name)
    )
    expect(starDrive).toHaveLength(13)
    for (const row of starDrive) {
      expect(screwColorForName(row.name), row.name).not.toBeNull()
    }
  })
})
