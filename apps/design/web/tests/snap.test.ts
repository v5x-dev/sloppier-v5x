import { Quaternion, Vector3 } from "three"
import { describe, expect, it } from "vitest"
import type { SnapPoint } from "../src/catalog/types"
import {
  SnapIndex,
  alignToSnap,
  findSnap,
  toWorldSnap,
  type WorldSnap,
} from "../src/design/snap"

const snap = (over: Partial<SnapPoint> = {}): SnapPoint => ({
  id: "s",
  kind: "hole",
  source: "computed",
  position: [0, 0, 0],
  axis: [0, 1, 0],
  diameterMm: 4,
  ...over,
})

const yaw = (radians: number): [number, number, number, number] => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), radians)
  return [q.x, q.y, q.z, q.w]
}

const target = (position: [number, number, number], axis: [number, number, number]) => ({
  position: new Vector3(...position),
  axis: new Vector3(...axis),
})

function near(a: Vector3, b: Vector3) {
  expect(a.distanceTo(b)).toBeLessThan(1e-9)
}

describe("alignToSnap", () => {
  it("puts two Snap Points at one position, with their axes facing each other", () => {
    const candidate = snap({ position: [10, 2, 0], axis: [0, 1, 0] })
    const to = target([100, 20, -40], [1, 0, 0])
    const pose = alignToSnap(candidate, to, yaw(0.5))
    const placed = toWorldSnap(candidate, pose)
    near(placed.position, to.position)
    near(placed.axis, to.axis.clone().negate())
  })

  it("keeps both points in place when the Part rolls around the shared axis", () => {
    const candidate = snap({ position: [-7, 3, 1], axis: [0, 0, 1] })
    const to = target([5, 60, 5], [0, -1, 0])
    for (const roll of [0.3, 1.1, Math.PI]) {
      const pose = alignToSnap(candidate, to, yaw(0.2), roll)
      const placed = toWorldSnap(candidate, pose)
      near(placed.position, to.position)
      near(placed.axis, to.axis.clone().negate())
    }
  })

  it("can mate with a point facing straight down", () => {
    const candidate = snap({ axis: [0, 0, 1] })
    const to = target([0, 30, 0], [0, 1, 0])
    const pose = alignToSnap(candidate, to, [0, 0, 0, 1])
    near(toWorldSnap(candidate, pose).axis, new Vector3(0, -1, 0))
  })
})

describe("findSnap", () => {
  it("finds nothing when no Snap Point is within the radius", () => {
    const index = new SnapIndex(10)
    index.add({ owner: "a", snapId: "x", ...target([50, 0, 0], [0, 1, 0]) } satisfies WorldSnap)
    const match = findSnap([snap()], { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, index, 10)
    expect(match).toBeNull()
  })

  it("picks the nearest pair within the radius", () => {
    const index = new SnapIndex(10)
    index.add({ owner: "far", snapId: "x", ...target([6, 0, 0], [0, 1, 0]) })
    index.add({ owner: "near", snapId: "y", ...target([3, 0, 0], [0, 1, 0]) })
    const match = findSnap([snap()], { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, index, 10)
    expect(match?.target.owner).toBe("near")
    expect(match?.distance).toBeCloseTo(3, 9)
  })

  it("tries every Snap Point of the Part being placed", () => {
    const index = new SnapIndex(10)
    index.add({ owner: "a", snapId: "x", ...target([40, 0, 0], [0, 1, 0]) })
    const candidates = [snap({ id: "left", position: [-30, 0, 0] }), snap({ id: "right", position: [38, 0, 0] })]
    const match = findSnap(candidates, { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, index, 10)
    expect(match?.candidate.id).toBe("right")
  })

  it("places the candidate on the target with its rotated snap point", () => {
    const index = new SnapIndex(10)
    index.add({ owner: "a", snapId: "x", ...target([0, 20, 0], [0, 0, 1]) })
    const rotated = yaw(Math.PI / 2)
    const candidate = snap({ position: [5, 0, 0], axis: [0, 0, 1] })
    // Turned 90 degrees, the snap point sits at (0, 0, -5) from the Part's position. With the
    // Part at (0, 16, 5), that is (0, 16, 0), 4 mm from the target: inside the radius.
    const pose = { position: [0, 16, 5] as [number, number, number], rotation: rotated }
    const match = findSnap([candidate], pose, index, 10)
    expect(match).not.toBeNull()
    near(toWorldSnap(candidate, match!.pose).position, new Vector3(0, 20, 0))
  })
})

describe("SnapIndex", () => {
  it("returns the same points as a scan of every entry", () => {
    let seed = 7
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 400 - 200
    const index = new SnapIndex(10)
    const all: WorldSnap[] = []
    for (let i = 0; i < 300; i++) {
      const entry: WorldSnap = {
        owner: `p${i}`,
        snapId: "s",
        position: new Vector3(random(), random(), random()),
        axis: new Vector3(0, 1, 0),
      }
      index.add(entry)
      all.push(entry)
    }
    for (let i = 0; i < 40; i++) {
      const at = new Vector3(random(), random(), random())
      const found = new Set(index.near(at, 10).map((e) => e.owner))
      for (const entry of all) {
        const inCube =
          Math.abs(entry.position.x - at.x) <= 10 &&
          Math.abs(entry.position.y - at.y) <= 10 &&
          Math.abs(entry.position.z - at.z) <= 10
        if (inCube) expect(found.has(entry.owner)).toBe(true)
      }
    }
  })
})
