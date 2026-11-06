// Mass is estimated as the solid volume from the STEP geometry times a material
// density. Densities are typical handbook values for the materials VEX uses. Parts
// made of electronics have no density, so they stay null until a published figure is
// recorded in the manifest.

export const DENSITY_G_PER_CM3 = {
  // Typical handbook value for wrought aluminium alloys such as 6061.
  aluminum: 2.7,
  // Typical handbook value for low-carbon steel.
  steel: 7.85,
  // Typical handbook value for nylon 6/6, used for plastic wheels and spacers.
  nylon: 1.14,
};

/** { densityGPerCm3, massG } for a volume, or null when no density applies. */
export function estimateMass(volumeMm3, material, publishedMassG = null) {
  if (publishedMassG !== null) return { densityGPerCm3: null, massG: publishedMassG, basis: "published" };
  const density = DENSITY_G_PER_CM3[material];
  if (density === undefined) return { densityGPerCm3: null, massG: null, basis: "not estimated" };
  const massG = (volumeMm3 / 1000) * density;
  return { densityGPerCm3: density, massG: Math.round(massG * 1000) / 1000, basis: "volume x density" };
}
