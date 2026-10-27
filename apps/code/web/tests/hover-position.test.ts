import { describe, expect, it } from "vitest"
import { hoverPosition } from "../src/lib/hover-position"

describe("hover card placement", () => {
  it("anchors above the symbol when the content fits", () => {
    expect(
      hoverPosition({ left: 100, top: 300, bottom: 320 }, 120, 1000, 800)
    ).toMatchObject({ left: 100, bottom: 504, maxHeight: 288 })
  })
  it("falls below near the top of the viewport", () => {
    expect(
      hoverPosition({ left: 100, top: 30, bottom: 50 }, 200, 1000, 800)
    ).toMatchObject({ top: 54, maxHeight: 360 })
  })
  it("uses the larger side and constrains tall documentation", () => {
    expect(
      hoverPosition({ left: 100, top: 250, bottom: 270 }, 800, 1000, 400)
    ).toMatchObject({ bottom: 154, maxHeight: 238 })
  })
  it("keeps the card inside narrow viewports and the right edge", () => {
    expect(
      hoverPosition({ left: 990, top: 300, bottom: 320 }, 100, 1000, 800).left
    ).toBe(552)
    expect(
      hoverPosition({ left: 290, top: 300, bottom: 320 }, 100, 300, 800)
    ).toMatchObject({ left: 8, width: 284 })
  })
})
