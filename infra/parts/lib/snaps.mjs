// Snap Points for fixed models. Each point is where another Part can line up: the
// opening of a bore, the end of a fastener's shank, a probed hole in a flat part, or
// the axle of a wheel. All positions are in the Part frame: millimetres, Y up, origin
// at the centre of the bounding box. Directions point out of the Part.

import { add, scale } from "./linalg.mjs";
import { stepToPartDirection, stepToPartPoint } from "./mesh.mjs";

// Chamfers shorten a bore's cylindrical faces, so an opening can sit up to this far
// inside the bounding box.
const OPENING_TOLERANCE_MM = 0.5;

/** Snap points for every bore: one per end that opens onto the outside of the Part. */
export function boreSnaps(bores, bounds) {
  const points = [];
  for (const bore of bores) {
    const half = bore.depthMm / 2;
    const ends = [
      { at: add(bore.center, scale(bore.axis, -half)), dir: scale(bore.axis, -1) },
      { at: add(bore.center, scale(bore.axis, half)), dir: bore.axis },
    ];
    for (const end of ends) {
      if (!onBoundary(end.at, bounds)) continue;
      points.push({
        kind: "hole",
        source: "detected",
        position: stepToPartPoint(end.at, bounds),
        axis: stepToPartDirection(end.dir),
        diameterMm: bore.diameterMm,
        depthMm: bore.depthMm,
      });
    }
  }
  return points;
}

/**
 * Bores matched by a manifest rule, with both ends given as snap points. Used where the
 * bores run through a body whose outline the bounding box does not reach, such as the
 * V5 motor's mounting holes. These are hand corrections, so each rule is recorded in the
 * manifest.
 */
export function ruledBoreSnaps(bores, bounds, rule) {
  const points = [];
  for (const bore of bores) {
    if (bore.diameterMm < rule.minDiameterMm || bore.diameterMm > rule.maxDiameterMm) continue;
    if (bore.depthMm < rule.minDepthMm) continue;
    const half = bore.depthMm / 2;
    for (const sign of [-1, 1]) {
      points.push({
        kind: "hole",
        source: "manual",
        position: stepToPartPoint(add(bore.center, scale(bore.axis, sign * half)), bounds),
        axis: stepToPartDirection(scale(bore.axis, sign)),
        diameterMm: bore.diameterMm,
        depthMm: bore.depthMm,
      });
    }
  }
  return points;
}

/** The two ends of a fastener's shank: the underside of the head and the tip. */
export function shankSnaps(pins, bounds, range) {
  const shank = pins
    .filter((p) => p.diameterMm >= range.min && p.diameterMm <= range.max)
    .sort((a, b) => b.depthMm - a.depthMm)[0];
  if (!shank) return [];
  const half = shank.depthMm / 2;
  return [-1, 1].map((sign) => ({
    kind: "pin",
    source: "detected",
    position: stepToPartPoint(add(shank.center, scale(shank.axis, sign * half)), bounds),
    axis: stepToPartDirection(scale(shank.axis, sign)),
    diameterMm: shank.diameterMm,
    depthMm: shank.depthMm,
  }));
}

/** Probed openings in a flat part, placed in the plane at mid-thickness. */
export function probedSnaps(holes, bounds, axis) {
  const b = (axis + 1) % 3, c = (axis + 2) % 3;
  const mid = (bounds.min[axis] + bounds.max[axis]) / 2;
  const normal = [0, 0, 0];
  normal[axis] = 1;
  return holes.map((h) => {
    const at = [0, 0, 0];
    at[b] = h.u;
    at[c] = h.v;
    at[axis] = mid;
    const square = Math.abs(h.widthMm - h.heightMm) <= 0.3;
    return {
      kind: "hole",
      source: "probed",
      shape: square ? "square" : "rect",
      position: stepToPartPoint(at, bounds),
      axis: stepToPartDirection(normal),
      diameterMm: Math.min(h.widthMm, h.heightMm),
      openingMm: [h.widthMm, h.heightMm],
    };
  });
}

/** The rotation axis of a wheel: its thinnest bounding-box direction. */
export function thinAxis(sizeMm) {
  const sizes = [sizeMm.x, sizeMm.y, sizeMm.z];
  return sizes.indexOf(Math.min(...sizes));
}

/** A computed axle at the wheel's centre. The hub bore is not reliably in the STEP. */
export function axleSnap(bounds, axis, diameterMm) {
  const normal = [0, 0, 0];
  normal[axis] = 1;
  return {
    kind: "axle",
    source: "computed",
    position: stepToPartPoint(bounds.center, bounds),
    axis: stepToPartDirection(normal),
    diameterMm,
    depthMm: bounds.max[axis] - bounds.min[axis],
  };
}

function onBoundary(point, bounds) {
  return [0, 1, 2].some(
    (k) =>
      Math.abs(point[k] - bounds.min[k]) <= OPENING_TOLERANCE_MM ||
      Math.abs(point[k] - bounds.max[k]) <= OPENING_TOLERANCE_MM
  );
}

