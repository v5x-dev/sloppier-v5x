#!/usr/bin/env node
// Builds the Design Part catalog from the manifest.
//
//   bun run build                 # every part
//   bun run build -- --only motor-v5-smart-11w,plate-5x15-steel
//
// Reads each STEP file at its pinned commit, converts fixed models to meshopt GLB
// files in .cache/models, verifies Cut Part specs against the STEP geometry, and
// writes apps/design/web/src/catalog/catalog.json. Git keeps the JSON and this
// pipeline only; the GLB files go to R2 with upload.mjs.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyseStep } from "./lib/analyse.mjs";
import { estimateMass, DENSITY_G_PER_CM3 } from "./lib/mass.mjs";
import { flatTriangles, simplifyMesh, stepToPartDirection, stepToPartPoint, weldMeshes } from "./lib/mesh.mjs";
import { writeGlb } from "./lib/glb.mjs";
import { SOURCES, ensureSource, readAt } from "./lib/sources.mjs";
import { skuFromFileName } from "./lib/sku.mjs";
import { checkExpectedSize, checkExpectedSorted } from "./lib/units.mjs";
import { validateManifest } from "./lib/manifest.mjs";
import { boreSnaps, probedSnaps, ruledBoreSnaps, shankSnaps, axleSnap, thinAxis } from "./lib/snaps.mjs";
import { compareRows, latticeOpenings, probeAxis, rotateWebToZ, WALL_AXIS } from "./lib/lattice.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const cacheDir = join(here, ".cache");
const modelsDir = join(cacheDir, "models");
const catalogPath = join(repoRoot, "apps/design/web/src/catalog/catalog.json");
const SCHEMA_VERSION = 1;
const LATTICE_PITCH_MM = 6.35;

const args = parseArgs(process.argv.slice(2));
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const errors = validateManifest(manifest, Object.keys(SOURCES));
if (errors.length) fail(errors.join("\n"));

mkdirSync(modelsDir, { recursive: true });
const sources = Object.fromEntries(
  Object.keys(SOURCES).map((key) => [key, ensureSource(cacheDir, key)])
);
const selected = manifest.parts.filter((p) => !args.only || args.only.includes(p.id));
if (selected.length === 0) fail("No parts matched --only");

const entries = [];
for (const part of selected) {
  const started = Date.now();
  const entry = part.kind === "model" ? await buildModel(part) : await buildCut(part);
  entries.push(entry);
  console.log(`${part.id.padEnd(26)} ${entry.kind.padEnd(6)} ${summary(entry)} (${Date.now() - started} ms)`);
}

if (!args.only) writeCatalog(entries);
else console.log("--only given: catalog.json not written");

// ----------------------------------------------------------------------------

async function buildModel(part) {
  const { file, analysis, source } = await load(part);
  const sku = resolveSku(part, file);
  verifySize(part, analysis);

  const snaps = snapPoints(part, analysis);
  const mass = estimateMass(analysis.volumeMm3, part.material, part.publishedMassG ?? null);

  const welded = weldMeshes(analysis.meshes);
  const reduced = await simplifyMesh(welded, part.budgetTriangles, part.maxErrorMm);
  const flat = flatTriangles(reduced);
  // The GLB is in the Part frame: Y up, origin at the bounding-box centre.
  const glb = await writeGlb({
    positions: alignedPositions(flat.positions, analysis.bounds),
    normals: rotatedNormals(flat.normals),
    name: part.id,
  });
  const glbHash = createHash("sha256").update(glb).digest("hex");
  const modelFile = `models/${part.id}-${glbHash.slice(0, 8)}.glb`;
  removeStaleModels(part.id, modelFile);
  writeFileSync(join(cacheDir, modelFile), glb);

  return {
    kind: "model",
    id: part.id,
    name: part.name,
    family: part.family,
    sku,
    material: part.material,
    source,
    sizeMm: round3(analysis.sizeMm),
    volumeMm3: round3(analysis.volumeMm3),
    mass,
    model: {
      file: modelFile,
      sha256: glbHash,
      bytes: glb.length,
      triangles: reduced.indices.length / 3,
      rawTriangles: analysis.triangles,
      budgetTriangles: part.budgetTriangles,
      maxErrorMm: round3(reduced.errorMm),
      coordinates: "mm, Y up, origin at the centre of the bounding box",
    },
    snapPoints: snaps,
    notes: part.notes ?? [],
    ...fitField(part),
  };
}

