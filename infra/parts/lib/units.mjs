// Reads the length unit a STEP file declares for its geometry, and converts lengths
// to millimetres. The pipeline asks occt for millimetres, which does the conversion,
// so this module exists to record what each file was drawn in and to check the
// result. Some VEX files are drawn in inches with CONVERSION_BASED_UNIT('INCH').

const MM_PER_UNIT = { mm: 1, inch: 25.4, m: 1000 };

/** Splits the DATA section into entity id -> entity text (without the leading "#n =") . */
export function stepEntities(text) {
  const start = text.indexOf("DATA;");
  const data = start < 0 ? text : text.slice(start + 5);
  const entities = new Map();
  for (const chunk of data.split(";\n")) {
    const match = chunk.trim().match(/^#(\d+)\s*=\s*([\s\S]*)$/);
    if (match) entities.set(Number(match[1]), match[2]);
  }
  return entities;
}

/**
 * The declared length unit of the model's geometric context: "mm", "inch", or "m".
 * Returns "unknown" when the file does not declare one.
 */
export function declaredLengthUnit(text) {
  const context = text.match(/GLOBAL_UNIT_ASSIGNED_CONTEXT\s*\(\s*\(([^)]*)\)/);
  if (!context) return "unknown";
  const entities = stepEntities(text);
  for (const ref of context[1].matchAll(/#(\d+)/g)) {
    const entity = entities.get(Number(ref[1])) ?? "";
    if (!entity.includes("LENGTH_UNIT")) continue;
    if (/CONVERSION_BASED_UNIT\s*\(\s*'INCH'/.test(entity)) return "inch";
    if (/SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\./.test(entity)) return "mm";
    if (/SI_UNIT\s*\(\s*\$\s*,\s*\.METRE\./.test(entity)) return "m";
  }
  return "unknown";
}

/** Converts a length in the given unit to millimetres. */
export function toMillimetres(value, unit) {
  const factor = MM_PER_UNIT[unit];
  if (factor === undefined) throw new Error(`Unknown length unit "${unit}"`);
  return value * factor;
}

/**
 * Checks that a measured size (mm) matches what the manifest expects, allowing for
 * tessellation and for holes in the sizes. Throws with the part name when it does not.
 */
export function checkExpectedSize(name, sizeMm, expectedMm, tolerance = 0.02) {
  for (const axis of ["x", "y", "z"]) {
    const want = expectedMm[axis];
    if (want === undefined) continue;
    const got = sizeMm[axis];
    if (Math.abs(got - want) > tolerance * want + 0.05)
      throw new Error(
        `${name}: ${axis} size is ${got.toFixed(2)} mm, expected ${want} mm. Check the declared unit.`
      );
  }
}

/**
 * Checks a Cut Part's sample against its expected dimensions, sorted, so the order of
 * the STEP axes does not matter: a 444.5 mm channel may be drawn along any axis.
 */
export function checkExpectedSorted(name, sizeMm, expectedMm, tolerance = 0.02) {
  const got = [sizeMm.x, sizeMm.y, sizeMm.z].sort((a, b) => a - b);
  const want = [...expectedMm].sort((a, b) => a - b);
  for (let k = 0; k < 3; k++) {
    if (Math.abs(got[k] - want[k]) > tolerance * want[k] + 0.05)
      throw new Error(
        `${name}: sorted sizes are ${got.map((g) => g.toFixed(2)).join(" x ")} mm, expected ${want.join(" x ")} mm. Check the declared unit.`
      );
  }
}
