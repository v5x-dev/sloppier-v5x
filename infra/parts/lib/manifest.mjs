// Checks the manifest before any STEP file is read, so a typo fails with the part's name.

const SNAP_STRATEGIES = new Set(["none", "bores", "ruled-bores", "shank", "probe", "bores+probe", "axle"]);
const FAMILIES = new Set([
  "motor", "wheel", "standoff", "screw", "nut", "plate", "gusset", "bearing", "collar", "spacer", "gear",
  "channel", "angle", "shaft",
]);
const FIT = /^(screw:[0-9]+-[0-9]+|shaft:[0-9/]+)$/;
const MATERIALS = new Set(["aluminum", "steel", "nylon", "electronics"]);

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
    if (!MATERIALS.has(part.material)) errors.push(`${where}: unknown material "${part.material}"`);
    if (!knownRepos.includes(part.source?.repo)) errors.push(`${where}: unknown source repo "${part.source?.repo}"`);
    if (part.fit !== undefined && !FIT.test(part.fit)) errors.push(`${where}: fit "${part.fit}" must be screw:<thread> or shaft:<side>`);
    for (const token of part.snapAccepts ?? []) if (!FIT.test(token)) errors.push(`${where}: snapAccepts token "${token}" is not a fit`);
    for (const token of part.cut?.holeAccepts ?? []) if (!FIT.test(token)) errors.push(`${where}: holeAccepts token "${token}" is not a fit`);
    if (!part.source?.path) errors.push(`${where}: missing source path`);
    if (part.kind === "model") {
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
