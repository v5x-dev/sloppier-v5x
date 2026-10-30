import { describe, expect, it } from "vitest"
import { pathDuration, pathPoseAt } from "../src/lib/path-animation"

describe("path playback", () => {
  it("holds a wait for 500 ms", () => {
    const points = [
      { x: 0, y: 0, heading: 0 },
      { x: 18, y: 0, heading: 0 },
      { x: 18, y: 0, heading: 0, wait: true },
      { x: 36, y: 0, heading: 0 },
    ]
    expect(pathDuration(points)).toBeCloseTo(2.5)
    expect(pathPoseAt(points, 1.1)).toMatchObject({ x: 18, wait: true })
    expect(pathPoseAt(points, 1.6)?.x).toBeCloseTo(19.8)
  })

  it("uses the slower of movement and turning for each segment", () => {
    expect(
      pathDuration([
        { x: 0, y: 0, heading: 0 },
        { x: 18, y: 0, heading: 180 },
      ])
    ).toBe(2)
  })

  it("sums segment time and skips pose resets", () => {
    const points = [
      { x: 0, y: 0, heading: 0 },
      { x: 18, y: 0, heading: 0 },
      { x: 50, y: 50, heading: 90, start: true },
      { x: 68, y: 50, heading: 90 },
    ]
    expect(pathDuration(points)).toBe(2)
  })

  it("interpolates movement and shortest turns, then loops", () => {
    const points = [
      { x: 0, y: 0, heading: 350 },
      { x: 18, y: 0, heading: 10 },
    ]
    expect(pathPoseAt(points, 0.5)).toMatchObject({ x: 9, y: 0, heading: 360 })
    expect(pathPoseAt(points, 1.5)).toMatchObject({ x: 9, y: 0, heading: 360 })
  })

  it("jumps between pose resets without drawing a transition", () => {
    const points = [
      { x: 0, y: 0, heading: 0 },
      { x: 18, y: 0, heading: 0 },
      { x: 50, y: 50, heading: 90, start: true },
      { x: 68, y: 50, heading: 90 },
    ]
    expect(pathPoseAt(points, 1.5)).toMatchObject({ x: 59, y: 50, heading: 90 })
  })
})
