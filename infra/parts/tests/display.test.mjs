import assert from "node:assert/strict";
import { test } from "node:test";
import { displayMesh, toPartFrame } from "../lib/display.mjs";

// A flat square of n x n cells in the STEP z=0 plane, as occt-style mesh.
function square(n, size, color, offset = [0, 0, 0]) {
  const position = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++)
      position.push(offset[0] + (i / n) * size, offset[1] + (j / n) * size, offset[2]);
  const index = [];
  const v = (i, j) => j * (n + 1) + i;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) index.push(v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j), v(i + 1, j + 1), v(i, j + 1));
  return { attributes: { position: { array: position }, normal: { array: position.map(() => 0) } }, index: { array: index }, color };
}

test("the budget is honoured when the mesh can reach it", async () => {
  const shown = await displayMesh([square(40, 40, [0.5, 0.5, 0.5])], { budgetTriangles: 200, maxErrorMm: 5 });
  assert.ok(shown.triangles <= 200, `got ${shown.triangles}`);
  assert.ok(shown.triangles > 0);
});

test("each colour keeps its own region, so colour boundaries stay sharp", async () => {
  const shown = await displayMesh(
    [square(4, 10, [1, 0, 0]), square(4, 10, [0, 0, 1], [10, 0, 0])],
    { budgetTriangles: 1000, maxErrorMm: 0.01 }
  );
  const colours = new Set();
  for (let i = 0; i < shown.colors.length; i += 3) colours.add(`${shown.colors[i]},${shown.colors[i + 2]}`);
  assert.deepEqual([...colours].sort(), ["0,1", "1,0"]);
});

test("the display mesh is centred on its bounds in the Part frame (Y up)", async () => {
  // The square lies flat in STEP's z=0 plane. In the Part frame that is Y=0 everywhere,
  // with its extent centred on the origin in X and Z.
  const shown = await displayMesh([square(2, 10, [0.5, 0.5, 0.5])], { budgetTriangles: 100, maxErrorMm: 0.01 });
  const at = (k) => [...shown.positions].filter((_, i) => i % 3 === k);
  assert.ok(at(1).every((y) => Math.abs(y) < 1e-4), "flat in STEP becomes Y = 0");
  for (const k of [0, 2]) {
    const vals = at(k);
    assert.ok(Math.abs(Math.min(...vals) + Math.max(...vals)) < 1e-3, `axis ${k} centred on the bounds`);
  }
});

test("toPartFrame maps STEP's Z up to Part's Y up and keeps normals unit length", () => {
  const bounds = { center: [0, 0, 0] };
  const out = toPartFrame({
    positions: Float32Array.from([1, 2, 3]),
    normals: Float32Array.from([0, 0, 1]),
    colors: undefined,
    indices: Uint32Array.from([]),
    triangles: 0,
  }, bounds);
  assert.deepEqual([...out.positions], [1, 3, -2]);
  assert.deepEqual([...out.normals], [0, 1, 0]);
});
