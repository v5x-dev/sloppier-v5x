import { unzipSync } from "fflate"

export function readBuildBinaries(archive: Uint8Array) {
  if (archive.length > 32 * 1024 * 1024)
    throw new Error("Build archive is too large.")
  let size = 0
  return unzipSync(archive, {
    filter: (entry) => {
      if (!entry.name.endsWith(".bin")) return false
      if (
        entry.name.startsWith("/") ||
        entry.name.includes("\\") ||
        entry.name.split("/").some((part) => part === ".." || part === ".")
      ) {
        throw new Error("Invalid binary path in build archive.")
      }
      size += entry.originalSize
      if (size > 64 * 1024 * 1024)
        throw new Error("Build binaries exceed 64 MiB.")
      return true
    },
  })
}
