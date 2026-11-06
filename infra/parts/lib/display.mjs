// Builds the display mesh for a fixed Part: the shape a viewer sees, not the solid the
// STEP describes. Volume, mass and Snap Points are derived from the full STEP elsewhere,
// so this mesh can drop what is not visible without changing any catalog number.
//
// Steps:
//   1. Weld every solid's triangles into one mesh, and tag each triangle with its colour.
//   2. Keep only the triangles that face open air (lib/exterior.mjs).
//   3. For each colour, simplify that region toward its share of the budget. Feature
//      edges (dihedral above the crease angle, colour boundaries, and open edges) are
//      locked, so the simplifier cannot round off a real edge. Other vertices move
//      under a quadric error and a normal-attribute term, which keeps curved surfaces
//      smooth.
//   4. Compute crease-aware normals (lib/normals.mjs) and join the regions, which
//      carry their colour as vertex colours. The result is one primitive, so the
//      viewport still draws one instanced mesh per Part.

import { MeshoptSimplifier } from "meshoptimizer";
import { classifyExterior, voxelSizeFor } from "./exterior.mjs";
import { creaseNormals } from "./normals.mjs";
import { stepToPartDirection, stepToPartPoint } from "./mesh.mjs";

export const DEFAULT_CREASE_DEG = 35;
const MIN_REGION_TRIANGLES = 64;

/**
 * @param meshes occt meshes (position, index, color) for the Part, as analyse.mjs returns.
 * @param options.budgetTriangles the most triangles the display mesh may have.
 * @param options.maxErrorMm the largest surface error the simplifier may introduce.
 * @param options.creaseDeg the dihedral angle above which an edge is a hard edge.
 * @param options.sealVoxels seam closing radius for the exterior test.
 * @param options.fallbackColor colour for a solid that carries none, as [r, g, b].
 */
export async function displayMesh(meshes, options) {
  const {
    budgetTriangles,
    maxErrorMm,
    creaseDeg = DEFAULT_CREASE_DEG,
    sealVoxels = 1,
    fallbackColor = [0.5, 0.5, 0.5],
    normalWeight = 0,
  } = options;
  const welded = weldTagged(meshes, fallbackColor);
  const voxelMm = voxelSizeFor(welded.bounds);
  const cull = classifyExterior(welded.positions, welded.indices, voxelMm, { sealVoxels });
  const kept = triangleSubset(welded, cull.keep);

  const regions = splitByColor(kept);
  const total = regions.reduce((sum, r) => sum + r.indices.length / 3, 0);
  const regionOut = [];
  let worstError = 0;
  for (const region of regions) {
    const share = region.indices.length / 3 / Math.max(1, total);
    const target = Math.max(MIN_REGION_TRIANGLES, Math.round(budgetTriangles * share));
    const simplified = await simplifyRegion(region, welded.positions, target, maxErrorMm, creaseDeg, normalWeight);
    worstError = Math.max(worstError, simplified.errorMm);
    const shaded = creaseNormals(simplified.positions, simplified.indices, creaseDeg);
    regionOut.push({ ...shaded, color: region.color, errorMm: simplified.errorMm });
  }
  const merged = toPartFrame(joinRegions(regionOut), welded.bounds);
  return {
    ...merged,
    triangles: merged.indices.length / 3,
    keptTriangles: kept.indices.length / 3,
    rawTriangles: welded.indices.length / 3,
    errorMm: worstError,
    voxelMm,
    regions: regionOut.map((r) => ({ color: r.color, triangles: r.indices.length / 3 })),
  };
}

/**
 * Moves the joined mesh from STEP's Z-up millimetres into the Part frame (Y up, centred on
 * the bounding box), the frame every catalog number and GLB uses.
 */
export function toPartFrame(mesh, bounds) {
  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const p = stepToPartPoint([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]], bounds);
    const n = stepToPartDirection([mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]]);
    positions.set(p, i);
    normals.set(n, i);
  }
  return { ...mesh, positions, normals };
}

/** Welds every mesh into one position list, and records each triangle's colour index. */
export function weldTagged(meshes, fallbackColor) {
  const keyOf = new Map();
  const positions = [];
  const indices = [];
  const triColor = [];
  const palette = [];
  const paletteIndex = new Map();
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const mesh of meshes) {
    const p = mesh.attributes.position.array;
    const remap = new Uint32Array(p.length / 3);
    for (let v = 0; v < p.length / 3; v++) {
      const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
      for (let k = 0; k < 3; k++) {
        bounds.min[k] = Math.min(bounds.min[k], p[v * 3 + k]);
        bounds.max[k] = Math.max(bounds.max[k], p[v * 3 + k]);
      }
      const key = `${Math.round(x / 1e-4)},${Math.round(y / 1e-4)},${Math.round(z / 1e-4)}`;
      let id = keyOf.get(key);
      if (id === undefined) {
        id = positions.length / 3;
        keyOf.set(key, id);
        positions.push(x, y, z);
      }
      remap[v] = id;
    }
    const color = mesh.color ? mesh.color.slice(0, 3) : fallbackColor;
    const colorKey = color.map((c) => Math.round(c * 1000)).join(",");
    let ci = paletteIndex.get(colorKey);
    if (ci === undefined) {
      ci = palette.length;
      paletteIndex.set(colorKey, ci);
      palette.push(color);
    }
    const idx = mesh.index.array;
    for (let t = 0; t < idx.length; t += 3) {
      indices.push(remap[idx[t]], remap[idx[t + 1]], remap[idx[t + 2]]);
      triColor.push(ci);
    }
  }
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    triColor: Uint8Array.from(triColor),
    palette,
    bounds: withCenter(bounds),
  };
}

