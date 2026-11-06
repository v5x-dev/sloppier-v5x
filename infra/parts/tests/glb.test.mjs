import assert from "node:assert/strict";
import { test } from "node:test";
import { Document, NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { writeGlb } from "../lib/glb.mjs";

test("a written GLB reads back with the same triangles, compressed with meshopt", async () => {
  const positions = Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 0, 0, 10, 0, 10, 0, 0]);
  const normals = Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const glb = await writeGlb({ positions, normals, name: "test" });
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(glb));
  assert.ok(doc instanceof Document);
  const [prim] = doc.getRoot().listMeshes()[0].listPrimitives();
  assert.deepEqual([...prim.getAttribute("POSITION").getArray()], [...positions]);
  assert.ok(doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === "EXT_meshopt_compression"));
});
