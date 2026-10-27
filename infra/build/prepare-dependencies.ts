import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildDependencies,
  isBuildDependency,
} from "../../packages/backend/convex/lib/buildDependencies"
import { loadTemplateFiles } from "../../packages/backend/convex/lib/templates"

const root = fileURLToPath(new URL("./vendor/deps/", import.meta.url))
await rm(root, { recursive: true, force: true })
await mkdir(root, { recursive: true })
for (const template of ["pros", "ez-template"] as const) {
  const files = await loadTemplateFiles(template, "Build dependencies")
  const dependencies = files.filter((file) =>
    isBuildDependency(template, file.path)
  )
  for (const file of dependencies) {
    const path = `${root}/${template}/${file.path}`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, file.contents)
  }
  console.log(`${template}: baked ${dependencies.length} dependency files`)
}
await writeFile(
  `${root}/manifest.json`,
  JSON.stringify(buildDependencies, null, 2)
)

// Recompile libraries shipped with the soft-float EZ example for PROS 4.2's ABI.
// Keep sources outside /opt/v5x/deps; only the resulting archives ship at runtime.
const { OKAPI_REVISION, fetchZip } =
  await import("../../packages/backend/convex/lib/templates")
const sourceRoot = fileURLToPath(
  new URL("./vendor/library-sources/", import.meta.url)
)
await rm(sourceRoot, { recursive: true, force: true })
for (const [name, repo, revision, prefix] of [
  [
    "ez",
    "EZ-Robotics/EZ-Template",
    "de322910376b2d3ba152ca8ae744d071a86ded6b",
    "src/EZ-Template/",
  ],
  ["okapi", "purduesigbots/OkapiLib", OKAPI_REVISION, "src/"],
]) {
  const archive = await fetchZip(
    `https://codeload.github.com/${repo}/zip/${revision}`
  )
  for (const [path, contents] of Object.entries(archive)) {
    const relative = path.split("/").slice(1).join("/")
    if (
      !relative.startsWith(prefix!) ||
      !relative.endsWith(".cpp") ||
      relative.startsWith("src/test/") ||
      relative === "src/main.cpp"
    )
      continue
    const target = `${sourceRoot}/${name}/${relative}`
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, contents)
  }
}