async function buildCut(part) {
  const { file, analysis, source } = await load(part);
  const sku = resolveSku(part, file);
  const spec = part.cut;
  let verification = { checked: false };
  if (spec.rows) {
    // A ray along Y passes through both side walls, so it only reports holes that
    // both walls share; the web is probed along Z.
    const probed = [
      ...probeAll(analysis.meshes, WALL_AXIS.web, 0.1),
      ...probeAll(analysis.meshes, WALL_AXIS.side, 0.1),
    ];
    const frame =
      part.source.webNormal === "y"
        ? rotateWebToZ(probed, analysis.bounds.center)
        : { holes: probed, centre: analysis.bounds.center };
    const result = compareRows(spec.rows, part.source.sampleLengthMm, frame.holes, frame.centre);
    verification = {
      checked: true,
      expectedHoles: result.expected,
      probedHoles: result.found,
      matched: result.matched,
      missing: result.missing.length,
      extra: result.extra.length,
    };
    if (result.missing.length || result.extra.length)
      fail(`${part.id}: rows do not match the STEP holes: ${JSON.stringify({ missing: result.missing.slice(0, 5), extra: result.extra.slice(0, 5) })}`);
  }
  // The sample's length and profile, in any axis order.
  const profile = profileSizes(spec);
  checkExpectedSorted(part.id, analysis.sizeMm, [...profile, part.source.sampleLengthMm]);
  return {
    kind: "cut",
    id: part.id,
    name: part.name,
    family: part.family,
    sku,
    material: part.material,
    source,
    sampleSizeMm: round3(analysis.sizeMm),
    mass: { densityGPerCm3: DENSITY_G_PER_CM3[part.material] ?? null, basis: "profile area x length x density, computed in the app" },
    cut: spec,
    verification,
    notes: part.notes ?? [],
    ...fitField(part),
  };
}

/** A Part's fit token, when the manifest gives one: a screw's thread or a shaft's side. */
function fitField(part) {
  return part.fit ? { fit: part.fit } : {};
}

