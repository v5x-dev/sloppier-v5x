import { describe, expect, it } from "vitest"
import { Quaternion, Vector3 } from "three"
import type { SnapPoint, Vec3 } from "../src/catalog/types"
import {
  CONNECT_TOLERANCE_MM,
  connectionsFor,
  movingGroup,
  pivotAxis,
  pivotsFor,
  pinEntersHole,
  shaftPasses,
  type Edge,
  type FastenerPart,
  type HostPart,
} from "../src/design/connections"
import type { Pose } from "../src/design/snap"

const ID: Pose["rotation"] = [0, 0, 0, 1]

const snap = (over: Partial<SnapPoint>): SnapPoint => ({
  id: "s",
  kind: "hole",
  source: "computed",
  position: [0, 0, 0],
  axis: [1, 0, 0],
  diameterMm: 4.5,
  ...over,
})

/** A 6-32 screw of 1/4 in length, as the catalog has it: pins at each end, facing out. */
function screw(
  id: string,
  at: Vec3,
  rotation: Pose["rotation"] = ID
): FastenerPart {
  return {
    role: "screw",
    id,
    pose: { position: at, rotation },
    snaps: [
      snap({
        id: "pin-a",
        kind: "pin",
        position: [-5.42, 0, 0],
        axis: [-1, 0, 0],
        diameterMm: 3.416,
      }),
      snap({
        id: "pin-b",
        kind: "pin",
        position: [7.18, 0, 0],
        axis: [1, 0, 0],
        diameterMm: 3.416,
      }),
    ],
  }
}

/** A host whose one hole sits at `at` on its own face, facing `axis`. */
function host(
  id: string,
  at: Vec3,
  axis: Vec3 = [1, 0, 0],
  over: Partial<SnapPoint> = {}
): HostPart {
  return {
    id,
    pose: { position: at, rotation: ID },
    snaps: [snap({ id: "hole-1", position: [0, 0, 0], axis, ...over })],
  }
}

const near = (a: Vec3, b: Vec3) =>
  new Vector3(...a).distanceTo(new Vector3(...b))

describe("which pins and holes connect", () => {
  it("connects a screw's pin to a facing hole it sits in", () => {
    // The screw's first pin points -X, so the hole it enters faces +X.
    const s = screw("screw", [0, 0, 0])
    const found = connectionsFor(s, [host("channel", [-5.42, 0, 0], [1, 0, 0])])
    expect(found).toEqual([
      {
        fastener: "screw",
        host: "channel",
        fastenerSnap: "pin-a",
        hostSnap: "hole-1",
      },
    ])
  })

  it("does not connect when the hole faces the same way as the pin", () => {
    const s = screw("screw", [0, 0, 0])
    expect(
      connectionsFor(s, [host("channel", [-5.42, 0, 0], [-1, 0, 0])])
    ).toEqual([])
  })

  it("does not connect when the hole is further than the tolerance", () => {
    const s = screw("screw", [0, 0, 0])
    const off = host(
      "channel",
      [-5.42 + CONNECT_TOLERANCE_MM + 0.1, 0, 0],
      [1, 0, 0]
    )
    expect(connectionsFor(s, [off])).toEqual([])
  })

  it("connects within the tolerance", () => {
    const s = screw("screw", [0, 0, 0])
    const near_ = host(
      "channel",
      [-5.42 + CONNECT_TOLERANCE_MM - 0.05, 0, 0],
      [1, 0, 0]
    )
    expect(connectionsFor(s, [near_])).toHaveLength(1)
  })

  it("does not let a screw through a hole that is too small for it", () => {
    // A 6-32 pin is 3.4 mm; the motor's manual holes are 2.2 mm.
    const s = screw("screw", [0, 0, 0])
    const small = host("motor", [-5.42, 0, 0], [1, 0, 0], { diameterMm: 2.2 })
    expect(connectionsFor(s, [small])).toEqual([])
  })

  it("never joins two holes, because neither is a fastener", () => {
    const a = host("a", [0, 0, 0], [1, 0, 0])
    const b = host("b", [0, 0, 0], [-1, 0, 0])
    const shaft: FastenerPart = {
      role: "shaft",
      id: "shaft",
      lengthMm: 100,
      sizeMm: 6.35,
      pose: { position: [0, 0, 0], rotation: ID },
    }
    expect(connectionsFor(shaft, [a, b])).toEqual([])
  })

  it("does not join a screw pin to a wheel's axle", () => {
    const s = screw("screw", [0, 0, 0])
    const wheel: HostPart = {
      id: "wheel",
      pose: { position: [0, 0, 0], rotation: ID },
      snaps: [
        snap({
          id: "wheel-01",
          kind: "axle",
          position: [0, 0, 0],
          axis: [-1, 0, 0],
          diameterMm: 6.35,
        }),
      ],
    }
    expect(connectionsFor(s, [wheel])).toEqual([])
  })

  it("connects a screw at both ends when two hosts sit at its pins", () => {
    const s = screw("screw", [0, 0, 0])
    const left = host("left", [-5.42, 0, 0], [1, 0, 0])
    const right = host("right", [7.18, 0, 0], [-1, 0, 0])
    const found = connectionsFor(s, [left, right])
    expect(found.map((c) => c.host).sort()).toEqual(["left", "right"])
  })

  it("follows a turned screw: its pins move with it", () => {
    const q = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      Math.PI / 2
    )
    const turned: Pose["rotation"] = [q.x, q.y, q.z, q.w]
    const s = screw("screw", [0, 0, 0], turned)
    const pin = new Vector3(-5.42, 0, 0).applyQuaternion(q)
    const facing = new Vector3(-1, 0, 0).applyQuaternion(q)
    const at = [pin.x, pin.y, pin.z] as Vec3
    // A hole where the pin is now, facing the pin, connects.
    expect(
      connectionsFor(s, [
        host("channel", at, [-facing.x, -facing.y, -facing.z]),
      ])
    ).toHaveLength(1)
    // A hole where the pin was before the turn does not.
    expect(
      connectionsFor(s, [host("channel", [-5.42, 0, 0], [1, 0, 0])])
    ).toHaveLength(0)
  })
})

