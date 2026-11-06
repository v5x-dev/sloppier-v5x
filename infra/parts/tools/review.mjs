#!/usr/bin/env node
// Builds the review set for fixed Parts: the full STEP tessellation and the display mesh,
// each rendered in Blender from the same views, so the two can be compared by eye.
//
//   bun run --cwd infra/parts review -- --only motor-v5-smart-11w [--views 0:20:1.6,90:20:1.6]
//
// Output goes to infra/parts/.cache/review/ (git-ignored). Blender must be on PATH or at
// BLENDER (default /usr/bin/blender); it is a dev-time tool only.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyseStep } from "../lib/analyse.mjs";
import { displayForPart } from "../lib/display.mjs";
import { writeGlb } from "../lib/glb.mjs";
import { writeReferenceGlb } from "../lib/reference.mjs";
import { SOURCES, ensureSource, readAt } from "../lib/sources.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const cacheDir = join(root, ".cache");
const outDir = join(cacheDir, "review");
const blender = process.env.BLENDER ?? "/usr/bin/blender";
const args = parseArgs(process.argv.slice(2));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
mkdirSync(outDir, { recursive: true });
const views = (args.views ?? "0:20:1.6,90:20:1.6").split(",").map((v) => v.split(":").map(Number));
const sources = Object.fromEntries(Object.keys(SOURCES).map((k) => [k, ensureSource(cacheDir, k)]));

for (const part of manifest.parts.filter((p) => p.kind === "model" && (!args.only || args.only.includes(p.id)))) {
  const repo = sources[part.source.repo];
  const analysis = await analyseStep(readAt(repo, part.source.path));
  const ref = join(outDir, `${part.id}-full.glb`);
  writeFileSync(ref, await writeReferenceGlb(analysis.meshes, analysis.bounds, part.id));
  const shown = await displayForPart(part, analysis.meshes);
  const glb = join(outDir, `${part.id}-display.glb`);
  writeFileSync(glb, await writeGlb({
    positions: shown.positions, normals: shown.normals, colors: shown.colors, indices: shown.indices, name: part.id, compress: false,
  }));
  console.log(`${part.id}: display ${shown.triangles} tris (kept ${shown.keptTriangles} of raw ${shown.rawTriangles}), error ${shown.errorMm.toFixed(3)} mm, voxel ${shown.voxelMm.toFixed(3)} mm`);
  // Snap Points overlaid on the display mesh, to check they still line up with it.
  const overlayFile = join(outDir, `${part.id}-snaps.json`);
  const catalog = JSON.parse(readFileSync(join(root, "../../apps/design/web/src/catalog/catalog.json"), "utf8"));
  const entry = catalog.parts.find((p) => p.id === part.id);
  const points = (entry?.snapPoints ?? []).map((s) => [...s.position, 0.1, 0.9, 0.3]);
  writeFileSync(overlayFile, JSON.stringify({ points }));
  for (const [i, [yaw, pitch, dist]] of views.entries()) {
    for (const [kind, file] of [["full", ref], ["display", glb]]) {
      const png = join(outDir, `${part.id}-${kind}-${i}${args.snaps && kind === "display" ? "-snaps" : ""}.png`);
      const extra = args.snaps && kind === "display" ? [overlayFile] : [];
      execFileSync(blender, ["--background", "--factory-startup", "--python", join(root, "tools/render.py"), "--", file, png, String(yaw), String(pitch), String(dist), String(args.pixels ?? 900), ...extra], { stdio: ["ignore", "ignore", "inherit"] });
      console.log(`  ${kind} view ${i} -> ${png}`);
    }
  }
}

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "--only") out.only = list[++i].split(",");
    if (list[i] === "--views") out.views = list[++i];
    if (list[i] === "--pixels") out.pixels = Number(list[++i]);
    if (list[i] === "--snaps") out.snaps = true;
  }
  return out;
}
