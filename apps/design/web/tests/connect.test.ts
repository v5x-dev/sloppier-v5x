import { describe, expect, it } from "vitest"
import {
  connectionsForNew,
  connectionsForSelection,
} from "../src/design/connect"
import type { PlacedPart } from "../src/design/model"
import { partShape } from "../src/design/library"
import { alignToSnap, toWorldSnap, type Pose } from "../src/design/snap"

const IDENTITY: Pose["rotation"] = [0, 0, 0, 1]
const CHANNEL = "channel-1x2x1-aluminum"
const SCREW = "screw-6-32-1-4"
const channelShape = partShape({ catalogId: CHANNEL, lengthMm: 444.5 })
const screwShape = partShape({ catalogId: SCREW })

function part(
  id: string,
  catalogId: string,
  pose: Pose,
  lengthMm?: number
): PlacedPart {
  return {
    id,
    catalogId,
    position: pose.position,
    rotation: pose.rotation,
    color: "#fff",
    ...(lengthMm === undefined ? {} : { lengthMm }),
  }
}

const hole = (i: number) =>
  channelShape.snapPoints.filter((s) => s.kind === "hole")[i]
const pin = (id: string) => {
  const found = screwShape.snapPoints.find((s) => s.id === id)
  if (!found) throw new Error(id)
  return found
}

/** A channel at `at`, and a screw whose first pin is in its hole 0. */
function channelWithScrew(at: Pose) {
  const target = toWorldSnap(hole(0), at)
  const screwPose = alignToSnap(pin("screw-01"), target, IDENTITY)
  return {
    channel: part("a", CHANNEL, at, 444.5),
    screw: part("screw", SCREW, screwPose),
    screwPose,
  }
}

describe("connections made when a Part is placed", () => {
  it("joins a channel placed onto a screw's free pin", () => {
    const { channel, screw, screwPose } = channelWithScrew({
      position: [0, 100, 0],
      rotation: IDENTITY,
    })
    const pinB = toWorldSnap(pin("screw-02"), screwPose)
    const second = alignToSnap(hole(0), pinB, IDENTITY)
    const added = part("b", CHANNEL, second, 444.5)
    const drafts = connectionsForNew([channel, screw], added)
    expect(drafts).toEqual([
      {
        fastener: "screw",
        host: "b",
        fastenerSnap: "screw-02",
        hostSnap: hole(0).id,
      },
    ])
  })

  it("joins a screw placed into a channel's hole to that channel", () => {
    const at: Pose = { position: [0, 100, 0], rotation: IDENTITY }
    const channel = part("a", CHANNEL, at, 444.5)
    const { screw } = channelWithScrew(at)
    expect(connectionsForNew([channel], screw)).toEqual([
      {
        fastener: "screw",
        host: "a",
        fastenerSnap: "screw-01",
        hostSnap: hole(0).id,
      },
    ])
  })

  it("makes no Connection between two Parts that merely touch", () => {
    const at: Pose = { position: [0, 100, 0], rotation: IDENTITY }
    const channel = part("a", CHANNEL, at, 444.5)
    const touching = part(
      "b",
      CHANNEL,
      { position: [0, 100, 25], rotation: IDENTITY },
      444.5
    )
    expect(connectionsForNew([channel], touching)).toEqual([])
  })
})

describe("the Connect action on a selection", () => {
  it("joins a selected screw to the Parts it passes through", () => {
    const at: Pose = { position: [0, 100, 0], rotation: IDENTITY }
    const { channel, screw } = channelWithScrew(at)
    const drafts = connectionsForSelection([channel, screw], new Set(["screw"]))
    expect(drafts.map((d) => d.host)).toEqual(["a"])
  })

  it("joins a selected Part to the screws that pass through it", () => {
    const at: Pose = { position: [0, 100, 0], rotation: IDENTITY }
    const { channel, screw } = channelWithScrew(at)
    const drafts = connectionsForSelection([channel, screw], new Set(["a"]))
    expect(drafts.map((d) => d.fastener)).toEqual(["screw"])
  })
})