describe("which shafts pass through", () => {
  const shaft = (at: Vec3, rotation: Pose["rotation"] = ID): FastenerPart => ({
    role: "shaft",
    id: "shaft",
    lengthMm: 49.8,
    sizeMm: 6.35,
    pose: { position: at, rotation },
  })

  it("passes through a hole on its line, along it, within its length", () => {
    const line = {
      origin: new Vector3(0, 0, 0),
      direction: new Vector3(1, 0, 0),
    }
    expect(
      shaftPasses(
        line,
        49.8,
        6.35,
        { position: new Vector3(10, 0, 0), axis: new Vector3(1, 0, 0) },
        6.5
      )
    ).toBe(true)
  })

  it("does not pass through a hole that is off the line", () => {
    const line = {
      origin: new Vector3(0, 0, 0),
      direction: new Vector3(1, 0, 0),
    }
    expect(
      shaftPasses(
        line,
        49.8,
        6.35,
        { position: new Vector3(10, 2, 0), axis: new Vector3(1, 0, 0) },
        6.5
      )
    ).toBe(false)
  })

  it("does not pass through a hole that runs across the shaft", () => {
    const line = {
      origin: new Vector3(0, 0, 0),
      direction: new Vector3(1, 0, 0),
    }
    expect(
      shaftPasses(
        line,
        49.8,
        6.35,
        { position: new Vector3(10, 0, 0), axis: new Vector3(0, 1, 0) },
        6.5
      )
    ).toBe(false)
  })

  it("does not pass through a hole beyond the shaft's ends", () => {
    const line = {
      origin: new Vector3(0, 0, 0),
      direction: new Vector3(1, 0, 0),
    }
    expect(
      shaftPasses(
        line,
        49.8,
        6.35,
        { position: new Vector3(40, 0, 0), axis: new Vector3(1, 0, 0) },
        6.5
      )
    ).toBe(false)
  })

  it("does not pass through a hole narrower than the shaft", () => {
    const line = {
      origin: new Vector3(0, 0, 0),
      direction: new Vector3(1, 0, 0),
    }
    expect(
      shaftPasses(
        line,
        49.8,
        6.35,
        { position: new Vector3(10, 0, 0), axis: new Vector3(1, 0, 0) },
        4.5
      )
    ).toBe(false)
  })

  it("connects a wheel's axle that sits on the shaft's line", () => {
    const s = shaft([0, 0, 0])
    const wheel: HostPart = {
      id: "wheel",
      pose: { position: [10, 0, 0], rotation: ID },
      snaps: [
        snap({
          id: "wheel-01",
          kind: "axle",
          position: [0, 0, 0],
          axis: [1, 0, 0],
          diameterMm: 6.35,
        }),
      ],
    }
    expect(connectionsFor(s, [wheel])).toEqual([
      { fastener: "shaft", host: "wheel", hostSnap: "wheel-01" },
    ])
  })

  it("passes through a shaft's line whatever way the shaft is turned", () => {
    const quarter: Pose["rotation"] = (() => {
      const q = new Quaternion().setFromAxisAngle(
        new Vector3(0, 0, 1),
        Math.PI / 2
      )
      return [q.x, q.y, q.z, q.w]
    })()
    // Turned about Z, the shaft now runs along Y.
    const s = shaft([0, 0, 0], quarter)
    const wheel: HostPart = {
      id: "wheel",
      pose: { position: [0, 10, 0], rotation: ID },
      snaps: [
        snap({
          id: "wheel-01",
          kind: "axle",
          position: [0, 0, 0],
          axis: [0, 1, 0],
          diameterMm: 6.35,
        }),
      ],
    }
    expect(connectionsFor(s, [wheel])).toHaveLength(1)
  })
})

