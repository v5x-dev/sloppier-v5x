import assert from "node:assert/strict";
import { test } from "node:test";
import { latheDisplayMesh } from "../lib/display.mjs";
import { radialProfile, revolve, simplifyProfile } from "../lib/lathe.mjs";

// A closed box, 2 x 2 in x and y and 10 long in z. Its corners sit sqrt(2) from the z axis.
function box() {
  const lo = [-1, -1, 0], hi = [1, 1, 10];
  const c = (i) => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
  const positions = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7].flatMap(c));
  const faces = [[0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6], [0, 1, 4], [1, 5, 4], [2, 6, 3], [3, 6, 7], [0, 4, 2], [2, 4, 6], [1, 3, 5], [3, 7, 5]];
  return { positions, indices: Uint32Array.from(faces.flat()), bounds: { min: lo, max: hi, center: [0, 0, 5] } };
}

test("the radial profile of a box along z is its corner distance at every slice inside it", () => {
  const b = box();
  const profile = radialProfile(b.indices, b.positions, b.bounds, 2);
  assert.ok(profile.length > 100, `got ${profile.length} slices`);
  for (const [, r] of profile.slice(10, -10)) assert.ok(Math.abs(r - Math.SQRT2) < 1e-6, `radius ${r}`);
});

test("the revolved mesh has winding that agrees with its normals, and a volume near the solid", () => {
  const out = revolve([[0, 2], [10, 2]], { axis: 2, centre: [0, 0, 5] }, 8, 35);
  let agree = 0, total = 0, volume = 0;
  const P = out.positions, N = out.normals, I = out.indices;
  for (let t = 0; t < I.length; t += 3) {
    const [i, j, k] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
    const u = [0, 1, 2].map((c) => P[j + c] - P[i + c]);
    const v = [0, 1, 2].map((c) => P[k + c] - P[i + c]);
    const g = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const n = [0, 1, 2].map((c) => N[i + c] + N[j + c] + N[k + c]);
    if (Math.hypot(...g) > 1e-9) { total++; if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] > 0) agree++; }
    volume += (P[i] * (P[j + 1] * P[k + 2] - P[j + 2] * P[k + 1]) - P[i + 1] * (P[j] * P[k + 2] - P[j + 2] * P[k]) + P[i + 2] * (P[j] * P[k + 1] - P[j + 1] * P[k])) / 6;
  }
  assert.equal(agree, total, "every facet faces the way its normals say");
  // An 8-sided prism of apothem-free radius 2 and length 10: 8/2 * 2^2 * sin(45 deg) * 10.
  const expected = 4 * 4 * Math.sin(Math.PI / 4) * 10;
  assert.ok(Math.abs(Math.abs(volume) - expected) / expected < 1e-6, `volume ${Math.abs(volume)} vs ${expected}`);
});

test("profile simplification keeps the corners and drops points on a straight run", () => {
  const line = Array.from({ length: 101 }, (_, i) => [i, i % 2 === 0 ? 1 : 1.005]);
  const kept = simplifyProfile(line, 0.01);
  assert.deepEqual(kept, [line[0], line[100]]);
  const corner = [[0, 1], [5, 1], [5, 3], [10, 3]];
  assert.equal(simplifyProfile(corner, 0.01).length, 4, "a sharp step is kept");
});

test("the lathe display mesh is in the Part frame, colours its vertices, and stays under its segment count", async () => {
  const b = box();
  const mesh = { attributes: { position: { array: [...b.positions] }, normal: { array: b.positions.map(() => 0) } }, index: { array: [...b.indices] }, color: [0.6, 0.6, 0.6] };
  const shown = await latheDisplayMesh([mesh], { segments: 8, toleranceMm: 0.01 });
  assert.ok(shown.triangles > 0 && shown.triangles < 200, `got ${shown.triangles}`);
  assert.equal(shown.colors.length, shown.positions.length);
  assert.deepEqual([...shown.colors.slice(0, 3)].map((c) => Number(c.toFixed(2))), [0.6, 0.6, 0.6]);
  // The box's axis (z, length 10) is Part-frame Y after the frame change, so the Y extent is 10.
  const ys = [...shown.positions].filter((_, i) => i % 3 === 1);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 10) < 1e-3);
});
