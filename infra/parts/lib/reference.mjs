// The full-detail STEP tessellation, as a GLB with one material per solid colour. It is the
// reference the display meshes are judged against: every solid, every face, no culling.
// Review output only; it never reaches the catalog or R2.

import { Document, NodeIO } from "@gltf-transform/core";
import { stepToPartDirection, stepToPartPoint } from "./mesh.mjs";

export async function writeReferenceGlb(meshes, bounds, name) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const root = doc.createScene(name);
  const materials = new Map();
  for (const [i, mesh] of meshes.entries()) {
    const color = mesh.color ? mesh.color.slice(0, 3) : [0.5, 0.5, 0.5];
    const key = color.map((c) => c.toFixed(3)).join(",");
    if (!materials.has(key))
      materials.set(key, doc.createMaterial().setBaseColorFactor([...color, 1]).setRoughnessFactor(0.45).setMetallicFactor(0));
    const position = doc.createAccessor().setType("VEC3").setArray(toPart(mesh.attributes.position.array, true, bounds)).setBuffer(buffer);
    const normal = doc.createAccessor().setType("VEC3").setArray(toPart(mesh.attributes.normal.array, false, bounds)).setBuffer(buffer);
    const index = doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(mesh.index.array)).setBuffer(buffer);
    const primitive = doc.createPrimitive().setAttribute("POSITION", position).setAttribute("NORMAL", normal).setIndices(index).setMaterial(materials.get(key));
    const built = doc.createMesh(`${name}-${i}`).addPrimitive(primitive);
    root.addChild(doc.createNode(`${name}-${i}`).setMesh(built));
  }
  const bytes = await new NodeIO().writeBinary(doc);
  return Buffer.from(bytes);
}

/** Moves a flat xyz array from STEP's Z-up frame into the Part frame. */
function toPart(flat, isPoint, bounds) {
  const out = new Float32Array(flat.length);
  for (let i = 0; i < flat.length; i += 3) {
    const v = [flat[i], flat[i + 1], flat[i + 2]];
    out.set(isPoint ? stepToPartPoint(v, bounds) : stepToPartDirection(v), i);
  }
  return out;
}
