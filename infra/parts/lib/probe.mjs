// Ray probes against a tessellated model. Used to find square holes, which have no
// cylindrical faces, and to check computed hole grids against the real geometry.
// A ray runs parallel to one axis and reports every place it crosses a triangle.

const CELL_MM = 1;

/** Buckets triangles by their projection onto the plane perpendicular to `axis`. */
export function rayIndex(mesh, axis) {
  const [b, c] = [(axis + 1) % 3, (axis + 2) % 3];
  const p = mesh.attributes.position.array;
  const idx = mesh.index.array;
  const cells = new Map();
  const tris = [];
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t * 3 < idx.length; t++) {
    const v = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]].map((i) => [
      p[i * 3],
      p[i * 3 + 1],
      p[i * 3 + 2],
    ]);
    tris.push(v);
    for (const q of v) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], q[k]);
      hi[k] = Math.max(hi[k], q[k]);
    }
    const minB = Math.min(v[0][b], v[1][b], v[2][b]);
    const maxB = Math.max(v[0][b], v[1][b], v[2][b]);
    const minC = Math.min(v[0][c], v[1][c], v[2][c]);
    const maxC = Math.max(v[0][c], v[1][c], v[2][c]);
    for (let i = Math.floor(minB / CELL_MM); i <= Math.floor(maxB / CELL_MM); i++)
      for (let j = Math.floor(minC / CELL_MM); j <= Math.floor(maxC / CELL_MM); j++) {
        const key = `${i},${j}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(t);
      }
  }
  return { axis, b, c, cells, tris, lo, hi };
}

/** Every distance along the axis where the line through (u, v) meets the model. */
export function hitsAt(index, u, v) {
  const { axis, b, c, cells, tris } = index;
  const bucket = cells.get(`${Math.floor(u / CELL_MM)},${Math.floor(v / CELL_MM)}`);
  if (!bucket) return [];
  const hits = [];
  for (const t of bucket) {
    const [p0, p1, p2] = tris[t];
    const d = (p0[b] - p2[b]) * (p1[c] - p2[c]) - (p1[b] - p2[b]) * (p0[c] - p2[c]);
    if (Math.abs(d) < 1e-12) continue;
    const w0 = ((p1[c] - p2[c]) * (u - p2[b]) + (p2[b] - p1[b]) * (v - p2[c])) / d;
    const w1 = ((p2[c] - p0[c]) * (u - p2[b]) + (p0[b] - p2[b]) * (v - p2[c])) / d;
    const w2 = 1 - w0 - w1;
    const eps = -1e-9;
    if (w0 < eps || w1 < eps || w2 < eps) continue;
    hits.push(w0 * p0[axis] + w1 * p1[axis] + w2 * p2[axis]);
  }
  hits.sort((x, y) => x - y);
  return hits.filter((h, i) => i === 0 || h - hits[i - 1] > 1e-6);
}

/**
 * Scans the projection of a model on a regular grid and returns the enclosed holes:
 * empty samples that cannot reach the outside of the outline. Each hole has a centre
 * (in the two in-plane axes) and a size. Holes are returned in plane coordinates.
 */
export function findThroughHoles(index, stepMm = 0.5) {
  const { lo, hi, b, c } = index;
  const nb = Math.ceil((hi[b] - lo[b]) / stepMm) + 1;
  const nc = Math.ceil((hi[c] - lo[c]) / stepMm) + 1;
  const solid = new Uint8Array(nb * nc);
  for (let i = 0; i < nb; i++)
    for (let j = 0; j < nc; j++) {
      const u = lo[b] + i * stepMm;
      const v = lo[c] + j * stepMm;
      solid[i * nc + j] = hitsAt(index, u, v).length > 0 ? 1 : 0;
    }
  // Flood-fill empty samples from the border; anything empty not reached is a hole.
  const outside = new Uint8Array(nb * nc);
  const queue = [];
  const push = (i, j) => {
    const k = i * nc + j;
    if (outside[k] || solid[k]) return;
    outside[k] = 1;
    queue.push(k);
  };
  for (let i = 0; i < nb; i++) {
    push(i, 0);
    push(i, nc - 1);
  }
  for (let j = 0; j < nc; j++) {
    push(0, j);
    push(nb - 1, j);
  }
  while (queue.length) {
    const k = queue.pop();
    const i = Math.floor(k / nc);
    const j = k % nc;
    if (i > 0) push(i - 1, j);
    if (i < nb - 1) push(i + 1, j);
    if (j > 0) push(i, j - 1);
    if (j < nc - 1) push(i, j + 1);
  }
  const seen = new Uint8Array(nb * nc);
  const holes = [];
  for (let k = 0; k < nb * nc; k++) {
    if (solid[k] || outside[k] || seen[k]) continue;
    const component = [];
    const stack = [k];
    seen[k] = 1;
    while (stack.length) {
      const q = stack.pop();
      component.push(q);
      const i = Math.floor(q / nc);
      const j = q % nc;
      for (const [ni, nj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        if (ni < 0 || nj < 0 || ni >= nb || nj >= nc) continue;
        const nk = ni * nc + nj;
        if (seen[nk] || solid[nk] || outside[nk]) continue;
        seen[nk] = 1;
        stack.push(nk);
      }
    }
    const xs = component.map((q) => lo[b] + Math.floor(q / nc) * stepMm);
    const ys = component.map((q) => lo[c] + (q % nc) * stepMm);
    const cu = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cv = (Math.min(...ys) + Math.max(...ys)) / 2;
    holes.push({
      u: round(cu),
      v: round(cv),
      sizeU: round(Math.max(...xs) - Math.min(...xs) + stepMm),
      sizeV: round(Math.max(...ys) - Math.min(...ys) + stepMm),
    });
  }
  return holes;
}

const round = (x) => Math.round(x * 1000) / 1000;
