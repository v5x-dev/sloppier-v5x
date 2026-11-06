import assert from "node:assert/strict";
import { test } from "node:test";
import { endSnaps, pinEndSnaps, throughSnaps } from "../lib/snaps.mjs";

/**
 * A 10 x 10 x 1 mm plate with a 2 x 2 mm square hole at x 4..6, y 4..6, built from
 * quads so no triangulation is needed. The hole runs the full thickness along Z.
 */
function plateWithSquareHole() {
  const positions = [];
  const indices = [];
  const quad = (p, q, r, s) => {
    for (const v of [p, q, r, p, r, s]) positions.push(...v);
  };
  const inHole = (x, y) => x >= 4 && x < 6 && y >= 4 && y < 6;
  for (const z of [0, 1])
    for (let x = 0; x < 10; x++)
      for (let y = 0; y < 10; y++) {
        if (inHole(x + 0.5, y + 0.5)) continue;
        quad([x, y, z], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z]);
      }
  for (let i = 0; i < 10; i++) {
    quad([i, 0, 0], [i + 1, 0, 0], [i + 1, 0, 1], [i, 0, 1]);
    quad([i, 10, 0], [i + 1, 10, 0], [i + 1, 10, 1], [i, 10, 1]);
    quad([0, i, 0], [0, i + 1, 0], [0, i + 1, 1], [0, i, 1]);
    quad([10, i, 0], [10, i + 1, 0], [10, i + 1, 1], [10, i, 1]);
  }
  for (let i = 4; i < 6; i++) {
    quad([i, 4, 0], [i + 1, 4, 0], [i + 1, 4, 1], [i, 4, 1]);
    quad([i, 6, 0], [i + 1, 6, 0], [i + 1, 6, 1], [i, 6, 1]);
    quad([4, i, 0], [4, i + 1, 0], [4, i + 1, 1], [4, i, 1]);
    quad([6, i, 0], [6, i + 1, 0], [6, i + 1, 1], [6, i, 1]);
  }
  for (let i = 0; i < positions.length / 3; i++) indices.push(i);
  return { attributes: { position: { array: Float32Array.from(positions) } }, index: { array: Uint32Array.from(indices) }, brep_faces: [] };
}

const bounds = { min: [0, 0, 0], max: [10, 10, 1], center: [5, 5, 0.5] };

test("a square through-hole gets one Snap Point at each face, pointing out of it", () => {
  const points = throughSnaps([plateWithSquareHole()], bounds);
  assert.equal(points.length, 2, JSON.stringify(points));
  // The Part frame is Y up, so the STEP Z faces are at Y = -0.5 and Y = +0.5.
  const ys = points.map((p) => p.position[1]).sort((a, b) => a - b);
  assert.deepEqual(ys, [-0.5, 0.5]);
  assert.deepEqual(points.map((p) => p.axis[1]).sort((a, b) => a - b), [-1, 1]);
  for (const p of points) {
    assert.equal(p.shape, "square");
    assert.ok(Math.abs(p.diameterMm - 2) <= 0.05, `diameter ${p.diameterMm}`);
  }
});

test("a plate with no hole gets no through Snap Points", () => {
  // A second body fills the hole: the probes see the union of all bodies, so the
  // channel is closed and nothing opens onto the outside.
  const plug = {
    attributes: { position: { array: Float32Array.from([4, 4, 0.5, 6, 4, 0.5, 6, 6, 0.5, 4, 6, 0.5]) } },
    index: { array: Uint32Array.from([0, 1, 2, 0, 2, 3]) },
    brep_faces: [],
  };
  assert.deepEqual(throughSnaps([plateWithSquareHole(), plug], bounds), []);
});

test("a detected pin gets a Snap Point at each end", () => {
  const pin = {
    center: [0, 0, 0],
    axis: [0, 1, 0],
    diameterMm: 4.191,
    depthMm: 10,
  };
  const bounds = { min: [-5, -5, -5], max: [5, 5, 5], center: [0, 0, 0] };
  const points = pinEndSnaps(
    [pin, { ...pin, diameterMm: 10.414, depthMm: 5 }],
    bounds,
    { min: 4, max: 4.4 }
  );
  assert.equal(points.length, 2);
  assert.deepEqual(points.map((point) => point.role), ["end", "end"]);
  assert.deepEqual(points.map((point) => point.position[2]), [5, -5]);
  assert.deepEqual(points.map((point) => point.axis[2]), [1, -1]);
  assert.ok(points.every((point) => point.diameterMm === 4.191));
  assert.deepEqual(pinEndSnaps([pin], bounds, { min: 5, max: 6 }), []);
});

test("an end socket sits at each end of the longest axis, centred on the section", () => {
  const long = { min: [-2, -1, -1], max: [18, 1, 1], center: [8, 0, 0] };
  const [a, b] = endSnaps(long, 4.2);
  assert.equal(a.diameterMm, 4.2);
  assert.equal(a.source, "manual");
  assert.deepEqual(a.axis, [-1, 0, 0]);
  assert.deepEqual(b.axis, [1, 0, 0]);
  assert.equal(a.position[0], -10);
  assert.equal(b.position[0], 10);
});
