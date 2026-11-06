import { describe, expect, it } from "vitest"
import { Quaternion, Vector3 } from "three"
import type { ModelPart, SnapPoint, Vec3 } from "../src/catalog/types"
import { restingQuat } from "../src/design/orientation"
import {
  SnapIndex,
  findSnap,
  toWorldSnap,
  type WorldSnap,
} from "../src/design/snap"
import {
  freePose,
  placementPose,
  START_TURN,
  type PlacementShape,
} from "../src/design/placement"
import {
  lowestOffset,
  lowestWorldY,
  type Bounds,
} from "../src/design/transform"
import { modelSizeInPartFrame, partShape } from "../src/design/library"
import { catalog } from "../src/catalog/catalog"

const bounds = (size: Vec3): Bounds => ({
  lo: [-size[0] / 2, -size[1] / 2, -size[2] / 2],
  hi: [size[0] / 2, size[1] / 2, size[2] / 2],
})

/** The height a Part stands at once it is at rest: the span of its turned bounds. */
function restingHeight(family: string, size: Vec3): number {
  const rotation = restingQuat(family, size)
  return (
    upperOffset(rotation, bounds(size)) - lowestOffset(rotation, bounds(size))
  )
}

function upperOffset(
  rotation: readonly [number, number, number, number],
  b: Bounds
): number {
  // The highest corner, measured the same way as lowestOffset.
  const q = new Quaternion(...rotation)
  let highest = -Infinity
  for (const x of [b.lo[0], b.hi[0]])
    for (const y of [b.lo[1], b.hi[1]])
      for (const z of [b.lo[2], b.hi[2]]) {
        const corner = new Vector3(x, y, z).applyQuaternion(q)
        if (corner.y > highest) highest = corner.y
      }
  return highest
}

const model = (id: string): ModelPart => {
  const part = catalog.parts.find((p) => p.id === id)
  if (!part || part.kind !== "model") throw new Error(`no model ${id}`)
  return part
}

describe("how a Part rests on the ground", () => {
  it("stands a standoff on its end", () => {
    const standoff = model("standoff-1")
    const size = modelSizeInPartFrame(standoff)
    expect(restingHeight("standoff", size)).toBeCloseTo(25.4, 3)
  })

  it("lies a plate flat, so its thin side is the height", () => {
    const plate = model("plate-5x15-steel")
    const size = modelSizeInPartFrame(plate)
    expect(restingHeight("plate", size)).toBeCloseTo(1.168, 3)
  })

  it("lies a screw on its side, with its length level", () => {
    const screw = model("screw-6-32-1-4")
    const size = modelSizeInPartFrame(screw)
    expect(restingHeight("screw", size)).toBeCloseTo(6.591, 3)
  })

  it("keeps a wheel upright, so its diameter is the height", () => {
    const wheel = model("wheel-normal-2-75")
    const size = modelSizeInPartFrame(wheel)
    expect(restingHeight("wheel", size)).toBeCloseTo(size[1], 6)
  })

  it("puts every Part's lowest point on the ground when placed free", () => {
    for (const id of [
      "standoff-1",
      "plate-5x15-steel",
      "screw-6-32-1-4",
      "wheel-normal-2-75",
      "motor-v5-smart-11w",
    ]) {
      const shape = partShape({ catalogId: id })
      const pose = freePose(shape, { x: 0, z: 0 }, START_TURN)
      expect(lowestWorldY(pose, shape.bounds)).toBeCloseTo(0, 6)
    }
  })

  it("keeps a free Part on the ground after a quarter turn", () => {
    const shape = partShape({
      catalogId: "channel-1x2x1-aluminum",
      lengthMm: 444.5,
    })
    for (const quarterTurns of [0, 1, 2, 3]) {
      const pose = freePose(shape, { x: 0, z: 0 }, { quarterTurns, roll: 0 })
      expect(lowestWorldY(pose, shape.bounds)).toBeCloseTo(0, 6)
    }
  })
})

