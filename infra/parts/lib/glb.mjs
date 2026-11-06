// Writes one mesh as a meshopt-compressed GLB. Coordinates are in millimetres, which
// the glTF spec does not define; the catalog records that, and the app must not rescale.

import { Document, NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptEncoder } from "meshoptimizer";

/**
 * @param positions Float32Array xyz.
 * @param normals Float32Array xyz, one per vertex.
 * @param colors optional Float32Array rgb (linear), one per vertex, written as COLOR_0.
 * @param indices optional Uint32Array triangle list; without it the vertices are a list.
 * @param compress false writes plain buffers, for tools that cannot read meshopt (review only).
 */
export async function writeGlb({ positions, normals, colors, indices, name, compress = true }) {
  if (compress) await MeshoptEncoder.ready;
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc
    .createAccessor(name + " positions")
    .setType("VEC3")
    .setArray(positions)
    .setBuffer(buffer);
  const normal = doc
    .createAccessor(name + " normals")
    .setType("VEC3")
    .setArray(normals)
    .setBuffer(buffer);
  const primitive = doc
    .createPrimitive()
    .setAttribute("POSITION", position)
    .setAttribute("NORMAL", normal);
  if (colors) {
    const color = doc
      .createAccessor(name + " colors")
      .setType("VEC3")
      .setArray(colors)
      .setBuffer(buffer);
    primitive.setAttribute("COLOR_0", color);
  }
  if (indices) {
    const index = doc
      .createAccessor(name + " indices")
      .setType("SCALAR")
      .setArray(indices)
      .setBuffer(buffer);
    primitive.setIndices(index);
  }
  const mesh = doc.createMesh(name).addPrimitive(primitive);
  const node = doc.createNode(name).setMesh(mesh);
  doc.createScene(name).addChild(node);
  let io = new NodeIO();
  if (compress) {
    doc.createExtension(EXTMeshoptCompression).setRequired(true);
    io = io.registerExtensions([EXTMeshoptCompression]).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  }
  const bytes = await io.writeBinary(doc);
  return Buffer.from(bytes);
}
