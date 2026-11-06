// Finds round holes in a tessellated STEP model. Each B-rep face that occt reports
// (its triangle range in `brep_faces`) is tested for being a full-ish cylinder:
// its vertex normals must all be perpendicular to one axis, and its vertices must
// lie on one circle around that axis. A cylinder whose normals point toward the
// axis is a hole (a bore in material); one whose normals point away is a pin or a
// shaft, and is ignored.

import {
  add,
  cross,
  dot,
  eigenSymmetric3,
  length,
  normalize,
  scale,
  sub,
} from "./linalg.mjs";

export const MIN_HOLE_DIAMETER_MM = 1.5;
export const MAX_HOLE_DIAMETER_MM = 12;
// Holes can be split into two or more B-rep faces; a face must cover at least this
// much of the circle before it counts as part of a hole.
const MIN_ARC_DEG = 170;

/** The unique vertex positions and normals used by one B-rep face. */
export function faceVertices(mesh, face) {
  const { index, attributes } = mesh;
  const seen = new Set();
  const positions = [];
  const normals = [];
  for (let t = face.first; t <= face.last; t++) {
    for (let k = 0; k < 3; k++) {
      const v = index.array[t * 3 + k];
      if (seen.has(v)) continue;
      seen.add(v);
      const p = attributes.position.array;
      const n = attributes.normal.array;
      positions.push([p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]);
      normals.push(normalize([n[v * 3], n[v * 3 + 1], n[v * 3 + 2]]));
    }
  }
  return { positions, normals };
}

function perpendicularBasis(axis) {
  const helper = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(axis, helper));
  return [u, cross(axis, u)];
}

/** Least-squares circle through 2D points (Kasa fit). Returns { x, y, r, maxError }. */
function fitCircle(points) {
  // Solve [sum(X X^T)] theta = sum(X Y) with X = [2x, 2y, 1], Y = x^2 + y^2.
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = points.length;
  let bx = 0, by = 0, bc = 0;
  for (const [x, y] of points) {
    const X = [2 * x, 2 * y, 1];
    const Y = x * x + y * y;
    sxx += X[0] * X[0];
    sxy += X[0] * X[1];
    sx += X[0] * X[2];
    syy += X[1] * X[1];
    sy += X[1] * X[2];
    bx += X[0] * Y;
    by += X[1] * Y;
    bc += Y;
  }
  const M = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const sol = solve3(M, [bx, by, bc]);
  if (!sol) return null;
  const [a, b, c] = sol;
  const r2 = c + a * a + b * b;
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  let maxError = 0;
  for (const [x, y] of points)
    maxError = Math.max(maxError, Math.abs(Math.hypot(x - a, y - b) - r));
  return { x: a, y: b, r, maxError };
}

function solve3(M, b) {
  // Gaussian elimination with partial pivoting on a 3x3 system.
  const A = M.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++)
      if (Math.abs(A[row][col]) > Math.abs(A[pivot][col])) pivot = row;
    if (Math.abs(A[pivot][col]) < 1e-12) return null;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const f = A[row][col] / A[col][col];
      for (let k = col; k < 4; k++) A[row][k] -= f * A[col][k];
    }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}

/**
 * Tests one B-rep face. Returns a cylinder { axis, radius, center, span, arcDeg,
 * concave } or null when the face is not a cylinder covering at least MIN_ARC_DEG.
 * `center` is on the axis at the middle of the face's extent along it.
 */
