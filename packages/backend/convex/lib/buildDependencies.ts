import type { ProgramTemplate } from "./templateCatalog"

// These SDK and library files belong to the toolchain image, not a user's build snapshot.
// prepare-dependencies.ts uses this same list to assemble the image and its manifest.
export const buildDependencies: Partial<
  Record<ProgramTemplate, readonly string[]>
> = {
  pros: ["firmware", "include/api.h", "include/pros", "common.mk"],
  "ez-template": [
    "firmware",
    "include/api.h",
    "include/pros",
    "include/EZ-Template",
    "include/okapi",
    "include/liblvgl",
    "common.mk",
  ],
}

export function isBuildDependency(template: ProgramTemplate, path: string) {
  return (buildDependencies[template] ?? []).some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  )
}

export function isFirmwarePath(path: string) {
  return path === "firmware" || path.startsWith("firmware/")
}
