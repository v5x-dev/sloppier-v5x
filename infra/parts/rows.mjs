#!/usr/bin/env node
// Measures the hole rows in a manifest source file, to write a Cut Part spec.
//
//   node rows.mjs <manifest id>
//
// Prints the STEP bounds, then each probed hole grouped by the wall it sits in and its
// position across that wall, relative to the bounds centre. Use the output as the `rows`
// in the manifest entry, then run build.mjs, which verifies the spec against the file.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyseStep } from "./lib/analyse.mjs";
import { SOURCES, ensureSource, readAt } from "./lib/sources.mjs";
import { probeAxis, WALL_AXIS } from "./lib/lattice.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const id = process.argv[2];
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const part = manifest.parts.find((p) => p.id === id);
if (!part) {
  console.error(`No manifest entry "${id}"`);
  process.exit(1);
}
const source = ensureSource(join(here, ".cache"), part.source.repo);
const analysis = await analyseStep(readAt(source, part.source.path));
const { center } = analysis.bounds;
console.log(`${part.id}: ${SOURCES[part.source.repo].url} @ ${source.commit.slice(0, 12)} ${part.source.path}`);
console.log(`bounds (mm): min ${analysis.bounds.min.map(round)} max ${analysis.bounds.max.map(round)}`);
console.log(`centre (mm): ${center.map(round)}`);

for (const [wall, axis] of Object.entries(WALL_AXIS)) {
  const holes = analysis.meshes
    .filter((m) => m.brep_faces.length)
    .flatMap((m) => probeAxis(m, axis, 0.1));
  // For a probe along `axis`, the in-plane coordinates are (u, v) in axis order.
  const groups = new Map();
  for (const h of holes) {
    const across = wall === "web" ? h.v - center[(axis + 2) % 3] : h.u - center[(axis + 1) % 3];
    const along = wall === "web" ? h.u - center[(axis + 1) % 3] : h.v - center[(axis + 2) % 3];
    const key = round(across);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(along);
  }
  console.log(`\n${wall} (probe along axis ${axis}): ${holes.length} holes`);
  for (const [across, along] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = along.sort((a, b) => a - b);
    const gaps = sorted.slice(1).map((x, i) => round(x - sorted[i]));
    const pitch = gaps.length ? Math.min(...gaps) : 0;
    console.log(`  across ${across}: ${sorted.length} holes, along ${round(sorted[0])}..${round(sorted.at(-1))}, closest spacing ${pitch}`);
  }
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}