describe("the group that moves with a Part", () => {
  const edges: Edge[] = [
    { fastener: "screw", host: "a" },
    { fastener: "screw", host: "b" },
    { fastener: "wheel-shaft", host: "wheel" },
  ]

  it("moves every Part connected to the one grabbed, and no others", () => {
    expect([...movingGroup(["a"], edges)].sort()).toEqual(["a", "b", "screw"])
    expect([...movingGroup(["wheel"], edges)].sort()).toEqual([
      "wheel",
      "wheel-shaft",
    ])
  })

  it("turns one Part about a single fastener without the other Part", () => {
    // Removing the screw splits a from b, so a alone turns about the screw.
    expect([...movingGroup(["a"], edges, "screw")]).toEqual(["a"])
  })

  it("keeps two Parts joined by two fasteners together, even about one of them", () => {
    const rigid: Edge[] = [
      { fastener: "screw-1", host: "a" },
      { fastener: "screw-1", host: "b" },
      { fastener: "screw-2", host: "a" },
      { fastener: "screw-2", host: "b" },
    ]
    expect([...movingGroup(["a"], rigid, "screw-1")].sort()).toEqual([
      "a",
      "b",
      "screw-2",
    ])
  })

  it("does not turn the pivot fastener itself", () => {
    expect(movingGroup(["a", "b"], edges, "screw").has("screw")).toBe(false)
  })
})

describe("pivots for a selection", () => {
  const edges: Edge[] = [
    { fastener: "screw-1", host: "a" },
    { fastener: "screw-2", host: "a" },
    { fastener: "screw-2", host: "b" },
  ]

  it("lists the fasteners that join the selection to Parts outside it", () => {
    expect(pivotsFor(new Set(["a"]), edges)).toEqual(["screw-1", "screw-2"])
    expect(pivotsFor(new Set(["a", "b"]), edges)).toEqual([
      "screw-1",
      "screw-2",
    ])
    expect(pivotsFor(new Set(["b"]), edges)).toEqual(["screw-2"])
  })

  it("does not list a fastener that is itself selected", () => {
    expect(pivotsFor(new Set(["screw-1"]), edges)).toEqual([])
  })
})

describe("the axis a pivot turns about", () => {
  it("runs through a screw's two pins", () => {
    const s = screw("screw", [0, 0, 0])
    const { point, direction } = pivotAxis(s)
    expect(point[0]).toBeCloseTo((-5.42 + 7.18) / 2, 9)
    expect(near(direction, [1, 0, 0])).toBeLessThan(1e-9)
  })

  it("runs along a shaft's length", () => {
    const s: FastenerPart = {
      role: "shaft",
      id: "shaft",
      lengthMm: 49.8,
      sizeMm: 6.35,
      pose: { position: [3, 4, 5], rotation: ID },
    }
    expect(pivotAxis(s)).toEqual({ point: [3, 4, 5], direction: [1, 0, 0] })
  })
})

describe("pinEntersHole", () => {
  it("needs the pin to be within tolerance and facing", () => {
    const pin = { position: new Vector3(0, 0, 0), axis: new Vector3(-1, 0, 0) }
    const hole = { position: new Vector3(0, 0, 0), axis: new Vector3(1, 0, 0) }
    expect(pinEntersHole(pin, 3.4, hole, 4.5)).toBe(true)
    // The pin may be wider than the hole by the tolerance, and no more.
    expect(pinEntersHole(pin, 4.5 + CONNECT_TOLERANCE_MM, hole, 4.5)).toBe(true)
    expect(pinEntersHole(pin, 5.2, hole, 4.5)).toBe(false)
  })
})
