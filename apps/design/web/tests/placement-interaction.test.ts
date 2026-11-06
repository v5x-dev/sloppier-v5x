import { describe, expect, it, vi } from "vitest"
import { OrthographicCamera, Vector2 } from "three"
import { connectionsForNew } from "../src/design/connect"
import { partShape } from "../src/design/library"
import {
  isPrimaryClick,
  placementPoseAtPointer,
} from "../src/design/placement-interaction"
import { SnapIndex, toWorldSnap, type Pose } from "../src/design/snap"

const CHANNEL = "channel-1x2x1-aluminum"
const SCREW = "screw-6-32-1-4"
const IDENTITY: Pose["rotation"] = [0, 0, 0, 1]

describe("placing a Part at the pointer", () => {
  it("does not place on a secondary-button click", () => {
    const down = { x: 10, y: 10, button: 0 }
    const secondaryDown = { x: 10, y: 10, button: 2 }
    const up = { x: 10, y: 10 }

    expect(isPrimaryClick(0, down, up, 5)).toBe(true)
    expect(isPrimaryClick(1, down, up, 5)).toBe(false)
    expect(isPrimaryClick(2, down, up, 5)).toBe(false)
    expect(isPrimaryClick(0, secondaryDown, up, 5)).toBe(false)
  })

  it("places a screw into the hole under pointer-up and connects it", () => {
    const pointerA = new Vector2(-1, 0)
    const pointerB = new Vector2(1, 0)
    const camera = new OrthographicCamera(-1, 1, 1, -1, 1, 1000)
    const index = new SnapIndex(10)
    const channel = partShape({ catalogId: CHANNEL, lengthMm: 444.5 })
    const screw = partShape({ catalogId: SCREW })
    const channelPose: Pose = { position: [0, 100, 0], rotation: IDENTITY }
    const holes = channel.snapPoints.filter((point) => point.kind === "hole")
    const [holeA, holeB] = [holes[0], holes[2]]
    const targetA = toWorldSnap(holeA, channelPose)
    const targetB = toWorldSnap(holeB, channelPose)
    for (const [point, target] of [
      [holeA, targetA],
      [holeB, targetB],
    ] as const) {
      index.add({
        owner: "channel",
        snapId: point.id,
        kind: point.kind,
        ...(point.accepts ? { accepts: point.accepts } : {}),
        ...target,
      })
    }
    const groundAt = vi.fn((ndc: Vector2) => ({ x: ndc.x, z: 0 }))
    const rayAt = vi.fn((ndc: Vector2) => {
      const target = ndc.x < 0 ? targetA : targetB
      return {
        origin: target.position.clone().addScaledVector(target.axis, 100),
        direction: target.axis.clone().negate(),
      }
    })
    const store = { index, groundAt, rayAt }

    const poseAt = (pointer: Vector2) =>
      placementPoseAtPointer(
        screw,
        pointer,
        camera,
        { quarterTurns: 0, roll: 0 },
        store
      )

    // The last rendered preview is still at A; the click itself has reached B.
    expect(poseAt(pointerA)?.snap?.target.snapId).toBe(holeA.id)
    const result = placementPoseAtPointer(
      screw,
      pointerB,
      camera,
      { quarterTurns: 0, roll: 0 },
      store
    )

    expect(groundAt).toHaveBeenCalledWith(pointerB, camera)
    expect(rayAt).toHaveBeenCalledWith(pointerB, camera)
    expect(result?.snap?.target.snapId).toBe(holeB.id)
    if (!result) throw new Error("expected the pointer-up position to snap")

    const added = {
      id: "screw",
      catalogId: SCREW,
      position: result.pose.position,
      rotation: result.pose.rotation,
      color: "#fff",
    }
    const existing = {
      id: "channel",
      catalogId: CHANNEL,
      lengthMm: 444.5,
      position: channelPose.position,
      rotation: channelPose.rotation,
      color: "#fff",
    }
    const connections = connectionsForNew([existing], added)
    expect(connections).toHaveLength(1)
    expect(connections[0]).toMatchObject({
      fastener: "screw",
      host: "channel",
      hostSnap: holeB.id.replace(/-in$/, ""),
    })
  })
})
