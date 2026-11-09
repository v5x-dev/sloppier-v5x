import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { buildNativeCss } from "../scripts/build-native.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const webCss = readFileSync(resolve(root, "src/code/web.css"), "utf8")
const nativeCss = readFileSync(resolve(root, "src/code/native.css"), "utf8")

// Parses the generated file into { light: Map, dark: Map } of --color-* values.
function themesOf(css) {
  const themes = { light: new Map(), dark: new Map() }
  let current = null
  for (const line of css.split("\n")) {
    const variant = /@variant (light|dark) \{/.exec(line)
    if (variant) current = themes[variant[1]]
    const declaration = /--color-([a-z0-9-]+): (.+);/.exec(line)
    if (declaration && current) current.set(declaration[1], declaration[2])
  }
  return themes
}

test("native.css is generated from web.css", () => {
  assert.equal(
    nativeCss,
    buildNativeCss(webCss),
    "native.css is out of date; run `bun run build:native`"
  )
})

test("light and dark themes define the same color names", () => {
  const { light, dark } = themesOf(nativeCss)
  assert.deepEqual([...dark.keys()].sort(), [...light.keys()].sort())
})

test("dark values come from .dark, and fall back to :root where .dark is silent", () => {
  const { light, dark } = themesOf(nativeCss)
  assert.equal(light.get("background"), "oklch(0.975 0.004 80)")
  assert.equal(dark.get("background"), "oklch(0.165 0.005 60)")
  // --template-* is set only in :root, so the dark theme inherits it.
  assert.equal(dark.get("template-jar"), light.get("template-jar"))
})
