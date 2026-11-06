// Hole patterns. Cut Parts (channels, angles) are described in the catalog as rows of
// holes; this module checks those rows against the holes the probe finds in the STEP
// geometry. Plates are checked against a 0.25 in lattice.
//
// A row is { wall, across, pitch, phase }: holes sit at (k + phase) * pitch along the
// length, for every whole k that keeps the hole at least half a pitch from each end.
// Coordinates are centred on the model's bounding box, in STEP axes (Z up).

import { hitsAt, rayIndex, findThroughHoles } from "./probe.mjs";

export const WALL_AXIS = { web: 2, side: 1 };
export const EDGE_TOLERANCE_MM = 0.3;

/** Positions along the length for one row, centred on zero. */
export function rowPositions({ pitch, phase = 0 }, lengthMm) {
  const limit = lengthMm / 2 - pitch / 2;
  const positions = [];
  for (let k = -Math.ceil(lengthMm / pitch) - 1; k <= Math.ceil(lengthMm / pitch) + 1; k++) {
    const p = (k + phase) * pitch;
    if (Math.abs(p) <= limit + 1e-6) positions.push(round(p));
  }
  return positions;
}

/**
 * Probes one axis of a model and keeps openings at least 1.5 mm across. Returns hole
 * centres as { axis, u, v } in the probe's own (u, v) plane coordinates, plus the
 * opening sizes.
 */
export function probeAxis(mesh, axis, stepMm = 0.25) {
  const index = rayIndex(mesh, axis);
  return findThroughHoles(index, stepMm)
    .filter((h) => h.sizeU >= 1.5 && h.sizeV >= 1.5)
    .map((h) => ({
      axis,
      u: h.u,
      v: h.v,
      widthMm: round(h.sizeU - stepMm),
      heightMm: round(h.sizeV - stepMm),
    }));
}

/**
 * Compares rows against probed holes. `probed` holes are in STEP coordinates; the
 * bounds centre is subtracted so both sides use the catalog's frame.
 * Returns the counts and the holes that did not match on either side.
 */
export function compareRows(rows, lengthMm, probed, centre, tolerance = EDGE_TOLERANCE_MM) {
  const expected = [];
  for (const row of rows) {
    const axis = WALL_AXIS[row.wall];
    for (const p of rowPositions(row, lengthMm)) {
      // The probe's (u, v) follow the axis order: for axis 2 they are (x, y), for axis 1 (z, x).
      const pair = axis === 2 ? [p, row.across] : [row.across, p];
      expected.push({ axis, u: pair[0], v: pair[1] });
    }
  }
  const found = probed.map((h) => ({
    axis: h.axis,
    u: h.u - centre[(h.axis + 1) % 3],
    v: h.v - centre[(h.axis + 2) % 3],
  }));
  const unmatchedExpected = [];
  const unmatchedFound = found.slice();
  for (const e of expected) {
    const at = unmatchedFound.findIndex(
      (f) => f.axis === e.axis && Math.abs(f.u - e.u) <= tolerance && Math.abs(f.v - e.v) <= tolerance
    );
    if (at < 0) unmatchedExpected.push(e);
    else unmatchedFound.splice(at, 1);
  }
  return {
    expected: expected.length,
    found: found.length,
    matched: expected.length - unmatchedExpected.length,
    missing: unmatchedExpected,
    extra: unmatchedFound,
  };
}

/**
 * Tests every site of a square lattice that starts at the bounds' corner. A site is an
 * opening when no material lies on its ray, which also finds half-holes that break
 * the outline (the flood fill in findThroughHoles treats those as outside). Each site is
 * probed a hair inside the outline so the test stays off the edge geometry.
 * Returns openings for each checkerboard parity, so the caller can confirm that only
 * one parity is drilled.
 */
export function latticeOpenings(meshes, axis, bounds, pitchMm = 6.35, inset = 0.05) {
  const b = (axis + 1) % 3, c = (axis + 2) % 3;
  const indexes = meshes.filter((m) => m.brep_faces.length).map((m) => rayIndex(m, axis));
  const I = Math.round((bounds.max[b] - bounds.min[b]) / pitchMm);
  const J = Math.round((bounds.max[c] - bounds.min[c]) / pitchMm);
  const openings = { even: [], odd: [] };
  for (let i = 0; i <= I; i++)
    for (let j = 0; j <= J; j++) {
      const u = bounds.min[b] + i * pitchMm;
      const v = bounds.min[c] + j * pitchMm;
      const nu = i === 0 ? u + inset : i === I ? u - inset : u;
      const nv = j === 0 ? v + inset : j === J ? v - inset : v;
      const hits = indexes.flatMap((index) => hitsAt(index, nu, nv));
      if (hits.length === 0) openings[(i + j) % 2 === 0 ? "even" : "odd"].push({ u, v, i, j });
    }
  return { sites: (I + 1) * (J + 1), openings };
}

const round = (x) => Math.round(x * 1000) / 1000;