describe("snapping never sinks a Part into the ground", () => {
  // A block 20 mm tall whose bottom face has one Snap Point, facing down.
  // A family that keeps its catalog pose, so the snap stays where it is written.
  const block: PlacementShape = {
    family: "motor",
    sizeMm: [10, 20, 10],
    bounds: { lo: [-5, -10, -5], hi: [5, 10, 5] },
    snapPoints: [
      {
        id: "under",
        kind: "hole",
        source: "computed",
        position: [0, -10, 0],
        axis: [0, -1, 0],
        diameterMm: 4.5,
      } satisfies SnapPoint,
    ],
  }

  it("refuses a snap that would hang the Part under the ground, and rests it instead", () => {
    // A hole in the underside of a Part at height zero, facing down. A Part snapped to it
    // from below would hang beneath the ground.
    const index = new SnapIndex(10)
    index.add({
      owner: "table",
      snapId: "hole",
      position: new Vector3(0, 0, 0),
      axis: new Vector3(0, -1, 0),
    } satisfies WorldSnap)
    const result = placementPose(block, { x: 0, z: 0 }, START_TURN, index)
    expect(result.snap).toBeNull()
    expect(lowestWorldY(result.pose, block.bounds)).toBeCloseTo(0, 6)
  })

  it("takes a snap that keeps the Part above the ground", () => {
    // A hole facing up at height 0: the block sits on it, above the ground.
    const index = new SnapIndex(10)
    index.add({
      owner: "table",
      snapId: "hole",
      position: new Vector3(0, 0, 0),
      axis: new Vector3(0, 1, 0),
    } satisfies WorldSnap)
    const result = placementPose(block, { x: 0, z: 0 }, START_TURN, index)
    expect(result.snap).not.toBeNull()
    expect(lowestWorldY(result.pose, block.bounds)).toBeGreaterThanOrEqual(
      -1e-6
    )
  })

  it("moves on to the next snap when the nearest would sink the Part", () => {
    const index = new SnapIndex(10)
    // Nearest: a hole facing down at the ground, which would sink the Part.
    index.add({
      owner: "low",
      snapId: "down",
      position: new Vector3(0, 0, 0),
      axis: new Vector3(0, -1, 0),
    } satisfies WorldSnap)
    // Further: a hole facing up, which is fine.
    index.add({
      owner: "high",
      snapId: "up",
      position: new Vector3(0, 3, 0),
      axis: new Vector3(0, 1, 0),
    } satisfies WorldSnap)
    // The block's snap sits right on the nearer hole, which would sink the block.
    const match = findSnap(
      block.snapPoints,
      { position: [0, 10, 0], rotation: [0, 0, 0, 1] },
      index,
      10,
      0,
      (pose) => lowestWorldY(pose, block.bounds) >= -1e-6
    )
    expect(match?.target.owner).toBe("high")
  })

  it("keeps the ground check for a snap picked from the pointer's ray too", () => {
    // Pointer straight down through a facing-down hole at the ground.
    const index = new SnapIndex(10)
    index.add({
      owner: "table",
      snapId: "down",
      position: new Vector3(0, 0, 0),
      axis: new Vector3(0, -1, 0),
    } satisfies WorldSnap)
    const ray = {
      origin: new Vector3(0, 500, 0),
      direction: new Vector3(0, -1, 0),
    }
    const result = placementPose(block, { x: 0, z: 0 }, START_TURN, index, ray)
    expect(result.snap).toBeNull()
    expect(lowestWorldY(result.pose, block.bounds)).toBeCloseTo(0, 6)
  })
})

describe("snap points in the world frame", () => {
  it("are moved by a Part's turn", () => {
    const local: SnapPoint = {
      id: "s",
      kind: "hole",
      source: "computed",
      position: [10, 0, 0],
      axis: [1, 0, 0],
      diameterMm: 4.5,
    }
    const world = toWorldSnap(local, {
      position: [0, 0, 0],
      rotation: [0, 0, 1, 0],
    })
    expect(world.position.x).toBeCloseTo(-10, 9)
  })
})
