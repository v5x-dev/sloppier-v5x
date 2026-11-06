import type { Camera, Vector2, Vector3 } from "three"
import {
  placementPose,
  type PlacementResult,
  type PlacementShape,
  type PlacementTurn,
} from "./placement"
import type { SnapIndex } from "./snap"

/** The scene queries needed to place a Part at the pointer's current position. */
export type PlacementPointerScene = {
  index: SnapIndex
  groundAt: (
    ndc: Vector2,
    camera: Camera
  ) => { x: number; z: number } | undefined
  rayAt: (
    ndc: Vector2,
    camera: Camera
  ) => { origin: Vector3; direction: Vector3 }
}

/** Whether a down/up sequence is a primary-button click rather than a drag or secondary click. */
export function isPrimaryClick(
  button: number,
  down: { x: number; y: number } | undefined,
  up: { x: number; y: number },
  slopPx: number
): boolean {
  return (
    button === 0 &&
    down !== undefined &&
    Math.hypot(up.x - down.x, up.y - down.y) <= slopPx
  )
}

/** Resolve placement from the supplied pointer coordinates, without using a prior frame's preview. */
export function placementPoseAtPointer(
  shape: PlacementShape,
  ndc: Vector2,
  camera: Camera,
  turn: PlacementTurn,
  scene: PlacementPointerScene
): PlacementResult | undefined {
  const ground = scene.groundAt(ndc, camera)
  if (!ground) return undefined
  return placementPose(
    shape,
    ground,
    turn,
    scene.index,
    scene.rayAt(ndc, camera)
  )
}
