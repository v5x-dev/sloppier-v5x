import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateManifest } from "../lib/manifest.mjs";
import { SOURCES } from "../lib/sources.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "..", "manifest.json"), "utf8"));
const repos = Object.keys(SOURCES);

test("the committed manifest is valid", () => {
  assert.deepEqual(validateManifest(manifest, repos), []);
});

test("every part's SKU is in the file name or given in the manifest, or is null", () => {
  for (const part of manifest.parts) {
    // "sku": null says no source publishes a SKU for this Part.
    if (part.sku === null) continue;
    // A parametric Part has no file name to read a SKU from.
    if (part.parametric) continue;
    const fromName = /\(\d{3}-\d{4}(-\d{3,4})?\)/.test(part.source.path);
    assert.ok(fromName || part.sku?.value, `${part.id} has no SKU`);
  }
});

test("catches a duplicate id, an unknown family, and an unknown source", () => {
  const bad = {
    parts: [
      { id: "a", name: "A", family: "motor", kind: "model", material: "steel", source: { repo: "vex-cad-download", path: "x" }, snap: "bores", budgetTriangles: 1, maxErrorMm: 0.1 },
      { id: "a", name: "A", family: "unicorn", kind: "model", material: "steel", source: { repo: "nowhere", path: "x" }, snap: "bores", budgetTriangles: 1, maxErrorMm: 0.1 },
    ],
  };
  const errors = validateManifest(bad, repos).join("\n");
  assert.match(errors, /duplicate id/);
  assert.match(errors, /unknown family/);
  assert.match(errors, /unknown source repo/);
});

test("requires a valid measured diameter range for detected pin ends", () => {
  const link = manifest.parts.find((part) => part.id === "chain-rubber-link");
  assert.ok(link);
  const errors = validateManifest(
    { parts: [{ ...link, pinDiameterMm: { min: 5, max: 4 } }] },
    repos
  ).join("\n");
  assert.match(errors, /valid pinDiameterMm range/);
});
