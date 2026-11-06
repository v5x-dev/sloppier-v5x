// Writes one mesh as a meshopt-compressed GLB. Coordinates are in millimetres, which
// the glTF spec does not define; the catalog records that, and the app must not rescale.

import { Document, NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptEncoder } from "meshoptimizer";

export async function writeGlb({ positions, normals, name }) {
  await MeshoptEncoder.ready;
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
  const mesh = doc.createMesh(name).addPrimitive(primitive);
  const node = doc.createNode(name).setMesh(mesh);
  doc.createScene(name).addChild(node);
  doc.createExtension(EXTMeshoptCompression).setRequired(true);
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  const bytes = await io.writeBinary(doc);
  return Buffer.from(bytes);
}
