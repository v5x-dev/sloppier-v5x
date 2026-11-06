// Shading normals with hard edges kept. Every triangle corner takes the average of the
// faces around its vertex that are within the crease angle of its own face. Curved
// surfaces, which tessellate into small facets, shade smooth. Edges sharper than the
// crease angle stay hard, because the corners on either side of them do not average
// across the edge. The output is indexed: a vertex is duplicated only where its normals
// differ, so hard edges have their own vertices and the file stays compact.

const QUANT = 1e4;

/**
 * @param positions Float32Array xyz, shared vertices shared by index.
 * @param indices Uint32Array triangles.
 * @param creaseDeg faces meeting at a dihedral angle above this are not smoothed.
 * @returns {{ positions: Float32Array, normals: Float32Array, indices: Uint32Array }}
 */
export function creaseNormals(positions, indices, creaseDeg) {
  const triangles = indices.length / 3;
  const faceArea = new Float64Array(triangles * 3); // unnormalised normal, length = 2 x area
  const faceUnit = new Float64Array(triangles * 3);
  for (let t = 0; t < triangles; t++) {
    const [a, b, c] = corners(indices, t, positions);
    const u = sub(b, a);
    const v = sub(c, a);
    const n = cross(u, v);
    faceArea.set(n, t * 3);
    const len = Math.hypot(...n);
    if (len > 0) faceUnit.set(n.map((x) => x / len), t * 3);
  }

  // Faces around each vertex, as a compressed list.
  const vertexCount = positions.length / 3;
  const degree = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < indices.length; i++) degree[indices[i] + 1] += 1;
  for (let v = 0; v < vertexCount; v++) degree[v + 1] += degree[v];
  const fill = degree.slice(0, vertexCount);
  const faces = new Uint32Array(indices.length);
  for (let t = 0; t < triangles; t++)
    for (let k = 0; k < 3; k++) faces[fill[indices[t * 3 + k]]++] = t;

  const cosCrease = Math.cos((creaseDeg * Math.PI) / 180);
  const outPositions = [];
  const outNormals = [];
  const outIndices = new Uint32Array(indices.length);
  const seen = new Map();
  for (let t = 0; t < triangles; t++) {
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k];
      const sum = [0, 0, 0];
      for (let i = degree[v]; i < degree[v + 1]; i++) {
        const g = faces[i];
        const dot =
          faceUnit[t * 3] * faceUnit[g * 3] +
          faceUnit[t * 3 + 1] * faceUnit[g * 3 + 1] +
          faceUnit[t * 3 + 2] * faceUnit[g * 3 + 2];
        if (dot < cosCrease) continue;
        sum[0] += faceArea[g * 3];
        sum[1] += faceArea[g * 3 + 1];
        sum[2] += faceArea[g * 3 + 2];
      }
      const len = Math.hypot(...sum);
      const n = len > 0 ? sum.map((x) => x / len) : [faceUnit[t * 3], faceUnit[t * 3 + 1], faceUnit[t * 3 + 2]];
      const key = `${v}:${Math.round(n[0] * QUANT)},${Math.round(n[1] * QUANT)},${Math.round(n[2] * QUANT)}`;
      let out = seen.get(key);
      if (out === undefined) {
        out = outPositions.length / 3;
        seen.set(key, out);
        outPositions.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
        outNormals.push(n[0], n[1], n[2]);
      }
      outIndices[t * 3 + k] = out;
    }
  }
  return {
    positions: Float32Array.from(outPositions),
    normals: Float32Array.from(outNormals),
    indices: outIndices,
  };
}

function corners(indices, t, positions) {
  return [0, 1, 2].map((k) => {
    const i = indices[t * 3 + k] * 3;
    return [positions[i], positions[i + 1], positions[i + 2]];
  });
}

function sub(p, q) {
  return [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
}

function cross(u, v) {
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}
