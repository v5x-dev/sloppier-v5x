import { readdirSync, readFileSync } from "node:fs"
import { resolve, relative } from "node:path"
import {
  findTestHygieneViolations,
  isTestFile,
  placementError,
} from "./lib/test-hygiene.mjs"

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

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.startsWith(".")) continue
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) yield* files(path)
    else if (isTestFile(entry.name)) yield path
  }
}

const problems = []
let count = 0
for (const path of files(root)) {
  const file = relative(root, path).replaceAll("\\", "/")
  count++
  const placement = placementError(file)
  if (placement) problems.push(`${file}:1 ${placement}`)
  const source = readFileSync(path, "utf8")
  for (const violation of findTestHygieneViolations(file, source))
    problems.push(
      `${file}:${violation.line} [${violation.rule}] ${violation.message}`
    )
}

if (problems.length > 0) {
  console.error(problems.join("\n"))
  console.error(
    `\n${problems.length} test hygiene problem(s) in ${count} test file(s).`
  )
  process.exitCode = 1
} else {
  console.log(`Test hygiene passed for ${count} test file(s).`)
}
