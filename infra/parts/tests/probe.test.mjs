import assert from "node:assert/strict";
import { test } from "node:test";
import { findThroughHoles, hitsAt, rayIndex } from "../lib/probe.mjs";
import { latticeOpenings } from "../lib/lattice.mjs";

/**
 * A 10 x 10 x 1 mm plate whose top and bottom faces are 1 mm cells, with a 2 x 2 mm
 * square hole at x 4..6, y 4..6. Built cell by cell, so no triangulation is needed.
 */
function plateWithSquareHole() {
  const positions = [];
  const indices = [];
  const cell = (p, q, r, s, normal) => {
    // Two triangles per quad. The probe does not read normals, so winding is not critical.
    for (const v of [p, q, r, p, r, s]) positions.push(...v);
    void normal;
  };
  const inHole = (x, y) => x >= 4 && x < 6 && y >= 4 && y < 6;
  for (const z of [0, 1])
    for (let x = 0; x < 10; x++)
      for (let y = 0; y < 10; y++) {
        if (inHole(x + 0.5, y + 0.5)) continue;
        cell([x, y, z], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z], z);
      }
  for (let i = 0; i < 10; i++) {
    cell([i, 0, 0], [i + 1, 0, 0], [i + 1, 0, 1], [i, 0, 1]);
    cell([i, 10, 0], [i + 1, 10, 0], [i + 1, 10, 1], [i, 10, 1]);
    cell([0, i, 0], [0, i + 1, 0], [0, i + 1, 1], [0, i, 1]);
    cell([10, i, 0], [10, i + 1, 0], [10, i + 1, 1], [10, i, 1]);
  }
  for (let i = 4; i < 6; i++) {
    cell([i, 4, 0], [i + 1, 4, 0], [i + 1, 4, 1], [i, 4, 1]);
    cell([i, 6, 0], [i + 1, 6, 0], [i + 1, 6, 1], [i, 6, 1]);
    cell([4, i, 0], [4, i + 1, 0], [4, i + 1, 1], [4, i, 1]);
    cell([6, i, 0], [6, i + 1, 0], [6, i + 1, 1], [6, i, 1]);
  }
  for (let i = 0; i < positions.length / 3; i++) indices.push(i);
  return { attributes: { position: { array: Float32Array.from(positions) } }, index: { array: Uint32Array.from(indices) }, brep_faces: [] };
}

test("ray probes count the material a ray crosses", () => {
  const index = rayIndex(plateWithSquareHole(), 2);
  assert.equal(hitsAt(index, 2.5, 2.5).length, 2, "solid: top and bottom");
  assert.equal(hitsAt(index, 5, 5).length, 0, "inside the hole");
});

test("finds a square through-hole and places it at its centre", () => {
  const holes = findThroughHoles(rayIndex(plateWithSquareHole(), 2), 0.25);
  assert.equal(holes.length, 1);
  const [hole] = holes;
  assert.ok(Math.abs(hole.u - 5) <= 0.25 && Math.abs(hole.v - 5) <= 0.25, `centre ${hole.u},${hole.v}`);
  assert.ok(Math.abs(hole.sizeU - 2) <= 0.25 && Math.abs(hole.sizeV - 2) <= 0.25, `size ${hole.sizeU}x${hole.sizeV}`);
});

test("the lattice finds the hole at its centre site and no solid site", () => {
  const plate = plateWithSquareHole();
  plate.brep_faces = [{ first: 0, last: 0 }];
  const bounds = { min: [0, 0, 0], max: [10, 10, 1] };
  // Pitch 1 puts a site at the hole's centre (5, 5). Sites on the hole's edge are
  // ambiguous for a ray, so the test checks the centre and a solid site far away.
  const { sites, openings } = latticeOpenings([plate], 2, bounds, 1, 0.05);
  assert.equal(sites, 121);
  const found = [...openings.even, ...openings.odd].map((o) => `${o.u},${o.v}`);
  assert.ok(found.includes("5,5"), `openings: ${found.join(" ")}`);
  assert.ok(!found.includes("2,2"));
});
