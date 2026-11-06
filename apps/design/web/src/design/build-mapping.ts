// The table that says which Protobot part each Catalog Part is. It is keyed by the Protobot
// `partId` a saved file gives, and it grows as parts are checked. Each entry says which
// Catalog Part it becomes, and how to calibrate the pose conversion for that kind of Part.
//
// Nothing here is verified yet. No real Protobot `.Build` file has been checked, so the table
// is empty. An entry is only added after its `partId` and `states` have been read from a saved
// file, and its calibration has been confirmed by looking at the import on a real file.
// Entries set `verified: false` until that check is done. A Design that uses any unverified
// entry is reported as unverified in the import summary.
//

import type { Vec3 } from "@/catalog/types"

/**
 * How a Protobot pose becomes a Design pose for one Catalog Part.
 *
 * - `unitsToMm`: millimetres per Protobot (Unity) unit.
 * - `modelTurnDeg`: a fixed turn, in degrees about X, Y and Z (applied Z, then Y, then X), that
 *   takes the Protobot model's axes to this Catalog Part's frame.
 * - `pivotMm`: where Protobot's pivot sits in the Catalog Part's own frame, in millimetres
 *   from the centre of its bounding box.
 */
export type Calibration = {
  unitsToMm: number
  modelTurnDeg: Vec3
  pivotMm: Vec3
}

export type BuildMapping = {
  /** The `partId` as the saved file gives it. */
  partId: string
  /** The Catalog Part it becomes. */
  catalogId: string
  /** For a Cut Part, its length in millimetres, if the Protobot part fixes it. */
  lengthMm?: number
  calibration: Calibration
  /** True only after a real saved file has been imported and checked with this entry. */
  verified: boolean
  /** What was checked, and what is still unknown. */
  note: string
}

/** The checked mappings. Empty until real saved files have been read. */
export const BUILD_MAPPINGS: readonly BuildMapping[] = []
