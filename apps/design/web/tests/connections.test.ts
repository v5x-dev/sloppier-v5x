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
  takesFit,
  type Edge,
  type FastenerPart,
  type HostPart,
} from "../src/design/connections"
import type { Pose } from "../src/design/snap"

const ID: Pose["rotation"] = [0, 0, 0, 1]

/** What a 3.2 mm channel's square hole takes: both screws, and a 1/8 in shaft. */
const CHANNEL_HOLE = ["screw:6-32", "screw:8-32", "shaft:1/8"]

const snap = (over: Partial<SnapPoint>): SnapPoint => ({
  id: "s",
  kind: "hole",
  source: "computed",
  position: [0, 0, 0],
  axis: [1, 0, 0],
  diameterMm: 4.5,
  accepts: CHANNEL_HOLE,
  ...over,
})

/** A screw as the catalog has it: pins at each end, facing out, 12.6 mm apart. */
function screw(
  id: string,
  at: Vec3,
  rotation: Pose["rotation"] = ID,
  fit: string = "screw:6-32"
): FastenerPart {
  return {
    role: "screw",
    id,
    fit,
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

/** A host whose one hole sits at `at`, facing `axis`. */
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

/** A shaft along X, 50.8 mm long, as the 1/8 in catalog entry has it. */
function shaft(
  at: Vec3,
  rotation: Pose["rotation"] = ID,
  fit = "shaft:1/8"
): FastenerPart {
  return {
    role: "shaft",
    id: "shaft",
    fit,
    lengthMm: 50.8,
    sizeMm: 3.175,
    pose: { position: at, rotation },
  }
}

const near = (a: Vec3, b: Vec3) =>
  new Vector3(...a).distanceTo(new Vector3(...b))

describe("which fits an opening takes", () => {
  it("takes a fit token only when the opening lists it", () => {
    expect(takesFit({ accepts: CHANNEL_HOLE }, "shaft:1/8")).toBe(true)
    expect(takesFit({ accepts: CHANNEL_HOLE }, "shaft:1/4")).toBe(false)
    expect(takesFit({}, "screw:6-32")).toBe(false)
    expect(takesFit({ accepts: CHANNEL_HOLE }, undefined)).toBe(false)
  })
})

describe("which screw joins which openings", () => {
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

  it("does not connect at a tip when the hole faces the same way as the pin", () => {
    const s = screw("screw", [0, 0, 0])
    expect(
      connectionsFor(s, [host("channel", [-5.42, 0, 0], [-1, 0, 0])])
    ).toEqual([])
  })

  it("does not connect a tip hole that is further than the tolerance off the pin", () => {
    const s = screw("screw", [0, 0, 0])
    const off = host(
      "channel",
      [-5.42 - CONNECT_TOLERANCE_MM - 0.1, 0, 0],
      [1, 0, 0]
    )
    expect(connectionsFor(s, [off])).toEqual([])
  })

  it("connects a tip hole within the tolerance of its pin", () => {
    const s = screw("screw", [0, 0, 0])
    const near_ = host(
      "channel",
      [-5.42 + CONNECT_TOLERANCE_MM - 0.05, 0, 0],
      [1, 0, 0]
    )
    expect(connectionsFor(s, [near_])).toHaveLength(1)
  })

  it("does not thread a 6-32 screw into a threaded 8-32 hole", () => {
    // The motor's mounting holes are 8-32 threads: a 6-32 screw does not engage them.
    const s = screw("screw", [0, 0, 0], ID, "screw:6-32")
    const tapped = host("motor", [-5.42, 0, 0], [1, 0, 0], {
      accepts: ["screw:8-32"],
      diameterMm: 2.2,
    })
    expect(connectionsFor(s, [tapped])).toEqual([])
  })

  it("threads an 8-32 screw into an 8-32 hole, whatever the hole's diameter", () => {
    const s = screw("screw", [0, 0, 0], ID, "screw:8-32")
    const tapped = host("motor", [-5.42, 0, 0], [1, 0, 0], {
      accepts: ["screw:8-32"],
      diameterMm: 2.2,
    })
    expect(connectionsFor(s, [tapped])).toHaveLength(1)
  })

  it("joins nothing for a screw with no fit token", () => {
    const s = { ...screw("screw", [0, 0, 0]), fit: undefined }
    expect(
      connectionsFor(s, [host("channel", [-5.42, 0, 0], [1, 0, 0])])
    ).toEqual([])
  })

  it("never joins two holes, because neither is a fastener", () => {
    const a = host("a", [0, 0, 0], [1, 0, 0])
    const b = host("b", [0, 0, 0], [-1, 0, 0])
    const line: FastenerPart = {
      role: "shaft",
      id: "shaft",
      fit: "shaft:1/8",
      lengthMm: 100,
      sizeMm: 3.175,
      pose: { position: [0, 0, 0], rotation: ID },
    }
    expect(connectionsFor(line, [a, b])).toHaveLength(2)
    // Two holes side by side, both off the screw's shank, make no Connection.
    const left = host("left", [0, 3, 0], [1, 0, 0])
    const right = host("right", [0, -3, 0], [1, 0, 0])
    expect(
      connectionsFor(screw("screw", [0, 0, 0], ID, "screw:6-32"), [left, right])
    ).toEqual([])
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
          accepts: ["shaft:1/8"],
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

  it("joins every opening along its shank, so a stack goes on one screw", () => {
    // Screw, channel, spacer, channel, nut, from the pin at -5.42 to the pin at 7.18.
    const s = screw("screw", [0, 0, 0], ID, "screw:8-32")
    const hosts = [
      host("channel-a", [-5.42, 0, 0], [1, 0, 0]),
      host("channel-b", [0, 0, 0], [1, 0, 0]),
      host("spacer", [2.5, 0, 0], [-1, 0, 0], { accepts: ["screw:8-32"] }),
      host("nut", [7.18, 0, 0], [-1, 0, 0], { accepts: ["screw:8-32"] }),
    ]
    const found = connectionsFor(s, hosts)
    expect(found.map((c) => c.host).sort()).toEqual([
      "channel-a",
      "channel-b",
      "nut",
      "spacer",
    ])
    // The two ends are end-on joints; the middle ones run along the shank.
    expect(found.find((c) => c.host === "channel-a")?.fastenerSnap).toBe(
      "pin-a"
    )
    expect(found.find((c) => c.host === "nut")?.fastenerSnap).toBe("pin-b")
    expect(
      found.find((c) => c.host === "channel-b")?.fastenerSnap
    ).toBeUndefined()
    expect(found.find((c) => c.host === "spacer")?.fastenerSnap).toBeUndefined()
  })

  it("does not join an opening off the shank, or one that runs across it", () => {
    const s = screw("screw", [0, 0, 0])
    expect(connectionsFor(s, [host("off", [1, 1, 0], [1, 0, 0])])).toEqual([])
    expect(connectionsFor(s, [host("across", [0, 0, 0], [0, 1, 0])])).toEqual(
      []
    )
  })

  it("does not join an opening beyond the screw's ends", () => {
    const s = screw("screw", [0, 0, 0])
    expect(connectionsFor(s, [host("far", [20, 0, 0], [1, 0, 0])])).toEqual([])
  })

  it("does not join a shank opening that does not take its thread", () => {
    const s = screw("screw", [0, 0, 0], ID, "screw:8-32")
    expect(
      connectionsFor(s, [
        host("gusset", [0, 0, 0], [1, 0, 0], { accepts: ["screw:6-32"] }),
      ])
    ).toEqual([])
  })
})

describe("which shafts pass through", () => {
  it("passes through an opening on its line, anywhere along its length", () => {
    const s = shaft([0, 0, 0])
    const found = connectionsFor(s, [
      host("near-end", [20, 0, 0], [1, 0, 0]),
      host("far-end", [-24, 0, 0], [-1, 0, 0]),
    ])
    expect(found.map((c) => c.host).sort()).toEqual(["far-end", "near-end"])
    // A shaft's connections are along its line, so they carry no pin.
    expect(found.every((c) => c.fastenerSnap === undefined)).toBe(true)
  })

  it("does not pass through an opening beyond its ends", () => {
    expect(
      connectionsFor(shaft([0, 0, 0]), [host("past", [-27, 0, 0], [1, 0, 0])])
    ).toEqual([])
  })

  it("does not pass through an opening off the line", () => {
    expect(
      connectionsFor(shaft([0, 0, 0]), [host("off", [10, 1.5, 0], [1, 0, 0])])
    ).toEqual([])
  })

  it("does not pass through an opening that runs across the shaft", () => {
    expect(
      connectionsFor(shaft([0, 0, 0]), [host("across", [10, 0, 0], [0, 1, 0])])
    ).toEqual([])
  })

  it("passes only an opening that takes its fit", () => {
    // A 1/4 in high-strength shaft does not fit a channel's 4.5 mm square hole.
    const big = shaft([0, 0, 0], ID, "shaft:1/4")
    expect(
      connectionsFor(big, [host("channel", [10, 0, 0], [1, 0, 0])])
    ).toEqual([])
    const bearing = host("bearing", [10, 0, 0], [1, 0, 0], {
      accepts: ["shaft:1/4"],
    })
    expect(connectionsFor(big, [bearing])).toHaveLength(1)
  })

  it("joins nothing for a shaft with no fit token", () => {
    const s = { ...shaft([0, 0, 0]), fit: undefined }
    expect(connectionsFor(s, [host("channel", [10, 0, 0], [1, 0, 0])])).toEqual(
      []
    )
  })

  it("connects a wheel's axle that sits on the shaft's line, wherever along it", () => {
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
          accepts: ["shaft:1/8", "shaft:1/4"],
        }),
      ],
    }
    expect(connectionsFor(s, [wheel])).toEqual([
      { fastener: "shaft", host: "wheel", hostSnap: "wheel-01" },
    ])
    const moved: HostPart = {
      ...wheel,
      pose: { position: [-15, 0, 0], rotation: ID },
    }
    expect(connectionsFor(s, [moved])).toHaveLength(1)
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
          accepts: ["shaft:1/8"],
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
    expect(pinEntersHole(pin, hole)).toBe(true)
    expect(
      pinEntersHole(pin, {
        ...hole,
        position: new Vector3(CONNECT_TOLERANCE_MM + 0.1, 0, 0),
      })
    ).toBe(false)
  })
})

describe("shaftPasses", () => {
  it("is false for an opening on the line with an axis that runs across it", () => {
    const line = {
      origin: new Vector3(0, 0, 0),
      direction: new Vector3(1, 0, 0),
    }
    expect(
      shaftPasses(line, 49.8, {
        position: new Vector3(10, 0, 0),
        axis: new Vector3(0, 1, 0),
      })
    ).toBe(false)
  })
})
