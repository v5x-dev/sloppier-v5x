import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import type { Vec3 } from "../src/catalog/types"
import {
  connectionsFor,
  pivotAxis,
  type HostPart,
} from "../src/design/connections"
import {
  commitPlan,
  groupOf,
  planMove,
  planTurn,
  quantize,
  targetsOf,
  type Target,
} from "../src/design/edit"
import {
  placePart,
  readConnections,
  readPlacedParts,
  removeParts,
} from "../src/design/document"
import { partShape } from "../src/design/library"
import { alignToSnap, toWorldSnap, type Pose } from "../src/design/snap"
import { lowestWorldY, type Bounds } from "../src/design/transform"

const CHANNEL = "channel-1x2x1-aluminum"
const SCREW = "screw-6-32-1-4"
const IDENTITY: Pose["rotation"] = [0, 0, 0, 1]

const channel = partShape({ catalogId: CHANNEL, lengthMm: 444.5 })
const screw = partShape({ catalogId: SCREW })

function exchange(a: Y.Doc, b: Y.Doc) {
  const fromA = Y.encodeStateAsUpdate(a)
  const fromB = Y.encodeStateAsUpdate(b)
  Y.applyUpdate(b, fromA)
  Y.applyUpdate(a, fromB)
}

function hole(index: number) {
  const holes = channel.snapPoints.filter((s) => s.kind === "hole")
  return holes[index]
}

/** A screw whose first pin sits in a hole of the channel at `at`. */
function screwInto(at: Pose, holeIndex: number, pinId: string): Pose {
  const target = toWorldSnap(hole(holeIndex), at)
  const pin = screw.snapPoints.find((s) => s.id === pinId)
  if (!pin) throw new Error(`no pin ${pinId}`)
  return alignToSnap(pin, target, IDENTITY)
}

/** A channel whose hole sits on the screw's second pin, facing it. */
function channelOnPin(screwAt: Pose, pinId: string, holeIndex: number): Pose {
  const pin = screw.snapPoints.find((s) => s.id === pinId)
  if (!pin) throw new Error(`no pin ${pinId}`)
  const target = toWorldSnap(pin, screwAt)
  return alignToSnap(hole(holeIndex), target, IDENTITY)
}

/**
 * A document with channel A, a screw through A's hole, and channel B on the screw's other
 * pin. Connections are made by the same rules the viewport uses.
 */
function twoChannelsAndAScrew() {
  const doc = new Y.Doc()
  const aPose: Pose = { position: [0, 100, 0], rotation: IDENTITY }
  const screwPose = screwInto(aPose, 0, "screw-01")
  const bPose = channelOnPin({ ...screwPose }, "screw-02", 0)
  const screwPart = {
    role: "screw" as const,
    fit: screw.catalog.fit,
    id: "screw",
    snaps: screw.snapPoints,
    pose: screwPose,
  }
  const hosts: HostPart[] = [
    { id: "a", snaps: channel.snapPoints, pose: aPose },
    { id: "b", snaps: channel.snapPoints, pose: bPose },
  ]
  const drafts = connectionsFor(screwPart, hosts)
  placePart(
    doc,
    {
      catalogId: CHANNEL,
      lengthMm: 444.5,
      position: aPose.position,
      rotation: aPose.rotation,
      color: "#b9c0cc",
    },
    "a"
  )
  placePart(
    doc,
    {
      catalogId: CHANNEL,
      lengthMm: 444.5,
      position: bPose.position,
      rotation: bPose.rotation,
      color: "#b9c0cc",
    },
    "b"
  )
  placePart(
    doc,
    {
      catalogId: SCREW,
      position: screwPose.position,
      rotation: screwPose.rotation,
      color: "#7d8592",
    },
    "screw",
    drafts.filter((d) => d.fastener === "screw")
  )
  return { doc, aPose, bPose, screwPose, drafts }
}

const positionOf = (doc: Y.Doc, id: string) =>
  readPlacedParts(doc).parts.find((p) => p.id === id)?.position