async function load(part) {
  const repo = sources[part.source.repo];
  const bytes = readAt(repo, part.source.path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const analysis = await analyseStep(bytes);
  if (part.source.path && analysis.declaredUnit === "unknown")
    console.warn(`  note: ${part.id} declares no length unit; occt's millimetre output was used`);
  return {
    bytes,
    file: part.source.path,
    sha256,
    analysis,
    source: {
      repo: repo.credit,
      url: repo.url,
      commit: repo.commit,
      path: part.source.path,
      sha256,
      declaredUnit: analysis.declaredUnit,
    },
  };
}

function resolveSku(part, file) {
  if (part.sku?.value) return { value: part.sku.value, source: part.sku.source, note: part.sku.note };
  const sku = skuFromFileName(file);
  if (!sku) fail(`${part.id}: no SKU in the file name and no sku override in the manifest`);
  return { value: sku, source: "filename" };
}

function verifySize(part, analysis) {
  if (!part.expectSizeMm) return;
  checkExpectedSize(part.id, analysis.sizeMm, part.expectSizeMm, 0.02);
}

function snapPoints(part, analysis) {
  const points = [];
  const { bounds } = analysis;
  // Hand-placed openings, given in STEP millimetres and converted to the Part frame.
  for (const extra of part.extraSnaps ?? []) {
    points.push({
      kind: extra.kind,
      source: "manual",
      position: stepToPartPoint(extra.position, bounds),
      axis: stepToPartDirection(extra.axis),
      diameterMm: extra.diameterMm,
      ...(extra.accepts ? { accepts: extra.accepts } : {}),
      ...(extra.note ? { note: extra.note } : {}),
    });
  }
  if (part.snap === "bores" || part.snap === "bores+probe") points.push(...boreSnaps(analysis.bores, bounds));
  if (part.snap === "shank") points.push(...shankSnaps(analysis.pins, bounds, part.shankDiameterMm));
  if (part.snap === "ruled-bores") points.push(...ruledBoreSnaps(analysis.bores, bounds, part.boreRule));
  if (part.snap === "probe") points.push(...latticePlateSnaps(analysis, part));
  if (part.snap === "bores+probe") {
    const axis = thinAxis(analysis.sizeMm);
    const holes = probeAll(analysis.meshes, axis, 0.25).filter(
      (h) => !analysis.bores.some((b) => Math.hypot(h.u - b.center[(axis + 1) % 3], h.v - b.center[(axis + 2) % 3]) < 2.5)
    );
    points.push(...probedSnaps(holes, bounds, axis));
  }
  if (part.snap === "axle") points.push(axleSnap(bounds, thinAxis(analysis.sizeMm), part.axleDiameterMm));
  // Openings take the manifest's fit tokens unless a point says what it takes itself. Pins
  // are a fastener's own ends, not openings.
  const takes = part.snapAccepts;
  return points.map((p, i) => ({
    id: `${part.family}-${String(i + 1).padStart(2, "0")}`,
    ...p,
    ...(takes && p.kind !== "pin" && !p.accepts ? { accepts: takes } : {}),
  }));
}

/**
 * Plates are drilled on a 0.25 in square lattice, with holes on one checkerboard
 * parity. Every lattice site is tested, including half-holes on the outline. The build
 * fails when both parities are drilled, because the catalog assumes one.
 */
function latticePlateSnaps(analysis, part) {
  const axis = thinAxis(analysis.sizeMm);
  const { sites, openings } = latticeOpenings(analysis.meshes, axis, analysis.bounds, LATTICE_PITCH_MM);
  const drilled = openings.even.length > 0 ? "even" : "odd";
  const other = drilled === "even" ? openings.odd : openings.even;
  if (other.length) fail(`${part.id}: both checkerboard parities have openings (${openings.even.length} even, ${openings.odd.length} odd)`);
  const holes = openings[drilled].map((o) => ({ u: o.u, v: o.v, widthMm: part.holeSquareMm, heightMm: part.holeSquareMm }));
  console.log(`  ${part.id}: ${holes.length} openings on the 0.25 in lattice (${drilled} sites, of ${sites}); outline half-holes included`);
  return probedSnaps(holes, analysis.bounds, axis).map((p) => ({ ...p, source: "lattice" }));
}

/** Deletes earlier GLBs for this Part, so the cache holds one model per Part. */
function removeStaleModels(id, keep) {
  const pattern = new RegExp(`^${id}-[0-9a-f]{8}\\.glb$`);
  for (const name of readdirSync(modelsDir)) {
    if (pattern.test(name) && `models/${name}` !== keep) rmSync(join(modelsDir, name));
  }
}

function probeAll(meshes, axis, step) {
  return meshes.filter((m) => m.brep_faces.length).flatMap((m) => probeAxis(m, axis, step));
}

// Cut Part and fixed-model frames: the STEP mesh is Z up; the GLB is Y up.
function alignedPositions(flatPositions, bounds) {
  const out = new Float32Array(flatPositions.length);
  for (let i = 0; i < flatPositions.length; i += 3) {
    const p = stepToPartPoint([flatPositions[i], flatPositions[i + 1], flatPositions[i + 2]], bounds);
    out[i] = p[0];
    out[i + 1] = p[1];
    out[i + 2] = p[2];
  }
  return out;
}

function rotatedNormals(normals) {
  const out = new Float32Array(normals.length);
  for (let i = 0; i < normals.length; i += 3) {
    out[i] = normals[i];
    out[i + 1] = normals[i + 2];
    out[i + 2] = -normals[i + 1];
  }
  return out;
}

/** The two cross-section sizes of a Cut Part spec. */
function profileSizes(spec) {
  if (spec.sizeMm !== undefined) return [spec.sizeMm, spec.sizeMm];
  if (spec.legMm !== undefined) return [spec.legMm, spec.legMm];
  return [spec.depthMm, spec.widthMm];
}

function writeCatalog(entries) {
  const sorted = entries.slice().sort((a, b) => a.id.localeCompare(b.id));
  const catalog = {
    schemaVersion: SCHEMA_VERSION,
    generatedBy: "infra/parts/build.mjs",
    units: "mm",
    frame: "Y up. Origin at the centre of each Part's bounding box. Cut Parts use the same frame, with the length along X.",
    credits: Object.values(SOURCES).map((s) => s.credit),
    parts: sorted,
  };
  mkdirSync(dirname(catalogPath), { recursive: true });
  const tmp = `${catalogPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(catalog, null, 2)}\n`);
  renameSync(tmp, catalogPath);
  console.log(`wrote ${catalogPath} (${sorted.length} parts)`);
}

function summary(entry) {
  if (entry.kind === "cut")
    return entry.verification.checked
      ? `verified ${entry.verification.matched}/${entry.verification.expectedHoles} holes`
      : "size checked, no holes";
  return `${entry.model.triangles} tris (raw ${entry.model.rawTriangles}), ${entry.snapPoints.length} snaps, mass ${entry.mass.massG ?? "null"} g`;
}

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "--only") out.only = list[++i].split(",");
  }
  return out;
}

function round3(value) {
  if (typeof value === "number") return Math.round(value * 1000) / 1000;
  if (Array.isArray(value)) return value.map(round3);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, round3(v)]));
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
