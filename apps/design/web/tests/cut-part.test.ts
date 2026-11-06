import { describe, expect, it } from "vitest"
import { generateCutPart, cutHoles } from "../src/catalog/cut-part"
import { partById } from "../src/catalog/catalog"
import type { CutPart } from "../src/catalog/types"

const channel = partById("channel-1x2x1-aluminum") as CutPart
const angle = partById("angle-1x1-aluminum") as CutPart
const shaft = partById("shaft-square-1-4") as CutPart

/** Bounds of a Part-frame geometry: [min, max] per axis. */
function bounds(positions: Float32Array): [number[], number[]] {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k])
      max[k] = Math.max(max[k], positions[i + k])
    }
  return [min, max]
}

/** Signed volume of a closed, outward-wound triangle mesh. */
function signedVolume(positions: Float32Array): number {
  let v = 0
  for (let i = 0; i < positions.length; i += 9) {
    const [ax, ay, az] = [positions[i], positions[i + 1], positions[i + 2]]
    const [bx, by, bz] = [positions[i + 3], positions[i + 4], positions[i + 5]]
    const [cx, cy, cz] = [positions[i + 6], positions[i + 7], positions[i + 8]]
    v +=
      (ax * (by * cz - bz * cy) -
        ay * (bx * cz - bz * cx) +
        az * (bx * cy - by * cx)) /
      6
  }
  return Math.abs(v)
}

describe("Cut Part geometry", () => {
  it("makes a 444.5 mm channel: 17.5 in long, 1 in wide, 0.55 in deep, with the web on top", () => {
    const { geometry } = generateCutPart(channel, 444.5)
    const [min, max] = bounds(geometry.positions)
    expect(max[0] - min[0]).toBeCloseTo(444.5, 4)
    expect(max[1] - min[1]).toBeCloseTo(13.97, 4)
    expect(max[2] - min[2]).toBeCloseTo(25.4, 4)
    expect(max[1]).toBeCloseTo(6.985, 4)
  })

  it("keeps the generated mesh within its triangle budget", () => {
    const { geometry } = generateCutPart(channel, 444.5)
    expect(geometry.triangles).toBeLessThan(4000)
    expect(geometry.positions.length).toBe(geometry.triangles * 9)
  })

  it("is closed: its signed volume is the analytic volume plus the corner overlaps, so holes are cut where they should be", () => {
    // Plates that meet at a corner overlap by t x t along the length: twice for the
    // channel (web with each side), once for the angle. The mesh keeps each plate whole,
    // so those corners count twice, and the overlapping faces are hidden inside the Part.
    const t = 1.5875
    const cases: Array<[CutPart, number]> = [
      [channel, 2 * t * t * 444.5],
      [angle, t * t * 444.5],
    ]
    for (const [part, overlap] of cases) {
      const generated = generateCutPart(part, 444.5)
      expect(signedVolume(generated.geometry.positions)).toBeCloseTo(
        generated.volumeMm3 + overlap,
        -1
      )
    }
  })

  it("makes a square shaft whose volume is its section times its length", () => {
    const { geometry, volumeMm3, snapPoints } = generateCutPart(shaft, 100)
    expect(volumeMm3).toBeCloseTo(6.35 * 6.35 * 100, 6)
    expect(signedVolume(geometry.positions)).toBeCloseTo(volumeMm3, 0)
    // A shaft has no holes, only a pin at each end, so it can be set into an opening.
    expect(snapPoints.map((p) => [p.kind, p.position[0]])).toEqual([
      ["pin", -50],
      ["pin", 50],
    ])
  })

  it("rejects a length that is not positive", () => {
    expect(() => generateCutPart(channel, -1)).toThrow(RangeError)
  })
})

describe("Cut Part hole positions", () => {
  it("counts the channel's holes: 35 + 34 + 35 + 6 + 6 in the web, 41 in each side", () => {
    const holes = cutHoles(channel, 444.5)
    expect(holes.filter((h) => h.wall === "web")).toHaveLength(116)
    expect(holes.filter((h) => h.wall === "side")).toHaveLength(82)
  })

  it("gives each hole one Snap Point on the outside of its wall", () => {
    const { snapPoints } = generateCutPart(channel, 444.5)
    expect(snapPoints).toHaveLength(198)
    const web = snapPoints.filter((s) => s.id.startsWith("hole-web"))
    expect(web.every((s) => s.axis[1] === 1)).toBe(true)
    expect(snapPoints.every((s) => s.diameterMm === 4.5)).toBe(true)
  })

  it("puts the first web hole 6.35 mm from the end, on the 0.5 in pitch", () => {
    const xs = cutHoles(channel, 444.5)
      .filter((h) => h.wall === "web" && Math.abs(h.across + 6.35) < 0.01)
      .map((h) => h.x)
    expect(xs).toHaveLength(35)
    expect(Math.min(...xs)).toBeCloseTo(-215.9, 6)
    expect(xs[1] - xs[0]).toBeCloseTo(12.7, 6)
  })

  it("gives the angle 41 holes per leg, on each leg's outer side", () => {
    const { snapPoints } = generateCutPart(angle, 444.5)
    expect(snapPoints).toHaveLength(82)
    expect(snapPoints.filter((s) => s.id.startsWith("hole-web"))).toHaveLength(
      41
    )
  })
})

describe("Cut Part mass", () => {
  it("estimates an aluminum channel from its volume and 2.7 g/cm3, with the holes removed", () => {
    const { mass, volumeMm3 } = generateCutPart(channel, 444.5)
    expect(mass.densityGPerCm3).toBe(2.7)
    expect(mass.massG).toBeCloseTo((volumeMm3 / 1000) * 2.7, 2)
    expect(mass.massG).toBeGreaterThan(60)
    expect(mass.massG).toBeLessThan(100)
  })
})
