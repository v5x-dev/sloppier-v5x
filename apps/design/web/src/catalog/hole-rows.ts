import type { HoleRow } from "./types"

/**
 * Positions along a Part's length for one row of holes, centred on zero. A hole sits at
 * (k + phase) * pitch for each whole k, as long as it stays at least half a pitch from
 * each end. A 444.5 mm channel's 0.5 in row (pitch 12.7, phase 0) therefore has 35
 * holes, from -215.9 to +215.9.
 */
export function holePositions(row: HoleRow, lengthMm: number): number[] {
  if (!(lengthMm > 0))
    throw new RangeError("Length must be a positive number of millimetres")
  const limit = lengthMm / 2 - row.pitch / 2 + 1e-9
  const reach = Math.ceil(lengthMm / row.pitch) + 2
  const positions: number[] = []
  for (let k = -reach; k <= reach; k++) {
    const at = (k + row.phase) * row.pitch
    if (Math.abs(at) <= limit) positions.push(round(at))
  }
  return positions
}

const round = (x: number) => Math.round(x * 1e6) / 1e6
