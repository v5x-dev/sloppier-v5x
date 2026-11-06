import { describe, expect, it } from "vitest"
import { Vector3 } from "three"
import {
  angleOnRing,
  closestOnAxis,
  rayPlaneHit,
} from "../src/viewport/gizmo-math"

describe("reading a drag from the pointer's ray", () => {
  it("finds where along an axis a ray passes closest to it", () => {
    // A ray down from above, at x = 30, meets the X axis at 30.
    const ray = {
      origin: new Vector3(30, 500, 0),
      direction: new Vector3(0, -1, 0),
    }
    expect(
      closestOnAxis(ray, new Vector3(0, 0, 0), new Vector3(1, 0, 0))
    ).toBeCloseTo(30, 9)
  })

  it("measures along a turned axis as well", () => {
    const ray = {
      origin: new Vector3(0, 0, 40),
      direction: new Vector3(0, -1, 0),
    }
    expect(
      closestOnAxis(ray, new Vector3(0, 0, 0), new Vector3(0, 0, 2))
    ).toBeCloseTo(40, 9)
  })

  it("hits a plane where the ray crosses it", () => {
    const ray = {
      origin: new Vector3(5, 100, 7),
      direction: new Vector3(0, -1, 0),
    }
    const hit = rayPlaneHit(ray, new Vector3(0, 0, 0), new Vector3(0, 1, 0))
    expect(hit?.x).toBeCloseTo(5, 9)
    expect(hit?.z).toBeCloseTo(7, 9)
  })

  it("misses a plane the ray is parallel to, or that is behind it", () => {
    const parallel = {
      origin: new Vector3(0, 1, 0),
      direction: new Vector3(1, 0, 0),
    }
    expect(
      rayPlaneHit(parallel, new Vector3(0, 0, 0), new Vector3(0, 1, 0))
    ).toBeNull()
    const behind = {
      origin: new Vector3(0, 100, 0),
      direction: new Vector3(0, 1, 0),
    }
    expect(
      rayPlaneHit(behind, new Vector3(0, 0, 0), new Vector3(0, 1, 0))
    ).toBeNull()
  })

  it("reads a quarter turn on a ring as a quarter turn", () => {
    const angle = angleOnRing(
      new Vector3(0, 0, 10),
      new Vector3(0, 0, 0),
      new Vector3(0, 1, 0),
      new Vector3(1, 0, 0)
    )
    expect(Math.abs(angle)).toBeCloseTo(Math.PI / 2, 9)
  })
})
