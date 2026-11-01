import { posix } from "node:path"

export function ownerOf(path) {
  const parts = path.replaceAll("\\", "/").split("/")
  if (parts[0] === "apps" && parts.length >= 3)
    return { kind: "app", root: parts.slice(0, 3).join("/") }
  if (parts[0] === "packages" && parts.length >= 2)
    return { kind: "package", root: parts.slice(0, 2).join("/") }
}

/** Cross-workspace source imports must use the destination's public exports. */
export function boundaryError(from, to, specifier) {
  const source = ownerOf(from)
  const target = ownerOf(to)
  if (!source || !target || source.root === target.root) return
  if (target.kind === "app")
    return "Apps cannot be imported by another workspace."
  if (!specifier.startsWith("@v5x/"))
    return "Cross-workspace imports must use @v5x package exports."
}

export function clientImportError(from, to, specifier) {
  const client = /^apps\/[^/]+\/web\/src\/(components|hooks|lib)\//.test(from)
  if (!client || from.includes(".server.")) return
  if (specifier.startsWith("node:") || /\.server\.[cm]?[jt]sx?$/.test(to))
    return "Client modules cannot import server-only code. Use a server route or server function."
}

export function relativeTarget(from, specifier) {
  return specifier.startsWith(".")
    ? posix.normalize(posix.join(posix.dirname(from), specifier))
    : undefined
}

export function exportError(specifier, manifest) {
  specifier = specifier.split(/[?#]/, 1)[0]
  const subpath =
    specifier === manifest.name
      ? "."
      : `.${specifier.slice(manifest.name.length)}`
  const exports = manifest.exports
  if (!exports) return "Workspace packages must declare public exports."
  if (typeof exports === "string")
    return subpath === "."
      ? undefined
      : "This workspace subpath is not exported."
  const allowed = Object.keys(exports).some((key) => {
    if (!key.includes("*")) return key === subpath
    const [prefix, suffix] = key.split("*")
    return (
      subpath.startsWith(prefix) &&
      subpath.endsWith(suffix) &&
      subpath.length > prefix.length + suffix.length
    )
  })
  if (!allowed) return "This workspace subpath is not exported."
}
