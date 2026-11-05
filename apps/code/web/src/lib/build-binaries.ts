import { unzipSync } from "fflate"
import type { BuildRequest } from "./build-program"

const MAX_BINARY_BYTES = 64 * 1024 * 1024
// A build's cold package is the libraries, so it is the same from one build to the next. Keep a few recent files
// by digest; a file is downloaded again only when its digest is not here.
const MAX_CACHED_FILES = 6
const fileCache = new Map<string, Uint8Array>()

export type ArtifactEntries = Record<string, { sha256: string; bytes: number }>

function checkBinaryPath(name: string) {
  if (
    !name.endsWith(".bin") ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.split("/").some((part) => part === ".." || part === ".")
  ) {
    throw new Error("Invalid binary path in build archive.")
  }
}

export function readBuildBinaries(archive: Uint8Array) {
  if (archive.length > 32 * 1024 * 1024)
    throw new Error("Build archive is too large.")
  let size = 0
  return unzipSync(archive, {
    filter: (entry) => {
      if (!entry.name.endsWith(".bin")) return false
      checkBinaryPath(entry.name)
      size += entry.originalSize
      if (size > MAX_BINARY_BYTES)
        throw new Error("Build binaries exceed 64 MiB.")
      return true
    },
  })
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

function remember(digest: string, bytes: Uint8Array) {
  fileCache.delete(digest)
  fileCache.set(digest, bytes)
  while (fileCache.size > MAX_CACHED_FILES)
    fileCache.delete(fileCache.keys().next().value as string)
}

/**
 * The binaries of a build, as `bin/...` paths. Files the Builder indexed are fetched one at a time and checked
 * against their digest, and files already held by digest are not fetched again. A Builder without an index
 * returns the whole archive.
 */
export async function loadArtifactFiles(
  request: BuildRequest,
  artifact: { artifactId: string; entries?: ArtifactEntries | null },
  signal?: AbortSignal
): Promise<Record<string, Uint8Array>> {
  const id = encodeURIComponent(artifact.artifactId)
  const entries = artifact.entries
  if (!entries || Object.keys(entries).length === 0) {
    const response = await request(`/artifact?id=${id}`, undefined, signal)
    return readBuildBinaries(new Uint8Array(await response.arrayBuffer()))
  }
  let total = 0
  for (const [name, entry] of Object.entries(entries)) {
    checkBinaryPath(name)
    total += entry.bytes
  }
  if (total > MAX_BINARY_BYTES) throw new Error("Build binaries exceed 64 MiB.")
  const files: Record<string, Uint8Array> = {}
  await Promise.all(
    Object.entries(entries).map(async ([name, { sha256, bytes }]) => {
      const held = fileCache.get(sha256)
      if (held) {
        remember(sha256, held)
        files[name] = held
        return
      }
      const response = await request(
        `/artifact?id=${id}&entry=${encodeURIComponent(name)}`,
        undefined,
        signal
      )
      const content = new Uint8Array(await response.arrayBuffer())
      if (content.length !== bytes || (await sha256Hex(content)) !== sha256)
        throw new Error(
          "The build changed while downloading. Try uploading again."
        )
      remember(sha256, content)
      files[name] = content
    })
  )
  return files
}
