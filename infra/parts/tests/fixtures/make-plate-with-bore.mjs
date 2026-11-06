// Writes tests/fixtures/plate-with-bore.json: a small tessellated model in the shape
// occt-import-js returns (positions, normals, indices, and B-rep face ranges). It holds
// four faces: a 4.2 mm bore, a 3 mm pin, a flat top, and a 90-degree fillet arc.
// Run with `node tests/fixtures/make-plate-with-bore.mjs` to regenerate it.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SEGMENTS = 24;
const positions = [];
const normals = [];
const indices = [];
const faces = [];

function vertex(x, y, z, n) {
  positions.push(x, y, z);
  normals.push(n[0], n[1], n[2]);
  return positions.length / 3 - 1;
}

function beginFace() {
  return indices.length / 3;
}

function endFace(start) {
  faces.push({ first: start, last: indices.length / 3 - 1, color: null });
}

// Face 0: the bore, centred at (5, 0), radius 2.1, from z = 0 to 2. Normals point inward.
{
  const start = beginFace();
  const ring = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const t = (2 * Math.PI * i) / SEGMENTS;
    const [c, s] = [Math.cos(t), Math.sin(t)];
    ring.push([vertex(5 + 2.1 * c, 2.1 * s, 0, [-c, -s, 0]), vertex(5 + 2.1 * c, 2.1 * s, 2, [-c, -s, 0])]);
  }
  for (let i = 0; i < SEGMENTS; i++) {
    const [b0, t0] = ring[i];
    const [b1, t1] = ring[(i + 1) % SEGMENTS];
    indices.push(b0, t0, t1, b0, t1, b1);
  }
  endFace(start);
}

// Face 1: a 3 mm pin at (-6, 0), from z = 0 to 2. Normals point outward.
{
  const start = beginFace();
  const ring = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const t = (2 * Math.PI * i) / SEGMENTS;
    const [c, s] = [Math.cos(t), Math.sin(t)];
    ring.push([vertex(-6 + 1.5 * c, 1.5 * s, 0, [c, s, 0]), vertex(-6 + 1.5 * c, 1.5 * s, 2, [c, s, 0])]);
  }
  for (let i = 0; i < SEGMENTS; i++) {
    const [b0, t0] = ring[i];
    const [b1, t1] = ring[(i + 1) % SEGMENTS];
    indices.push(b0, t1, t0, b0, b1, t1);
  }
  endFace(start);
}

// Face 2: a flat top quad. Not a cylinder.
{
  const start = beginFace();
  const a = vertex(-10, -5, 2, [0, 0, 1]);
  const b = vertex(10, -5, 2, [0, 0, 1]);
  const c = vertex(10, 5, 2, [0, 0, 1]);
  const d = vertex(-10, 5, 2, [0, 0, 1]);
  indices.push(a, b, c, a, c, d);
  endFace(start);
}

// Face 3: a 90-degree fillet arc. Too short an arc to be a hole.
{
  const start = beginFace();
  const ring = [];
  for (let i = 0; i <= 6; i++) {
    const t = (Math.PI / 2) * (i / 6);
    const [c, s] = [Math.cos(t), Math.sin(t)];
    ring.push([vertex(9 + c, 4 + s, 0, [-c, -s, 0]), vertex(9 + c, 4 + s, 1, [-c, -s, 0])]);
  }
  for (let i = 0; i < 6; i++) {
    const [b0, t0] = ring[i];
    const [b1, t1] = ring[i + 1];
    indices.push(b0, t0, t1, b0, t1, b1);
  }
  endFace(start);
}

const model = {
  description: "Synthetic tessellated model for hole detection tests. Not from VEX CAD.",
  meshes: [
    {
      name: "plate-with-bore",
      attributes: { position: { array: positions }, normal: { array: normals } },
      index: { array: indices },
      brep_faces: faces,
    },
  ],
};

const out = join(dirname(fileURLToPath(import.meta.url)), "plate-with-bore.json");
writeFileSync(out, `${JSON.stringify(model)}\n`);
console.log(`wrote ${out}`);
