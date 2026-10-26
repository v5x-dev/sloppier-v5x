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
