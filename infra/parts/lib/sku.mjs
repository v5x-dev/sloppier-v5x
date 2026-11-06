// VEX prints the SKU in the file name, in parentheses: "Motors/V5 Smart Motor (276-4840).step".
// SKUs are not always unique: the Mecanum left and right wheels share 217-7400, and
// two gusset packs share 276-1110. Callers must not assume one file per SKU.

const SKU = /\((\d{3}-\d{4}(?:-\d{3,4})?)\)/;

/** The SKU in a file name, or null when the name has none. */
export function skuFromFileName(fileName) {
  const base = fileName.replaceAll("\\", "/").split("/").pop() ?? "";
  const match = base.match(SKU);
  return match ? match[1] : null;
}
