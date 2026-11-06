import assert from "node:assert/strict";
import { test } from "node:test";
import { creaseNormals } from "../lib/normals.mjs";

// Two triangles sharing an edge. Face A lies flat in z=0; face B is bent up from the
// shared edge by `bendDeg`, so the normals differ by that angle (0 is flat, 90 a corner).
function bent(bendDeg) {
  const d = (bendDeg * Math.PI) / 180;
  const a = [-Math.SQRT1_2, -Math.SQRT1_2, 0]; // from the edge towards face A's third corner
  const m = [0.5, 0.5, 0]; // midpoint of the shared edge (1,0,0)-(0,1,0)
  const s = Math.SQRT1_2;
  const b = [-Math.cos(d) * a[0], -Math.cos(d) * a[1], Math.sin(d)]; // face B's direction from the edge
  const third = [m[0] + s * b[0], m[1] + s * b[1], m[2] + s * b[2]];
  return {
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, ...third]),
    indices: Uint32Array.from([0, 1, 2, 2, 1, 3]), // the shared edge runs 1->2 in one face and 2->1 in the other
  };
}

const normalOf = (out, corner) => [0, 1, 2].map((k) => out.normals[out.indices[corner] * 3 + k]);

test("a gentle bend shares its vertices and averages the normal across the edge", () => {
  const { positions, indices } = bent(20);
  const out = creaseNormals(positions, indices, 35);
  assert.equal(out.positions.length / 3, 4, "shared vertices stay shared");
});

test("a sharp edge splits the vertices and keeps each face's own normal", () => {
  const { positions, indices } = bent(90);
  const out = creaseNormals(positions, indices, 35);
  assert.equal(out.positions.length / 3, 6, "the two edge vertices are duplicated, one per face");
  assert.ok(Math.abs(normalOf(out, 0)[2]) > 0.99, "the flat face keeps its +z normal");
  assert.ok(Math.abs(normalOf(out, 3)[2]) < 0.2, "the bent face does not inherit the flat normal");
});

test("normals are unit length", () => {
  const { positions, indices } = bent(30);
  const out = creaseNormals(positions, indices, 35);
  for (let i = 0; i < out.normals.length; i += 3) {
    const len = Math.hypot(out.normals[i], out.normals[i + 1], out.normals[i + 2]);
    assert.ok(Math.abs(len - 1) < 1e-4, `length ${len}`);
  }
});
