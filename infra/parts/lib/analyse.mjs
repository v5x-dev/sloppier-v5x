// Reads one STEP file with occt-import-js (build-time only; it is LGPL and never
// ships to users) and measures it: the declared unit, the millimetre bounding box,
// the triangle count at the same tessellation the raw budgets were measured with,
// the solid volume, and the bores and pins found on its cylindrical faces.

import occtImport from "occt-import-js";
import { declaredLengthUnit } from "./units.mjs";
import { detectHoles, detectPins } from "./holes.mjs";

// The raw sizes in the brief were measured at these settings, so keep them.
export const TESSELLATION = { linearDeflection: 0.2, angularDeflection: 0.5 };

let occt;
const loadOcct = async () => (occt ??= await occtImport());

export async function analyseStep(buffer) {
  const declaredUnit = declaredLengthUnit(buffer.toString("latin1"));
  const engine = await loadOcct();
  const result = engine.ReadStepFile(new Uint8Array(buffer), {
    linearUnit: "millimeter",
    ...TESSELLATION,
  });
  if (!result.success) throw new Error("occt-import-js could not read this STEP file");
  const meshes = result.meshes.filter((mesh) => mesh.index.array.length > 0);
  if (meshes.length === 0) throw new Error("The STEP file has no geometry");

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  let volumeMm3 = 0;
  for (const mesh of meshes) {
    const p = mesh.attributes.position.array;
    const idx = mesh.index.array;
    triangles += idx.length / 3;
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[i + k]);
        hi[k] = Math.max(hi[k], p[i + k]);
      }
    // Signed tetrahedra against the origin add up to the enclosed volume.
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      volumeMm3 +=
        (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
          p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
          p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
        6;
    }
  }
  const center = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
  return {
    declaredUnit,
    meshes,
    bounds: { min: lo, max: hi, center },
    sizeMm: { x: hi[0] - lo[0], y: hi[1] - lo[1], z: hi[2] - lo[2] },
    triangles,
    volumeMm3: Math.abs(volumeMm3),
    bores: detectHoles(meshes),
    pins: detectPins(meshes),
  };
}
