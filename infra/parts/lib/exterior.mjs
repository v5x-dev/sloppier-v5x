// Keeps only the triangles a viewer could see from outside the Part.
//
// The STEP tessellation holds every solid, including gears, shafts and circuit boards
// sealed inside a case. They are invisible in the Design app but cost triangles and
// show through the transparent placing ghost. Here the bounding box is voxelised: each
// triangle marks the voxels its surface passes through. Empty voxels reachable from the
// outside of the box (6-connected flood fill from the padding) are "exterior". A triangle
// is kept when a voxel it touches is next to an exterior voxel, so every face that faces
// open air survives, including faces seen through a socket, a port or a vent. Sealed
// internals never touch exterior air and are dropped.
//
// Two rules keep the result on the safe side. Surface voxels are conservative (sample
// spacing is half a voxel), so a gap narrower than a voxel counts as sealed and hides
// what is behind it. A leak through a missed surface keeps internals, which only costs
// triangles. Volume and mass come from the STEP solid, not from this mesh, so culling
// never changes them.

const PAD_VOXELS = 2;
const MAX_SAMPLES_PER_EDGE = 64;

/**
 * Chooses a voxel size that keeps the grid near `targetCells` on its longest side, and
 * never finer than `minVoxelMm`.
 */
export function voxelSizeFor(bounds, { minVoxelMm = 0.2, cellsAcross = 400 } = {}) {
  const extent = Math.max(...bounds.max.map((v, k) => v - bounds.min[k]));
  return Math.max(minVoxelMm, extent / cellsAcross);
}

/**
 * @param positions Float32Array of xyz (welded: shared vertices share an index).
 * @param indices Uint32Array of triangles.
 * @param voxelMm voxel edge length in millimetres.
 * @returns {{ keep: Uint8Array, exteriorVoxels: number, voxels: number }}
 *   keep[t] is 1 for a triangle a viewer can see from outside.
 */
export function classifyExterior(positions, indices, voxelMm, { sealVoxels = 1 } = {}) {
  const triangles = indices.length / 3;
  const keep = new Uint8Array(triangles);
  if (triangles === 0) return { keep, exteriorVoxels: 0, voxels: 0 };

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], positions[i + k]);
      hi[k] = Math.max(hi[k], positions[i + k]);
    }
  const h = voxelMm;
  const origin = lo.map((v) => v - PAD_VOXELS * h);
  const dims = [0, 1, 2].map((k) => Math.ceil((hi[k] - lo[k]) / h) + 2 * PAD_VOXELS + 1);
  const [nx, ny, nz] = dims;
  const cells = nx * ny * nz;
  const surface = new Uint8Array(cells);
  const voxelOf = (x, y, z) =>
    Math.floor((x - origin[0]) / h) +
    nx * (Math.floor((y - origin[1]) / h) + ny * Math.floor((z - origin[2]) / h));

  // Samples on each triangle, spaced at half a voxel, mark the surface voxels.
  for (let t = 0; t < triangles; t++) {
    const samples = triangleSamples(positions, indices, t, h / 2);
    for (const [x, y, z] of samples) surface[voxelOf(x, y, z)] = 1;
  }

  // Close seams: grow the surface by `sealVoxels`, so a gap narrower than that cannot
  // carry the flood into the case. Real openings are millimetres wide and survive.
  const sealed = dilate(surface, nx, ny, nz, sealVoxels);

  // Flood fill the empty voxels that touch the padding, 6-connected.
  const exterior = new Uint8Array(cells);
  const queue = new Uint32Array(cells);
  let head = 0;
  let tail = 0;
  const seed = (index) => {
    if (sealed[index] || exterior[index]) return;
    exterior[index] = 1;
    queue[tail++] = index;
  };
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++)
        if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1)
          seed(x + nx * (y + ny * z));
  // The padding is wider than the seal, so the border is always outside the sealed surface.
  let exteriorVoxels = 0;
  while (head < tail) {
    const index = queue[head++];
    exteriorVoxels += 1;
    const x = index % nx;
    const y = Math.floor(index / nx) % ny;
    const z = Math.floor(index / (nx * ny));
    if (x > 0) seed(index - 1);
    if (x < nx - 1) seed(index + 1);
    if (y > 0) seed(index - nx);
    if (y < ny - 1) seed(index + nx);
    if (z > 0) seed(index - nx * ny);
    if (z < nz - 1) seed(index + nx * ny);
  }

  // A triangle is visible when a voxel it touches has exterior air within `sealVoxels + 1`
  // voxels (Chebyshev), which is where the flood stops at its sealed surface.
  const reach = sealVoxels + 1;
  for (let t = 0; t < triangles; t++) {
    for (const [x, y, z] of triangleSamples(positions, indices, t, h / 2)) {
      if (touchesExterior(exterior, nx, ny, nz, voxelOf(x, y, z), reach)) {
        keep[t] = 1;
        break;
      }
    }
  }
  return { keep, exteriorVoxels, voxels: cells };
}

function touchesExterior(exterior, nx, ny, nz, index, reach) {
  const x = index % nx;
  const y = Math.floor(index / nx) % ny;
  const z = Math.floor(index / (nx * ny));
  for (let dz = -reach; dz <= reach; dz++) {
    const zz = z + dz;
    if (zz < 0 || zz >= nz) continue;
    for (let dy = -reach; dy <= reach; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= ny) continue;
      for (let dx = -reach; dx <= reach; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= nx) continue;
        if (exterior[xx + nx * (yy + ny * zz)]) return true;
      }
    }
  }
  return false;
}

/** Grows a 0/1 voxel mask by `radius` voxels in every direction (Chebyshev). */
function dilate(mask, nx, ny, nz, radius) {
  if (radius <= 0) return mask;
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % nx;
    const y = Math.floor(i / nx) % ny;
    const z = Math.floor(i / (nx * ny));
    for (let dz = -radius; dz <= radius; dz++) {
      const zz = z + dz;
      if (zz < 0 || zz >= nz) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= ny) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= nx) continue;
          out[xx + nx * (yy + ny * zz)] = 1;
        }
      }
    }
  }
  return out;
}

/** Points on triangle t, spaced at most `spacing` apart along its edges. */
function triangleSamples(positions, indices, t, spacing) {
  const ia = indices[t * 3] * 3;
  const ib = indices[t * 3 + 1] * 3;
  const ic = indices[t * 3 + 2] * 3;
  const a = [positions[ia], positions[ia + 1], positions[ia + 2]];
  const b = [positions[ib], positions[ib + 1], positions[ib + 2]];
  const c = [positions[ic], positions[ic + 1], positions[ic + 2]];
  const edge = Math.max(dist(a, b), dist(b, c), dist(c, a));
  const n = Math.min(MAX_SAMPLES_PER_EDGE, Math.max(1, Math.ceil(edge / spacing)));
  const out = [];
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n - i; j++) {
      const u = i / n;
      const v = j / n;
      out.push([0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * u + (c[k] - a[k]) * v));
    }
  return out;
}

function dist(p, q) {
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
