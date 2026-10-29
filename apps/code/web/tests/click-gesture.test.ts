import { describe, expect, it } from "vitest"
import { isClickGesture } from "../src/lib/click-gesture"

describe("click gesture", () => {
  it("counts a press released in place, allowing a few pixels of jitter", () => {
    expect(isClickGesture({ x: 100, y: 200 }, { x: 100, y: 200 })).toBe(true)
    expect(isClickGesture({ x: 100, y: 200 }, { x: 103, y: 202 })).toBe(true)
  })
  it("does not count a drag across the text as a click", () => {
    expect(isClickGesture({ x: 100, y: 200 }, { x: 140, y: 230 })).toBe(false)
    expect(isClickGesture({ x: 100, y: 200 }, { x: 105, y: 200 })).toBe(false)
  })
})
