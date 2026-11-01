import { readdirSync, readFileSync, existsSync } from "node:fs"
import { resolve, relative, dirname } from "node:path"
import ts from "typescript"
import {
  boundaryError,
  clientImportError,
  relativeTarget,
  exportError,
} from "./lib/boundaries.mjs"

const root = resolve(import.meta.dirname, "..")
const ignored = new Set([
  "node_modules",
  "dist",
  ".git",
  ".cache",
  "_generated",
  "test-results",
  "playwright-report",
  "coverage",
])
function* sources(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.startsWith(".")) continue
    const path = resolve(dir, entry.name)
    if (path.endsWith("/autocomplete/data")) continue
    if (entry.isDirectory()) yield* sources(path)
    else if (
      /\.[cm]?[jt]sx?$/.test(entry.name) &&
      entry.name !== "routeTree.gen.ts"
    )
      yield path
  }
}
const manifests = new Map()
for (const category of ["apps", "packages"]) {
  const dirs = readdirSync(resolve(root, category), {
    withFileTypes: true,
  }).filter((entry) => entry.isDirectory())
  for (const entry of dirs) {
    const base = resolve(root, category, entry.name)
    const candidates =
      category === "apps"
        ? readdirSync(base, { withFileTypes: true })
            .filter((item) => item.isDirectory())
            .map((item) => resolve(base, item.name, "package.json"))
        : [resolve(base, "package.json")]
    for (const path of candidates)
      if (existsSync(path)) {
        const manifest = JSON.parse(readFileSync(path, "utf8"))
        manifests.set(manifest.name, manifest)
      }
  }
}
const configs = new Map()
function compilerOptions(file) {
  let dir = dirname(file)
  while (dir.startsWith(root)) {
    const config = resolve(dir, "tsconfig.json")
    if (existsSync(config)) {
      if (!configs.has(config)) {
        const parsed = ts.readConfigFile(config, ts.sys.readFile)
        configs.set(
          config,
          ts.parseJsonConfigFileContent(parsed.config, ts.sys, dir).options
        )
      }
      return configs.get(config)
    }
    dir = dirname(dir)
  }
  return {}
}
const errors = []
for (const dir of ["apps", "packages"])
  for (const file of sources(resolve(root, dir))) {
    const from = relative(root, file).replaceAll("\\", "/")
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true
    )
    function check(node) {
      let literal
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier
      )
        literal = node.moduleSpecifier
      else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          node.expression.getText(source) === "require")
      )
        literal = node.arguments[0]
      if (literal && ts.isStringLiteralLike(literal)) {
        const specifier = literal.text
        const resolved = ts.resolveModuleName(
          specifier,
          file,
          compilerOptions(file),
          ts.sys
        ).resolvedModule?.resolvedFileName
        const to = resolved
          ? relative(root, resolved).replaceAll("\\", "/")
          : (relativeTarget(from, specifier) ?? specifier)
        const workspaceName = specifier.startsWith("@v5x/")
          ? specifier.split("/").slice(0, 2).join("/")
          : undefined
        const exportIssue =
          workspaceName && manifests.has(workspaceName)
            ? exportError(specifier, manifests.get(workspaceName))
            : undefined
        const error =
          exportIssue ??
          boundaryError(from, to, specifier) ??
          clientImportError(from, to, specifier)
        if (error)
          errors.push(
            `${from}:${source.getLineAndCharacterOfPosition(literal.pos).line + 1}: ${error} (${specifier})`
          )
      }
      ts.forEachChild(node, check)
    }
    check(source)
  }
if (errors.length) {
  console.error(errors.join("\n"))
  process.exitCode = 1
} else console.log("Workspace import boundaries passed.")
