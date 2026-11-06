import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyExterior } from "../lib/exterior.mjs";

// A closed box with a closed box sealed inside it. Triangles 0-11 are the outer box.
function boxes() {
  const corners = (lo, hi) => [0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => [
    i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2],
  ]);
  const faces = [[0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6], [0, 1, 4], [1, 5, 4],
    [2, 6, 3], [3, 6, 7], [0, 4, 2], [2, 4, 6], [1, 3, 5], [3, 7, 5]];
  return {
    positions: Float32Array.from([...corners([0, 0, 0], [10, 10, 10]), ...corners([3, 3, 3], [7, 7, 7])]),
    indices: Uint32Array.from([...faces.flat(), ...faces.map((f) => f.map((v) => v + 8)).flat()]),
  };
}

test("a closed shell is visible, and a sealed box inside it is culled", () => {
  const { positions, indices } = boxes();
  const { keep } = classifyExterior(positions, indices, 0.25);
  assert.deepEqual([...keep], [...Array(12).fill(1), ...Array(12).fill(0)]);
});

test("a seam narrower than the seal radius does not leak the interior into view", () => {
  // The outer box with a 0.1 mm slit cut through one face, and the inner box beyond it.
  const { positions, indices } = boxes();
  positions[2] = 0.05; // lift one corner of the outer box slightly, opening a sub-voxel gap
  const { keep } = classifyExterior(positions, indices, 0.25, { sealVoxels: 1 });
  for (let t = 12; t < 24; t++) assert.equal(keep[t], 0, `inner triangle ${t} stays culled`);
});
