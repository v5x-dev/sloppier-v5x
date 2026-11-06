// Mesh steps shared by every model: weld the occt shells into one indexed mesh,
// reduce the triangle count with meshoptimizer, convert to a Y-up frame centred on
// the part, and write flat-shaded triangles for the GLB.

import { MeshoptSimplifier } from "meshoptimizer";

/** Joins every occt mesh into one indexed mesh, welding coincident vertices. */
export function weldMeshes(meshes, tolerance = 1e-4) {
  const keyOf = new Map();
  const out = [];
  const indices = [];
  for (const mesh of meshes) {
    const p = mesh.attributes.position.array;
    const remap = new Uint32Array(p.length / 3);
    for (let v = 0; v < p.length / 3; v++) {
      const key = [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]
        .map((c) => Math.round(c / tolerance))
        .join(",");
      let id = keyOf.get(key);
      if (id === undefined) {
        id = out.length / 3;
        keyOf.set(key, id);
        out.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
      }
      remap[v] = id;
    }
    for (const i of mesh.index.array) indices.push(remap[i]);
  }
  return { positions: new Float32Array(out), indices: Uint32Array.from(indices) };
}

/**
 * Reduces the mesh toward `targetTriangles`. The simplifier stops early when the
 * next collapse would move the surface more than `maxErrorMm`, so the result can
 * have more triangles than asked for; callers report what they got.
 */
export async function simplifyMesh({ positions, indices }, targetTriangles, maxErrorMm) {
  await MeshoptSimplifier.ready;
  const target = Math.min(indices.length, targetTriangles * 3);
  const [reduced, error] = MeshoptSimplifier.simplify(
    indices,
    positions,
    3,
    target,
    maxErrorMm,
    ["ErrorAbsolute"]
  );
  return { positions, indices: reduced, errorMm: error };
}

/**
 * Converts STEP millimetres (Z up) to glTF-style Y up, centred on the bounds.
 * The rotation is about X by -90 degrees, which keeps the part right-handed.
 */
export function stepToPartPoint(point, bounds) {
  const c = bounds.center;
  // Adding zero turns -0 into 0, so the catalog never holds a negative zero.
  return [point[0] - c[0] + 0, point[2] - c[2] + 0, -(point[1] - c[1]) + 0];
}

export function stepToPartDirection(dir) {
  return [dir[0] + 0, dir[2] + 0, -dir[1] + 0];
}

/** Flat-shaded, unindexed triangles: one normal per face, which suits CAD edges. */
export function flatTriangles({ positions, indices }) {
  const count = indices.length / 3;
  const outPos = new Float32Array(count * 9);
  const outNrm = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    const p = [a, b, c].map((i) => [positions[i], positions[i + 1], positions[i + 2]]);
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1;
    n = n.map((x) => x / len);
    for (let k = 0; k < 3; k++) {
      outPos.set(p[k], t * 9 + k * 3);
      outNrm.set(n, t * 9 + k * 3);
    }
  }
  return { positions: outPos, normals: outNrm, triangles: count };
}
