// Builds the 3D models bin shows beside a part: STEP files from a VEX CAD
// library become small GLB files, plus public/models/manifest.json, which maps
// each catalog SKU to its model.
//
//   gh repo clone TlorschCode/VEX-V5-Parts-Solidworks-Download <dir> -- --depth 1
//   bun run models:build -- --src <dir>
//
// Files whose names carry no SKU (the screws) are matched by scripts/model-overrides.json,
// which maps a catalog SKU to a file inside --src.
//
// Options: --catalog <csv>  --overrides <json>  --out <dir>  --max-mb <n>
//          --jobs <n>  --force
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const TRIANGLE_BUDGET = 12000
const TIMEOUT_MS = 180_000

async function convertOne(stepPath, glbPath) {
  const [{ default: occtimportjs }, core, fns, { MeshoptSimplifier }] =
    await Promise.all([
      import("occt-import-js"),
      import("@gltf-transform/core"),
      import("@gltf-transform/functions"),
      import("meshoptimizer"),
    ])
  const occt = await occtimportjs()
  const result = occt.ReadStepFile(new Uint8Array(fs.readFileSync(stepPath)), {
    linearUnit: "millimeter",
    linearDeflectionType: "bounding_box_ratio",
    linearDeflection: 0.006,
    angularDeflection: 0.5,
  })
  if (!result.success || result.meshes.length === 0) {
    throw new Error("no geometry in STEP file")
  }

  const doc = new core.Document()
  const buffer = doc.createBuffer()
  const scene = doc.createScene()
  let triangles = 0
  for (const m of result.meshes) {
    const position = doc
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array(m.attributes.position.array))
      .setBuffer(buffer)
    const indices = doc
      .createAccessor()
      .setType("SCALAR")
      .setArray(new Uint32Array(m.index.array))
      .setBuffer(buffer)
    const [r, g, b] = m.color ?? [0.7, 0.72, 0.75]
    const material = doc
      .createMaterial(m.name || "part")
      .setBaseColorFactor([r, g, b, 1])
      .setMetallicFactor(0.2)
      .setRoughnessFactor(0.55)
    const primitive = doc
      .createPrimitive()
      .setAttribute("POSITION", position)
      .setIndices(indices)
      .setMaterial(material)
    if (m.attributes.normal) {
      primitive.setAttribute(
        "NORMAL",
        doc
          .createAccessor()
          .setType("VEC3")
          .setArray(new Float32Array(m.attributes.normal.array))
          .setBuffer(buffer)
      )
    }
    const mesh = doc.createMesh(m.name || "mesh").addPrimitive(primitive)
    scene.addChild(doc.createNode().setMesh(mesh))
    triangles += m.index.array.length / 3
  }

  await MeshoptSimplifier.ready
  await doc.transform(
    fns.weld(),
    fns.simplify({
      simplifier: MeshoptSimplifier,
      ratio: Math.min(1, TRIANGLE_BUDGET / Math.max(triangles, 1)),
      error: 0.02,
    }),
    fns.prune(),
    fns.quantize({ quantizePosition: 14, quantizeNormal: 10 })
  )
  fs.writeFileSync(glbPath, await new core.NodeIO().writeBinary(doc))
}

if (process.argv[2] === "--convert") {
  try {
    await convertOne(process.argv[3], process.argv[4])
    process.exit(0)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

// Minimal RFC 4180 parser: quoted fields may hold commas and doubled quotes.
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ",") {
      row.push(field)
      field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      field = ""
      if (row.some((cell) => cell !== "")) rows.push(row)
      row = []
    } else field += ch
  }
  if (field !== "" || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const srcDir = option("src")
if (!srcDir) {
  console.error("Missing --src <directory of STEP files>")
  process.exit(2)
}
const catalogPath = option(
  "catalog",
  path.join(
    here,
    "../../../../packages/backend/data/bin/vex-v5rc-legal-parts.csv"
  )
)
const overridesPath = option(
  "overrides",
  path.join(here, "model-overrides.json")
)
const outDir = option("out", path.join(here, "../public/models"))
const maxBytes = Number(option("max-mb", "40")) * 1e6
const jobs = Number(option("jobs", String(Math.min(4, os.cpus().length))))
const force = process.argv.includes("--force")

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === ".git" || entry.name === "Field" ? [] : walk(full)
    }
    return /\.(step|stp)$/i.test(entry.name) ? [full] : []
  })
}

