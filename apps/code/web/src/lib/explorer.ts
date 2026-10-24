export type ExplorerEntry = { path: string; kind: "file" | "directory" }
export type RepositoryChange =
  | { operation: "put"; path: string; contents: string | ArrayBuffer }
  | { operation: "delete"; path: string }

export function barePath(path: string) {
  return path.replace(/\/$/, "")
}

export function parentPath(path: string) {
  return barePath(path).split("/").slice(0, -1).join("/")
}

export function joinPath(parent: string, name: string) {
  return parent ? `${barePath(parent)}/${name}` : name
}

export function validateNewPath(path: string) {
  const parts = path.split("/")
  if (
    !path ||
    path.length > 1024 ||
    path !== path.trim() ||
    path.includes("\\") ||
    [...path].some((character) => character.charCodeAt(0) < 32) ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Enter a relative path without empty segments, . or ...")
  }
  if (parts[0] === ".v5x") throw new Error("The .v5x directory is reserved.")
  return path
}

export function containsPath(root: string, path: string) {
  const base = barePath(root)
  return path === base || path.startsWith(`${base}/`)
}

export function rootEntries(entries: ExplorerEntry[]) {
  return entries.filter(
    (entry, index) =>
      !entries.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          containsPath(other.path, barePath(entry.path)) &&
          (barePath(other.path) !== barePath(entry.path) || otherIndex < index)
      )
  )
}

export function assertAvailable(path: string, paths: string[]) {
  validateNewPath(path)
  if (
    paths.some(
      (existing) => containsPath(path, existing) || containsPath(existing, path)
    )
  ) {
    throw new Error(`${path} already exists.`)
  }
}

export function copyDestination(
  source: string,
  folder: string,
  paths: string[]
) {
  const name = barePath(source).split("/").at(-1)!
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ""
  let destination = joinPath(folder, name)
  let index = 1
  while (
    paths.some(
      (path) =>
        containsPath(destination, path) || containsPath(path, destination)
    )
  ) {
    destination = joinPath(
      folder,
      `${stem} copy${index > 1 ? ` ${index}` : ""}${extension}`
    )
    index++
  }
  return destination
}
