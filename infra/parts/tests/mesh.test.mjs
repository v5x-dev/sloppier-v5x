import assert from "node:assert/strict";
import { test } from "node:test";
import { flatTriangles, stepToPartDirection, stepToPartPoint, weldMeshes } from "../lib/mesh.mjs";
import { estimateMass, DENSITY_G_PER_CM3 } from "../lib/mass.mjs";

test("STEP points become Y-up points centred on the bounds", () => {
  assert.deepEqual(stepToPartPoint([1, 2, 3], { center: [0, 0, 0] }), [1, 3, -2]);
  assert.deepEqual(stepToPartPoint([1, 2, 3], { center: [1, 1, 1] }), [0, 2, -1]);
  assert.deepEqual(stepToPartDirection([0, 0, 1]), [0, 1, 0]);
});

test("the frame change is a proper rotation, so it does not mirror the part", () => {
  const basis = [
    stepToPartDirection([1, 0, 0]),
    stepToPartDirection([0, 1, 0]),
    stepToPartDirection([0, 0, 1]),
  ];
  const det =
    basis[0][0] * (basis[1][1] * basis[2][2] - basis[1][2] * basis[2][1]) -
    basis[0][1] * (basis[1][0] * basis[2][2] - basis[1][2] * basis[2][0]) +
    basis[0][2] * (basis[1][0] * basis[2][1] - basis[1][1] * basis[2][0]);
  assert.equal(det, 1);
});

test("welding joins coincident vertices from separate shells", () => {
  const shell = (x) => ({
    attributes: { position: { array: [x, 0, 0, x + 1, 0, 0, x, 1, 0] } },
    index: { array: [0, 1, 2] },
  });
  const welded = weldMeshes([shell(0), shell(0)]);
  assert.equal(welded.positions.length / 3, 3);
  assert.equal(welded.indices.length, 6);
});

test("flat triangles carry one unit normal per face", () => {
  const flat = flatTriangles({
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: Uint32Array.from([0, 1, 2]),
  });
  assert.equal(flat.triangles, 1);
  for (let k = 0; k < 9; k += 3) {
    assert.deepEqual([...flat.normals.slice(k, k + 3)], [0, 0, 1]);
  }
});

test("mass is volume times density, and is withheld for electronics without a published figure", () => {
  assert.deepEqual(estimateMass(1000, "aluminum"), {
    densityGPerCm3: DENSITY_G_PER_CM3.aluminum,
    massG: 2.7,
    basis: "volume x density",
  });
  assert.equal(estimateMass(1000, "electronics").massG, null);
  assert.equal(estimateMass(1000, "electronics", 300).basis, "published");
});
