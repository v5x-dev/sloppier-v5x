// Derives the React Native theme (src/code/native.css) from the web theme
// (src/code/web.css). web.css stays the single source of token values; this script
// only rewrites its color tokens into the form Uniwind reads: one @layer theme block
// with a @variant per theme, and each color exposed as a --color-* utility name.
//
//   node scripts/build-native.mjs          rewrite src/code/native.css
//   node scripts/build-native.mjs --check  exit 1 if native.css is out of date

import { readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const webPath = resolve(packageRoot, "src/code/web.css")
const nativePath = resolve(packageRoot, "src/code/native.css")

const colorValue = /^(oklch|rgb|hsl|#)/

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "")
}

// Returns the declarations of the first top-level block whose selector matches.
function declarationsOf(css, selector) {
  const block = new RegExp(`^${selector}\\s*\\{([\\s\\S]*?)^\\}`, "m").exec(css)
  if (!block) throw new Error(`build-native: no ${selector} block in web.css`)
  const declarations = new Map()
  for (const [, name, value] of block[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    declarations.set(name, value.trim().replace(/\s+/g, " "))
  }
  return declarations
}

export function buildNativeCss(webCss) {
  const css = stripComments(webCss)
  const light = declarationsOf(css, ":root")
  const dark = declarationsOf(css, "\\.dark")

  // The web cascade keeps a :root value wherever .dark does not override it, so a
  // dark theme is the light theme with the dark overrides applied.
  const themes = {
    light: new Map(),
    dark: new Map([...light, ...dark]),
  }
  for (const [name, value] of light) {
    if (colorValue.test(value)) themes.light.set(name, value)
  }
  for (const [name, value] of themes.dark) {
    if (!colorValue.test(value)) themes.dark.delete(name)
  }

  const lines = [
    "/* Generated from web.css by scripts/build-native.mjs. Do not edit by hand. */",
    "@layer theme {",
    "  :root {",
  ]
  for (const theme of ["light", "dark"]) {
    lines.push(`    @variant ${theme} {`)
    for (const [name, value] of themes[theme]) {
      lines.push(`      --color-${name}: ${value};`)
    }
    lines.push("    }")
  }
  lines.push("  }", "}", "")
  return lines.join("\n")
}

function main() {
  const generated = buildNativeCss(readFileSync(webPath, "utf8"))
  const target = relative(packageRoot, nativePath)

  if (process.argv.includes("--check")) {
    let current = ""
    try {
      current = readFileSync(nativePath, "utf8")
    } catch {
      // A missing file is out of date.
    }
    if (current !== generated) {
      console.error(`${target} is out of date. Run: bun run build:native`)
      process.exitCode = 1
    } else {
      console.log(`${target} is up to date.`)
    }
    return
  }

  writeFileSync(nativePath, generated)
  console.log(`Wrote ${target}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
