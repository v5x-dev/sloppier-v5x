import type { ProgramTemplate } from "./templateCatalog"
import { isBuildDependency, isFirmwarePath } from "./buildDependencies"
import { validateRepositoryPath } from "./paths"

export const IMPORT_MAX_FILES = 1000
export const IMPORT_MAX_BYTES = 16 * 1024 * 1024
export const IMPORT_BATCH_BYTES = 384 * 1024
export const IMPORT_MAX_PATH_BYTES = 128 * 1024
export const IMPORT_BATCH_FILES = 100

export function excludedImportPath(
  template: ProgramTemplate,
  path: string
): string | null {
  const parts = path.split("/")
  if (
    parts.some((part) =>
      [".git", ".v5x", "node_modules", ".cache", "__pycache__"].includes(part)
    )
  )
    return "Internal or generated files"
  if (["bin", "build", "dist", "target", "firmware"].includes(parts[0]!))
    return "Build output or firmware"
  if (
    parts.some(
      (part) =>
        part === ".DS_Store" ||
        part === "Thumbs.db" ||
        part === ".env" ||
        part.startsWith(".env.")
    )
  )
    return "Local settings"
  if (/\.(o|obj|elf|bin|a|d|pch|pyc)$/i.test(path)) return "Compiled files"
  if (isFirmwarePath(path) || isBuildDependency(template, path))
    return "Managed build dependency"
  if (template === "pros" || template === "ez-template") {
    const filename = parts.at(-1)!.toLowerCase()
    if (
      parts.some((part) =>
        [".vscode", ".idea", ".github", ".pros"].includes(part)
      ) ||
      [
        ".clangd",
        ".clang-format",
        ".clang-tidy",
        ".editorconfig",
        ".gitignore",
        ".gitattributes",
        ".gitmodules",
        ".travis.yml",
        "compile_commands.json",
        "compile_flags.txt",
      ].includes(filename)
    )
      return "Editor, CI, or local project metadata"
    // Keep licensing notices, including ones distributed with custom libraries.
    if (/^(license|copying|notice)(\.|$)/i.test(filename)) return null
    if (
      ["docs", "doc", "documentation"].includes(parts[0]!.toLowerCase()) ||
      /^(readme|changelog|contributing|code_of_conduct)(\.|$)/i.test(filename)
    )
      return "Documentation"
    if (parts.length === 1 && /\.(zip|tar|tar\.gz|tgz|log)$/i.test(filename))
      return "Packaged templates or local output"
  }
  return null
}

export function validateImportPaths(paths: string[]) {
  const sorted = [...paths].sort()
  const allPaths = new Set(paths)
  let pathBytes = 0
  for (let i = 0; i < sorted.length; i++) {
    const path = sorted[i]!
    if (
      validateRepositoryPath(path) !== path ||
      /[\u0000-\u001f\u007f]/.test(path)
    )
      throw new Error(
        "File paths must not contain control characters or surrounding whitespace."
      )
    const previous = sorted[i - 1]
    if (
      path === previous ||
      path
        .split("/")
        .some(
          (_, index, parts) =>
            index > 0 && allPaths.has(parts.slice(0, index).join("/"))
        )
    )
      throw new Error(`Conflicting file path: ${path}`)
    pathBytes += new TextEncoder().encode(path).length
  }
  if (pathBytes > IMPORT_MAX_PATH_BYTES)
    throw new Error("The folder contains too many long file paths.")
}

export function detectImportTemplate(paths: string[]): ProgramTemplate | null {
  const lower = paths.map((path) => path.toLowerCase())
  if (lower.some((path) => path.includes("ez-template"))) return "ez-template"
  if (lower.some((path) => path.includes("jar-template"))) return "jar"
  if (lower.includes("project.pros")) return "pros"
  if (
    lower.some((path) => path.endsWith(".v5code")) ||
    lower.includes("include/vex.h")
  )
    return "vexcode"
  return null
}
