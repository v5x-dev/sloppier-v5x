import { describe, expect, it } from "vitest"
import { holePositions } from "../src/catalog/hole-rows"

const HALF_INCH = 12.7
const QUARTER_INCH_HOLES = 63.5

describe("holePositions", () => {
  it("places a 0.5 in row so that a 17.5 in channel has 35 holes, half a pitch from each end", () => {
    const positions = holePositions(
      { wall: "web", across: 0, pitch: HALF_INCH, phase: 0 },
      444.5
    )
    expect(positions).toHaveLength(35)
    expect(positions[0]).toBeCloseTo(-215.9, 6)
    expect(positions.at(-1)).toBeCloseTo(215.9, 6)
  })

  it.each([
    [
      "a staggered row (phase one half)",
      { pitch: HALF_INCH, phase: 0.5 },
      34,
      -209.55,
    ],
    ["a 2.5 in row", { pitch: QUARTER_INCH_HOLES, phase: 0.5 }, 6, -158.75],
  ])("counts %s", (_name, row, count, first) => {
    const positions = holePositions({ wall: "web", across: 0, ...row }, 444.5)
    expect(positions).toHaveLength(count)
    expect(positions[0]).toBeCloseTo(first, 6)
  })

  it("keeps every hole inside the length, centred on zero", () => {
    for (const length of [25.4, 101.6, 444.5, 1000]) {
      const positions = holePositions(
        { wall: "side", across: 0, pitch: HALF_INCH, phase: 0 },
        length
      )
      expect(positions.every((p) => Math.abs(p) <= length / 2)).toBe(true)
      expect(positions.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 6)
    }
  })

  it("rejects a length that is not positive", () => {
    expect(() =>
      holePositions({ wall: "web", across: 0, pitch: HALF_INCH, phase: 0 }, 0)
    ).toThrow(RangeError)
  })
})