describe("the fixture", () => {
  it("joins a screw to both channels it sits between, through real holes", () => {
    const { drafts } = twoChannelsAndAScrew()
    expect(drafts.map((d) => [d.host, d.fastenerSnap]).sort()).toEqual([
      ["a", "screw-01"],
      ["b", "screw-02"],
    ])
  })
})

describe("moving a connected group", () => {
  it("moves every Part connected to the one grabbed, and nothing else", () => {
    const { doc } = twoChannelsAndAScrew()
    placePart(
      doc,
      {
        catalogId: CHANNEL,
        lengthMm: 444.5,
        position: [900, 0, 0],
        rotation: IDENTITY,
        color: "#fff",
      },
      "far"
    )
    const group = groupOf(doc, ["a"])
    expect(group).toEqual(["a", "b", "screw"])
    const before = positionOf(doc, "b")!
    commitPlan(doc, planMove(targetsOf(doc, group), [0, 0, 0]))
    expect(positionOf(doc, "b")).toEqual(before)
    commitPlan(doc, planMove(targetsOf(doc, group), [0, 50, 0]))
    expect(positionOf(doc, "b")![1]).toBeCloseTo(before[1] + 50, 6)
    expect(positionOf(doc, "far")).toEqual([900, 0, 0])
  })

  it("moves one Part alone, and breaks its Connections, when alone", () => {
    const { doc } = twoChannelsAndAScrew()
    commitPlan(doc, planMove(targetsOf(doc, ["a"]), [0, 0, 30], true))
    expect(readConnections(doc).map((c) => c.host)).toEqual(["b"])
    expect(readConnections(doc).map((c) => c.fastener)).toEqual(["screw"])
  })

  it("breaks the Connections in the same edit as the move", () => {
    const { doc } = twoChannelsAndAScrew()
    const before = readConnections(doc).length
    commitPlan(doc, planMove(targetsOf(doc, ["a"]), [0, 0, 30], true))
    expect(readConnections(doc).length).toBe(before - 1)
  })

  it("does not let a delete lose to a move that a remote copy made", () => {
    const { doc } = twoChannelsAndAScrew()
    const other = new Y.Doc()
    exchange(doc, other)
    commitPlan(
      other,
      planMove(targetsOf(other, groupOf(other, ["a"])), [0, 0, 40])
    )
    removeParts(doc, ["a"])
    exchange(doc, other)
    expect(
      readPlacedParts(doc)
        .parts.map((p) => p.id)
        .sort()
    ).toEqual(["b", "screw"])
    expect(readConnections(doc).map((c) => c.host)).toEqual(["b"])
    expect(readConnections(other).map((c) => c.host)).toEqual(["b"])
  })
})

