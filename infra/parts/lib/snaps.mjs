// Snap Points for fixed models. Each point is where another Part can line up: the
// opening of a bore, the end of a fastener's shank, a probed hole in a flat part, or
// the axle of a wheel. All positions are in the Part frame: millimetres, Y up, origin
// at the centre of the bounding box. Directions point out of the Part.

import { add, scale } from "./linalg.mjs";
import { stepToPartDirection, stepToPartPoint } from "./mesh.mjs";
import { cylindersInMesh } from "./holes.mjs";
import { findThroughHoles, hitsAt, rayIndex } from "./probe.mjs";

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

/**
 * Snap Points for every through-opening: a straight channel that runs the whole length of
 * the Part along one axis. Found by ray probes on all bodies together, so a hole that
 * another body fills is not counted. Round openings take their diameter from the bore's
 * cylinder; the rest take the probed width. A channel gets one point at each face, with
 * the direction pointing out of that face, so a shaft or a screw can enter from either side.
 */
export function throughSnaps(meshes, bounds, { stepMm = 0.25, minMm = 1.5, maxMm = 26 } = {}) {
  const combined = combineMeshes(meshes);
  const cylinders = meshes
    .flatMap((m) => m.brep_faces.flatMap((f) => cylindersInMesh({ ...m, brep_faces: [f] })))
    .filter((c) => c.concave && 2 * c.radius >= minMm && 2 * c.radius <= maxMm);
  const points = [];
  for (let axis = 0; axis < 3; axis++) {
    const b = (axis + 1) % 3, c = (axis + 2) % 3;
    const index = rayIndex(combined, axis);
    // The coarse grid finds each opening; the edges are then measured on a fine scan, so a
    // 3.175 mm shaft is not read as a 3.0 mm bore.
    const holes = findThroughHoles(index, stepMm)
      .map((h) => refineOpening(index, h, stepMm))
      .filter((h) => h && Math.min(h.widthMm, h.heightMm) >= minMm && Math.max(h.widthMm, h.heightMm) <= maxMm);
    for (const h of holes) {
      const round_ = cylinders.find(
        (cyl) =>
          Math.abs(Math.abs(cyl.axis[axis]) - 1) < 0.01 &&
          Math.hypot(cyl.center[b] - h.u, cyl.center[c] - h.v) <= 0.6
      );
      const square = Math.abs(h.widthMm - h.heightMm) <= 0.3;
      const diameterMm = round_ ? round(2 * round_.radius) : round(Math.min(h.widthMm, h.heightMm));
      for (const sign of [-1, 1]) {
        const at = [0, 0, 0];
        at[b] = h.u;
        at[c] = h.v;
        at[axis] = sign < 0 ? bounds.min[axis] : bounds.max[axis];
        const dir = [0, 0, 0];
        dir[axis] = sign;
        points.push({
          kind: "hole",
          source: round_ ? "detected" : "probed",
          ...(round_ ? {} : { shape: square ? "square" : "rect" }),
          position: stepToPartPoint(at, bounds),
          axis: stepToPartDirection(dir),
          diameterMm,
          depthMm: round(bounds.max[axis] - bounds.min[axis]),
          openingMm: [h.widthMm, h.heightMm],
        });
      }
    }
  }
  return points;
}

const EDGE_STEP_MM = 0.02;

/**
 * Measures one coarse opening's edges along its two in-plane lines through the centre.
 * Returns { u, v, widthMm, heightMm } in probe coordinates, or null when the centre is solid.
 */
function refineOpening(index, coarse, stepMm) {
  const { u: u0, v: v0 } = coarse;
  if (hitsAt(index, u0, v0).length) return null;
  const reach = Math.max(coarse.sizeU, coarse.sizeV) + 2 * stepMm;
  const edge = (du, dv) => {
    for (let t = EDGE_STEP_MM; t <= reach; t += EDGE_STEP_MM)
      if (hitsAt(index, u0 + du * t, v0 + dv * t).length) return t - EDGE_STEP_MM / 2;
    return null;
  };
  const uPlus = edge(1, 0), uMinus = edge(-1, 0), vPlus = edge(0, 1), vMinus = edge(0, -1);
  if ([uPlus, uMinus, vPlus, vMinus].includes(null)) return null;
  return {
    u: round(u0 + (uPlus - uMinus) / 2),
    v: round(v0 + (vPlus - vMinus) / 2),
    widthMm: round(uPlus + uMinus),
    heightMm: round(vPlus + vMinus),
  };
}

/** One indexed mesh holding every body, so probes see the union of all of them. */
function combineMeshes(meshes) {
  const positions = [];
  const indices = [];
  let offset = 0;
  for (const m of meshes) {
    const p = m.attributes.position.array;
    for (let i = 0; i < p.length; i++) positions.push(p[i]);
    for (const i of m.index.array) indices.push(i + offset);
    offset += p.length / 3;
  }
  return {
    attributes: { position: { array: Float64Array.from(positions) } },
    index: { array: Uint32Array.from(indices) },
    brep_faces: [],
  };
}

const round = (x) => Math.round(x * 1000) / 1000;

/**
 * Two hand-placed sockets at the ends of a Part's longest axis, centred on its section.
 * For a Part whose drive socket is blind, so no bore reaches the outside: the coupler's
 * hex and star drives. The diameter is the manifest's, and the Part's notes say why.
 */
export function endSnaps(bounds, diameterMm) {
  const sizes = [0, 1, 2].map((k) => bounds.max[k] - bounds.min[k]);
  const axis = sizes.indexOf(Math.max(...sizes));
  const at0 = [0, 1, 2].map((k) => (bounds.min[k] + bounds.max[k]) / 2);
  return [-1, 1].map((sign) => {
    const at = at0.slice();
    at[axis] = sign < 0 ? bounds.min[axis] : bounds.max[axis];
    const dir = [0, 0, 0];
    dir[axis] = sign;
    return {
      kind: "hole",
      source: "manual",
      position: stepToPartPoint(at, bounds),
      axis: stepToPartDirection(dir),
      diameterMm,
      depthMm: round(sizes[axis]),
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