export function fitCylinder(positions, normals) {
  if (positions.length < 6) return null;
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const n of normals)
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) cov[i][j] += n[i] * n[j] / normals.length;
  const { values, vectors } = eigenSymmetric3(cov);
  const [l1, l2, l3] = values;
  // Normals must all be perpendicular to the axis (l3 ~ 0) and spread evenly
  // around it (l1 ~ l2). Planes (l2 ~ 0) and spheres fail the second test.
  if (!(l1 > 0) || l3 / l1 > 0.02 || (l1 - l2) / l1 > 0.15) return null;
  const axis = vectors[2];
  const [u, v] = perpendicularBasis(axis);
  const planar = positions.map((p) => [dot(p, u), dot(p, v)]);
  const circle = fitCircle(planar);
  if (!circle || circle.maxError > 0.02 * circle.r + 0.01) return null;

  const angles = planar
    .map(([x, y]) => Math.atan2(y - circle.y, x - circle.x))
    .sort((p, q) => p - q);
  let largestGap = angles[0] + 2 * Math.PI - angles[angles.length - 1];
  for (let i = 1; i < angles.length; i++)
    largestGap = Math.max(largestGap, angles[i] - angles[i - 1]);
  const arcDeg = (360 * (2 * Math.PI - largestGap)) / (2 * Math.PI);
  if (arcDeg < MIN_ARC_DEG) return null;

  // Normals point toward the axis for a bore and away from it for a pin.
  let inward = 0;
  for (let i = 0; i < positions.length; i++) {
    const [x, y] = planar[i];
    const toAxis = add(scale(u, circle.x - x), scale(v, circle.y - y));
    inward += dot(normals[i], toAxis);
  }

  const axial = positions.map((p) => dot(p, axis));
  const lo = Math.min(...axial);
  const hi = Math.max(...axial);
  const centerAxial = (lo + hi) / 2;
  const center = add(scale(u, circle.x), add(scale(v, circle.y), scale(axis, centerAxial)));
  return {
    axis: canonicalAxis(axis),
    radius: circle.r,
    center,
    span: [lo, hi],
    arcDeg,
    concave: inward > 0,
  };
}

function canonicalAxis(axis) {
  const first = axis.find((c) => Math.abs(c) > 1e-6) ?? 0;
  return first < 0 ? scale(axis, -1) : axis;
}

/** Every cylinder found in one occt mesh, one entry per B-rep face that fits. */
export function cylindersInMesh(mesh) {
  const found = [];
  for (const face of mesh.brep_faces) {
    const { positions, normals } = faceVertices(mesh, face);
    const cylinder = fitCylinder(positions, normals);
    if (cylinder) found.push({ ...cylinder, faceTriangles: face.last - face.first + 1 });
  }
  return found;
}

/**
 * Merges B-rep faces that belong to one physical cylinder (same axis line, same
 * radius) and keeps the ones within the diameter range. `concave` picks bores
 * (holes) or convex cylinders (pins, shanks).
 */
export function detectCylinders(meshes, { concave }) {
  const cylinders = meshes.flatMap(cylindersInMesh).filter(
    (c) =>
      c.concave === concave &&
      2 * c.radius >= MIN_HOLE_DIAMETER_MM &&
      2 * c.radius <= MAX_HOLE_DIAMETER_MM
  );
  const holes = [];
  for (const c of cylinders) {
    const same = holes.find(
      (h) =>
        Math.abs(dot(h.axis, c.axis)) > 0.999 &&
        Math.abs(h.radius - c.radius) < 0.05 &&
        distanceToLine(c.center, h.center, h.axis) < 0.05
    );
    if (same) {
      same.span = [Math.min(same.span[0], c.span[0]), Math.max(same.span[1], c.span[1])];
      same.arcDeg = Math.min(360, same.arcDeg + c.arcDeg);
      same.faces += 1;
    } else {
      holes.push({ ...c, faces: 1 });
    }
  }
  return holes.map((h) => {
    // Recentre along the axis on the merged span.
    const offset = (h.span[0] + h.span[1]) / 2 - dot(h.center, h.axis);
    return {
      center: add(h.center, scale(h.axis, offset)),
      axis: h.axis,
      diameterMm: round(2 * h.radius),
      depthMm: round(h.span[1] - h.span[0]),
      faces: h.faces,
    };
  });
}

/** Bores in material: the holes that snap Parts together. */
export const detectHoles = (meshes) => detectCylinders(meshes, { concave: true });
/** Convex cylinders such as screw shanks and motor output shafts. */
export const detectPins = (meshes) => detectCylinders(meshes, { concave: false });

function distanceToLine(point, origin, axis) {
  const rel = sub(point, origin);
  return length(sub(rel, scale(axis, dot(rel, axis))));
}

const round = (x) => Math.round(x * 1000) / 1000;
