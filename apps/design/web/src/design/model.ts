// What a placed Part is, as the Design document stores it. All lengths are millimetres,
// in the world frame (Y up). `rotation` is a unit quaternion [x, y, z, w].

import type { Vec3 } from "@/catalog/types"

export type Quat = readonly [number, number, number, number]

/** Which catalog entry a Part is, and its length for a Cut Part. */
export type PartRef = {
  catalogId: string
  lengthMm?: number
}

export type PlacedPart = PartRef & {
  id: string
  position: Vec3
  rotation: Quat
  color: string
}

export const IDENTITY: Quat = [0, 0, 0, 1]