function withCenter(bounds) {
  return { ...bounds, center: bounds.min.map((v, k) => (v + bounds.max[k]) / 2) };
}

function triangleSubset(mesh, keep) {
  const indices = [];
  const triColor = [];
  for (let t = 0; t < keep.length; t++) {
    if (!keep[t]) continue;
    indices.push(mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]);
    triColor.push(mesh.triColor[t]);
  }
  return { positions: mesh.positions, indices: Uint32Array.from(indices), triColor: Uint8Array.from(triColor), palette: mesh.palette };
}

/** Splits the kept triangles into one welded region per colour. */
function splitByColor(mesh) {
  const regions = [];
  for (let ci = 0; ci < mesh.palette.length; ci++) {
    const tris = [];
    for (let t = 0; t < mesh.triColor.length; t++)
      if (mesh.triColor[t] === ci) tris.push(mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]);
    if (tris.length === 0) continue;
    regions.push({ color: mesh.palette[ci], indices: Uint32Array.from(tris), positions: mesh.positions });
  }
  return regions;
}

/**
 * Simplifies one colour region. Vertices are compacted first, so the simplifier sees only
 * this region's vertices, and the lock array pins feature vertices.
 */
export async function simplifyRegion(region, allPositions, targetTriangles, maxErrorMm, creaseDeg, normalWeight) {
  await MeshoptSimplifier.ready;
  const { positions, indices } = compactVertices(region.indices, allPositions);
  const normals = vertexNormals(positions, indices);
  const lock = lockedVertices(positions, indices, creaseDeg);
  const triangles = indices.length / 3;
  const target = Math.min(triangles, targetTriangles) * 3;
  const [reduced, error] = MeshoptSimplifier.simplifyWithAttributes(
    indices,
    positions,
    3,
    normals,
    3,
    [normalWeight, normalWeight, normalWeight],
    lock,
    target,
    maxErrorMm,
    ["ErrorAbsolute"]
  );
  const compact = compactVertices(reduced, positions);
  return { positions: compact.positions, indices: compact.indices, errorMm: error };
}

/** A region's own vertex list, renumbered from zero. Unused vertices are dropped. */
export function compactVertices(indices, allPositions) {
  const remap = new Map();
  const out = [];
  const local = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    let id = remap.get(v);
    if (id === undefined) {
      id = out.length / 3;
      remap.set(v, id);
      out.push(allPositions[v * 3], allPositions[v * 3 + 1], allPositions[v * 3 + 2]);
    }
    local[i] = id;
  }
  return { positions: Float32Array.from(out), indices: local };
}

/** Area-weighted average of the faces around each vertex (a smooth attribute for the simplifier). */
export function vertexNormals(positions, indices) {
  const out = new Float32Array(positions.length);
  for (let t = 0; t < indices.length / 3; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    const u = [0, 1, 2].map((k) => positions[b + k] - positions[a + k]);
    const v = [0, 1, 2].map((k) => positions[c + k] - positions[a + k]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const i of [a, b, c]) for (let k = 0; k < 3; k++) out[i + k] += n[k];
  }
  for (let i = 0; i < out.length; i += 3) {
    const len = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
    out[i] /= len;
    out[i + 1] /= len;
    out[i + 2] /= len;
  }
  return out;
}

/**
 * Locks vertices on feature edges: edges with other than two faces (open or shared), and
 * edges whose two faces meet at more than the crease angle.
 */
export function lockedVertices(positions, indices, creaseDeg) {
  const cosCrease = Math.cos((creaseDeg * Math.PI) / 180);
  const edges = new Map();
  const faceNormal = (t) => {
    const [a, b, c] = [0, 1, 2].map((k) => indices[t * 3 + k] * 3);
    const u = [0, 1, 2].map((k) => positions[b + k] - positions[a + k]);
    const v = [0, 1, 2].map((k) => positions[c + k] - positions[a + k]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1;
    return n.map((x) => x / len);
  };
  const triangles = indices.length / 3;
  for (let t = 0; t < triangles; t++) {
    for (let k = 0; k < 3; k++) {
      const p = indices[t * 3 + k], q = indices[t * 3 + ((k + 1) % 3)];
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      const list = edges.get(key);
      if (list) list.push(t);
      else edges.set(key, [t]);
    }
  }
  const lock = new Uint8Array(positions.length / 3);
  for (const [key, list] of edges) {
    const [p, q] = key.split(",").map(Number);
    let hard = list.length !== 2;
    if (!hard) {
      const n0 = faceNormal(list[0]), n1 = faceNormal(list[1]);
      hard = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] < cosCrease;
    }
    if (hard) {
      lock[p] = 1;
      lock[q] = 1;
    }
  }
  return lock;
}

/** Concatenates regions. Each region keeps its own vertices, so colour boundaries stay sharp. */
export function joinRegions(regions) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const r of regions) {
    vertexCount += r.positions.length / 3;
    indexCount += r.indices.length;
  }
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  let v0 = 0;
  let i0 = 0;
  for (const r of regions) {
    const n = r.positions.length / 3;
    positions.set(r.positions, v0 * 3);
    normals.set(r.normals, v0 * 3);
    for (let v = 0; v < n; v++) colors.set(r.color, (v0 + v) * 3);
    for (let i = 0; i < r.indices.length; i++) indices[i0 + i] = r.indices[i] + v0;
    v0 += n;
    i0 += r.indices.length;
  }
  return { positions, normals, colors, indices };
}
