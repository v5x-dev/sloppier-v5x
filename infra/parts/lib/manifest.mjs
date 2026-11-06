// Checks the manifest before any STEP file is read, so a typo fails with the part's name.

const SNAP_STRATEGIES = new Set(["bores", "ruled-bores", "shank", "probe", "bores+probe", "through", "ends", "axle", "none"]);
// Every family the catalog knows. The app's validator (apps/design/web/src/catalog/validate.ts)
// must list the same families, and its tests check that both lists agree.
export const FAMILIES = new Set([
  // Structure
  "channel", "angle", "plate", "gusset", "standoff", "screw", "nut", "bracket", "rail",
  // Motion
  "shaft", "collar", "spacer", "washer", "bearing", "retainer", "lock-bar", "bumper", "coupler",
  "insert", "gear", "rack", "sprocket", "chain", "tread", "wheel",
  // Electronics
  "motor", "brain", "battery", "radio", "controller", "sensor", "switch", "expander",
  // Pneumatics
  "cylinder", "reservoir", "fitting", "valve", "regulator", "gauge", "manifold",
  // Field Elements, one family per season
  "push-back", "high-stakes", "override", "spin-up",
]);
export const CATEGORIES = new Set(["structure", "motion", "electronics", "pneumatics", "field"]);
const MATERIALS = new Set(["aluminum", "steel", "nylon", "electronics", "other"]);
const FIT = /^(screw:[0-9]+-[0-9]+|shaft:[0-9/]+)$/;

export function validateManifest(manifest, knownRepos) {
  const errors = [];
  const ids = new Set();
  for (const part of manifest.parts ?? []) {
    const where = part.id ?? "(no id)";
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(part.id ?? "")) errors.push(`${where}: id must be kebab-case`);
    if (ids.has(part.id)) errors.push(`${where}: duplicate id`);
    ids.add(part.id);
    if (!part.name) errors.push(`${where}: missing name`);
    if (!FAMILIES.has(part.family)) errors.push(`${where}: unknown family "${part.family}"`);
    if (!CATEGORIES.has(part.category)) errors.push(`${where}: unknown category "${part.category}"`);
    if (!MATERIALS.has(part.material)) errors.push(`${where}: unknown material "${part.material}"`);
    if (part.parametric) {
      // A parametric Part has no STEP file: its shapes are in the manifest, with the
      // published dimensions it was made from.
      if (part.kind !== "model") errors.push(`${where}: a parametric Part must be kind "model"`);
      if (!Array.isArray(part.parametric.shapes) || part.parametric.shapes.length === 0) errors.push(`${where}: a parametric Part needs shapes`);
      if (!part.parametric.dimensionSource) errors.push(`${where}: a parametric Part must name its dimension source`);
      if (!part.parametric.source || !part.parametric.url) errors.push(`${where}: a parametric Part must cite its source`);
      if (!SNAP_STRATEGIES.has(part.snap)) errors.push(`${where}: unknown snap strategy "${part.snap}"`);
    } else {
      if (!knownRepos.includes(part.source?.repo)) errors.push(`${where}: unknown source repo "${part.source?.repo}"`);
      if (!part.source?.path) errors.push(`${where}: missing source path`);
    }
    if (part.fit !== undefined && !FIT.test(part.fit)) errors.push(`${where}: fit "${part.fit}" must be screw:<thread> or shaft:<side>`);
    for (const token of part.snapAccepts ?? []) if (!FIT.test(token)) errors.push(`${where}: snapAccepts token "${token}" is not a fit`);
    for (const token of part.cut?.holeAccepts ?? []) if (!FIT.test(token)) errors.push(`${where}: holeAccepts token "${token}" is not a fit`);
    if (part.parametric) {
      // Checked above: a parametric Part needs no budget, since it is built from its shapes.
    } else if (part.kind === "model") {
      if (!SNAP_STRATEGIES.has(part.snap)) errors.push(`${where}: unknown snap strategy "${part.snap}"`);
      if (!(part.budgetTriangles > 0)) errors.push(`${where}: budgetTriangles must be a positive number`);
      if (!(part.maxErrorMm > 0)) errors.push(`${where}: maxErrorMm must be a positive number`);
    } else if (part.kind === "cut") {
      if (!part.cut || !part.cut.rows && !part.cut.sizeMm) errors.push(`${where}: a cut part needs a cut spec`);
      if (!(part.source?.sampleLengthMm > 0)) errors.push(`${where}: a cut part needs source.sampleLengthMm to verify against`);
    } else {
      errors.push(`${where}: kind must be "model" or "cut"`);
    }
  }
  return errors;
}
