import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { detectHoles, detectPins, fitCylinder } from "../lib/holes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "fixtures", "plate-with-bore.json"), "utf8"));

test("finds the bore in the fixture: 4.2 mm across, 2 mm deep, centred at (5, 0), along Z", () => {
  const holes = detectHoles(fixture.meshes);
  assert.equal(holes.length, 1);
  const [hole] = holes;
  assert.ok(Math.abs(hole.diameterMm - 4.2) < 0.01, `diameter ${hole.diameterMm}`);
  assert.ok(Math.abs(hole.depthMm - 2) < 1e-6, `depth ${hole.depthMm}`);
  assert.ok(Math.abs(hole.center[0] - 5) < 1e-6 && Math.abs(hole.center[1]) < 1e-6);
  assert.ok(Math.abs(hole.center[2] - 1) < 1e-6, `centre z ${hole.center[2]}`);
  assert.ok(Math.abs(Math.abs(hole.axis[2]) - 1) < 1e-6);
});

test("finds the pin separately, and does not count it as a hole", () => {
  const pins = detectPins(fixture.meshes);
  assert.equal(pins.length, 1);
  assert.ok(Math.abs(pins[0].diameterMm - 3) < 0.01);
  assert.equal(detectHoles(fixture.meshes).some((h) => Math.abs(h.diameterMm - 3) < 0.01), false);
});

test("rejects a flat face and a short fillet arc as cylinders", () => {
  const faces = fixture.meshes[0].brep_faces;
  const { positions, normals } = faceData(fixture.meshes[0], faces[2]);
  assert.equal(fitCylinder(positions, normals), null, "flat top");
  const fillet = faceData(fixture.meshes[0], faces[3]);
  assert.equal(fitCylinder(fillet.positions, fillet.normals), null, "90 degree fillet");
});

test("fits a full circle from synthetic normals and positions", () => {
  const positions = [];
  const normals = [];
  for (let i = 0; i < 36; i++) {
    const t = (2 * Math.PI * i) / 36;
    positions.push([10 + 3 * Math.cos(t), 3 * Math.sin(t), 0], [10 + 3 * Math.cos(t), 3 * Math.sin(t), 5]);
    normals.push([-Math.cos(t), -Math.sin(t), 0], [-Math.cos(t), -Math.sin(t), 0]);
  }
  const cylinder = fitCylinder(positions, normals);
  assert.ok(cylinder);
  assert.ok(Math.abs(cylinder.radius - 3) < 1e-6);
  assert.equal(cylinder.concave, true);
  assert.ok(cylinder.arcDeg > 345, `arc ${cylinder.arcDeg}`);
});

/** The unique vertices and normals of one B-rep face, as fitCylinder reads them. */
function faceData(mesh, face) {
  const seen = new Set();
  const positions = [];
  const normals = [];
  for (let t = face.first; t <= face.last; t++)
    for (let k = 0; k < 3; k++) {
      const v = mesh.index.array[t * 3 + k];
      if (seen.has(v)) continue;
      seen.add(v);
      const p = mesh.attributes.position.array;
      const n = mesh.attributes.normal.array;
      positions.push([p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]);
      normals.push([n[v * 3], n[v * 3 + 1], n[v * 3 + 2]]);
    }
  return { positions, normals };
}