const skuToken = /\b(\d{3}-\d{4}(?:-\d{3})?)\b/g
const baseOf = (sku) => sku.replace(/-\d{3}$/, "")
const files = walk(srcDir).sort()
const fileBySku = new Map()
const fileByBase = new Map()
for (const file of files) {
  const tokens = [...new Set(path.basename(file).match(skuToken) ?? [])].sort()
  for (const token of tokens) {
    if (!fileBySku.has(token)) fileBySku.set(token, file)
    if (!fileByBase.has(baseOf(token))) fileByBase.set(baseOf(token), file)
  }
}

const [header, ...body] = parseCsv(fs.readFileSync(catalogPath, "utf8"))
const skuColumn = header.indexOf("sku")
const wanted = new Map() // catalog sku -> { file, approximate }
for (const cells of body) {
  const sku = cells[skuColumn]
  const exact = fileBySku.get(sku)
  const related = fileByBase.get(baseOf(sku))
  if (exact) wanted.set(sku, { file: exact, approximate: false })
  else if (related) wanted.set(sku, { file: related, approximate: true })
}

if (fs.existsSync(overridesPath)) {
  const overrides = JSON.parse(fs.readFileSync(overridesPath, "utf8"))
  const known = new Set(body.map((cells) => cells[skuColumn]))
  for (const [sku, { file, approximate }] of Object.entries(overrides)) {
    const full = path.join(srcDir, file)
    if (!fs.existsSync(full))
      throw new Error(`Override for ${sku}: no file ${file}`)
    if (!known.has(sku)) {
      console.log(`Override for ${sku} ignored: not in the catalog.`)
      continue
    }
    wanted.set(sku, { file: full, approximate: Boolean(approximate) })
  }
}

const slug = (file) =>
  path
    .basename(file, path.extname(file))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
const outputName = (file) =>
  `${(path.basename(file).match(skuToken) ?? [slug(file)])[0]}-${createHash(
    "sha1"
  )
    .update(file)
    .digest("hex")
    .slice(0, 6)}.glb`

fs.mkdirSync(outDir, { recursive: true })
const unique = [...new Set([...wanted.values()].map((w) => w.file))]
const done = new Set()
const failed = new Map()
const queue = unique.filter((file) => {
  const target = path.join(outDir, outputName(file))
  if (fs.statSync(file).size > maxBytes) {
    failed.set(file, "STEP file too large")
    return false
  }
  if (!force && fs.existsSync(target)) {
    done.add(file)
    return false
  }
  return true
})
console.log(
  `${wanted.size} catalog parts match ${unique.length} STEP files; converting ${queue.length}, ${done.size} already done.`
)

function run(file) {
  return new Promise((resolve) => {
    const target = path.join(outDir, outputName(file))
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), "--convert", file, target],
      { stdio: ["ignore", "ignore", "pipe"] }
    )
    let stderr = ""
    child.stderr.on("data", (chunk) => (stderr += chunk))
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS)
    child.on("exit", (code) => {
      clearTimeout(timer)
      if (code === 0) done.add(file)
      else {
        failed.set(file, stderr.trim().split("\n").at(-1) || `exit ${code}`)
        fs.rmSync(target, { force: true })
      }
      console.log(
        `${done.size + failed.size}/${unique.length} ${code === 0 ? "ok" : "FAILED"} ${path.basename(file)}`
      )
      resolve()
    })
  })
}

let next = 0
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (next < queue.length) await run(queue[next++])
  })
)

const manifest = {}
for (const [sku, { file, approximate }] of [...wanted].sort()) {
  if (!done.has(file)) continue
  manifest[sku] = { file: outputName(file), approximate }
}
fs.writeFileSync(
  path.join(outDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
)
const bytes = fs
  .readdirSync(outDir)
  .filter((name) => name.endsWith(".glb"))
  .reduce((sum, name) => sum + fs.statSync(path.join(outDir, name)).size, 0)
console.log(
  `Wrote ${Object.keys(manifest).length} catalog parts, ${(bytes / 1e6).toFixed(1)} MB of models.`
)
for (const [file, reason] of failed) {
  console.log(`Skipped ${path.relative(srcDir, file)}: ${reason}`)
}