describe("turning about a fastener", () => {
  it("turns one Part about a single screw, leaving the Part on the far side still", () => {
    const { doc, bPose } = twoChannelsAndAScrew()
    const pivot = pivotAxis({
      role: "screw",
      fit: screw.catalog.fit,
      id: "screw",
      snaps: screw.snapPoints,
      pose: positionPose(doc, "screw"),
    })
    const group = groupOf(doc, ["a"], { pivot: "screw" })
    expect(group).toEqual(["a"])
    const plan = planTurn(
      targetsOf(doc, group),
      pivot.point,
      pivot.direction,
      Math.PI / 2,
      { liftAllowed: false }
    )
    expect("blocked" in plan).toBe(false)
    if ("blocked" in plan) return
    commitPlan(doc, plan)
    expect(positionOf(doc, "b")).toEqual(bPose.position)
    expect(readConnections(doc).length).toBe(2)
  })

  it("keeps the turned Part joined to the screw on its axis", () => {
    const { doc, aPose } = twoChannelsAndAScrew()
    const screwPose = positionPose(doc, "screw")
    const pivot = pivotAxis({
      role: "screw",
      fit: screw.catalog.fit,
      id: "screw",
      snaps: screw.snapPoints,
      pose: screwPose,
    })
    const plan = planTurn(
      targetsOf(doc, ["a"]),
      pivot.point,
      pivot.direction,
      Math.PI / 2,
      { liftAllowed: false }
    )
    if ("blocked" in plan) throw new Error("unexpected")
    commitPlan(doc, plan)
    const turned = targetsOf(doc, ["a"])[0].pose
    const still = connectionsFor(
      {
        role: "screw",
        fit: screw.catalog.fit,
        id: "screw",
        snaps: screw.snapPoints,
        pose: screwPose,
      },
      [{ id: "a", snaps: channel.snapPoints, pose: turned }]
    )
    expect(still.map((d) => d.fastenerSnap)).toEqual(["screw-01"])
    expect(turned.position).not.toEqual(aPose.position)
  })

  it("turns a group joined by two fasteners as one, even about one of them", () => {
    const doc = new Y.Doc()
    const at: Vec3 = [0, 100, 0]
    placePart(
      doc,
      {
        catalogId: CHANNEL,
        lengthMm: 444.5,
        position: at,
        rotation: IDENTITY,
        color: "#fff",
      },
      "a"
    )
    placePart(
      doc,
      {
        catalogId: CHANNEL,
        lengthMm: 444.5,
        position: [0, 100, 40],
        rotation: IDENTITY,
        color: "#fff",
      },
      "b"
    )
    const link = (fastener: string, host: string) => ({
      fastener,
      host,
      hostSnap: "h",
      fastenerSnap: "p",
    })
    placePart(
      doc,
      {
        catalogId: SCREW,
        position: [0, 100, 20],
        rotation: IDENTITY,
        color: "#fff",
      },
      "s1",
      [link("s1", "a"), link("s1", "b")]
    )
    placePart(
      doc,
      {
        catalogId: SCREW,
        position: [0, 110, 20],
        rotation: IDENTITY,
        color: "#fff",
      },
      "s2",
      [link("s2", "a"), link("s2", "b")]
    )
    expect(groupOf(doc, ["a"], { pivot: "s1" })).toEqual(["a", "b", "s2"])
  })

  it("is refused when a turn would dig a Part into the ground", () => {
    // A block standing on the ground, turned about a pivot at the ground: it would dig in.
    const bounds: Bounds = { lo: [-5, -10, -5], hi: [5, 10, 5] }
    const standing: Target = {
      id: "block",
      pose: { position: [0, 10, 0], rotation: IDENTITY },
      bounds,
    }
    const plan = planTurn([standing], [0, 0, 0], [1, 0, 0], Math.PI / 2, {
      liftAllowed: false,
    })
    expect(plan).toEqual({ blocked: "ground" })
    const lifted = planTurn([standing], [0, 0, 0], [1, 0, 0], Math.PI / 2, {
      liftAllowed: true,
    })
    expect("blocked" in lifted).toBe(false)
  })
})

describe("the ground", () => {
  it("lifts a moved group so that none of it goes below the ground", () => {
    const bounds: Bounds = { lo: [-5, -10, -5], hi: [5, 10, 5] }
    const targets: Target[] = [
      { id: "x", pose: { position: [0, 10, 0], rotation: IDENTITY }, bounds },
      { id: "y", pose: { position: [50, 30, 0], rotation: IDENTITY }, bounds },
    ]
    const plan = planMove(targets, [0, -500, 0])
    for (const change of plan.changes) {
      const low = lowestWorldY(
        { position: change.position, rotation: change.rotation },
        bounds
      )
      expect(low).toBeGreaterThanOrEqual(-1e-6)
    }
    expect(
      Math.min(
        ...plan.changes.map((c) =>
          lowestWorldY({ position: c.position, rotation: c.rotation }, bounds)
        )
      )
    ).toBeCloseTo(0, 6)
  })
})

describe("grid and angle snapping", () => {
  it("rounds a move to the half-inch grid", () => {
    expect(quantize([7, 6.2, 19], 12.7)).toEqual([12.7, 0, 12.7])
  })
})

function positionPose(doc: Y.Doc, id: string): Pose {
  const part = readPlacedParts(doc).parts.find((p) => p.id === id)
  if (!part) throw new Error(`no part ${id}`)
  return { position: part.position, rotation: part.rotation }
}
