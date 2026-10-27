// Prints the starter files that prewarm-pch.py compiles, using the same loader and managed-path filter as uploads.
import { loadTemplateFiles } from "../../packages/backend/convex/lib/templates"
import { isBuildDependency } from "../../packages/backend/convex/lib/buildDependencies"

const templates = ["pros", "ez-template"] as const
const out: Record<string, Record<string, string>> = {}
for (const template of templates) {
  const files = await loadTemplateFiles(template, "Prewarm")
  out[template] = Object.fromEntries(
    files
      .filter((file) => !isBuildDependency(template, file.path))
      .map((file) => [
        file.path,
        Buffer.from(
          typeof file.contents === "string"
            ? new TextEncoder().encode(file.contents)
            : file.contents
        ).toString("base64"),
      ])
  )
}
console.log(JSON.stringify({ templates: out }))
