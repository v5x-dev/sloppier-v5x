// Makes a flat, unlit icon for every 3D model in public/models, in the style of
// the protobot part icons. Each icon is a single-color SVG (fill="currentColor")
// that the UI can tint.
//
//   bun run icons:build            # all models
//   bun run icons:build -- --force # redo every icon
//
// Most parts are a silhouette: the view with the largest outline, rasterized and
// traced with potrace. Screws are drawn like protobot's screw heads, seen from
// above: a round head, with a six-lobed star recess for star-drive screws.
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, "..")
const modelsDir = path.join(root, "public/models")
const iconsDir = path.join(modelsDir, "icons")
const catalogPath = path.join(
  root,
  "../../../packages/backend/data/bin/vex-v5rc-legal-parts.csv"
)
const force = process.argv.includes("--force")
const RESOLUTION = 512
const VIEW_RESOLUTION = 96
const PADDING = 0.06

const require = createRequire(import.meta.url)
const potrace = require("potrace")
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js")
const { Mesh, Vector3 } = await import("three")

// Triangles in world space, as [[x, y, z] x 3] per triangle.
async function loadTriangles(file) {
  const buffer = fs.readFileSync(file)
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  )
  const gltf = await new Promise((resolve, reject) =>
    new GLTFLoader().parse(arrayBuffer, "", resolve, reject)
  )
  gltf.scene.updateMatrixWorld(true)
  const triangles = []
  const v = new Vector3()
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const position = object.geometry.getAttribute("position")
    const index = object.geometry.getIndex()
    const count = index ? index.count : position.count
    for (let i = 0; i + 2 < count; i += 3) {
      triangles.push(
        [0, 1, 2].map((k) => {
          const vertex = index ? index.getX(i + k) : i + k
          return v
            .fromBufferAttribute(position, vertex)
            .applyMatrix4(object.matrixWorld)
            .toArray()
        })
      )
    }
  })
  return triangles
}

// The silhouette seen down one axis. A pair is [across, down]; the third axis
// is the depth.
const DEFAULT_PAIRS = [
  [1, 2],
  [0, 2],
  [0, 1],
]

function bounds(triangles, axes) {
  let minU = Infinity
  let minV = Infinity
  let maxU = -Infinity
  let maxV = -Infinity
  for (const tri of triangles)
    for (const p of tri) {
      minU = Math.min(minU, p[axes[0]])
      maxU = Math.max(maxU, p[axes[0]])
      minV = Math.min(minV, p[axes[1]])
      maxV = Math.max(maxV, p[axes[1]])
    }
  return { minU, minV, maxU, maxV }
}

// Fills every triangle's projection into a size x size mask of 0/1. The
// projection is centered in the frame at the given scale (pixels per unit).
function rasterize(triangles, axes, size, box, scale) {
  const offsetU = (size - (box.maxU - box.minU) * scale) / 2
  const offsetV = (size - (box.maxV - box.minV) * scale) / 2
  const mask = new Uint8Array(size * size)
  const toX = (p) => (p[axes[0]] - box.minU) * scale + offsetU
  // Image rows run top to bottom, so larger heights sit at the top.
  const toY = (p) => size - ((p[axes[1]] - box.minV) * scale + offsetV)

  for (const tri of triangles) {
    const ax = toX(tri[0])
    const ay = toY(tri[0])
    const bx = toX(tri[1])
    const by = toY(tri[1])
    const cx = toX(tri[2])
    const cy = toY(tri[2])
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (Math.abs(area) < 1e-12) continue
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
    const x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)))
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)))
    const y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)))
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area
        const w2 = ((ax - px) * (by - py) - (ay - py) * (bx - px)) / area
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) mask[y * size + x] = 1
      }
    }
  }
  return mask
}

// The view with the largest silhouette. Every view uses the same scale, so a
// long thin side view is compared fairly with a round end view.
function bestView(triangles, pairs = DEFAULT_PAIRS) {
  const extents = [0, 1, 2].map((axis) => {
    let low = Infinity
    let high = -Infinity
    for (const tri of triangles)
      for (const p of tri) {
        low = Math.min(low, p[axis])
        high = Math.max(high, p[axis])
      }
    return high - low
  })
  const size3d = Math.max(...extents, 1e-9)
  const scale = (VIEW_RESOLUTION * (1 - 2 * PADDING)) / size3d
  let best = null
  for (const axes of pairs) {
    const box = bounds(triangles, axes)
    const mask = rasterize(triangles, axes, VIEW_RESOLUTION, box, scale)
    const area = mask.reduce((sum, value) => sum + value, 0)
    const reach = (box.maxU - box.minU) * (box.maxV - box.minV)
    if (
      best === null ||
      area > best.area ||
      (area === best.area && reach > best.reach)
    )
      best = { axes, box, area, reach }
  }
  // A part thinner than one selection pixel leaves every view empty, so fall
  // back to the view that spans the most space.
  if (best.area === 0) {
    for (const axes of pairs) {
      const box = bounds(triangles, axes)
      const reach = (box.maxU - box.minU) * (box.maxV - box.minV)
      if (reach > best.reach) best = { axes, box, area: 0, reach }
    }
  }
  return best
}

// Protobot's screw head, seen from above: a round head with a six-lobed star
// recess. The recess reaches a third of the way to the edge at its lobes.
function drawScrewHead(star, size) {
  const mask = new Uint8Array(size * size)
  const radius = size * 0.42
  const center = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - center
      const dy = y + 0.5 - center
      const r = Math.hypot(dx, dy)
      if (r > radius) continue
      if (star) {
        // Radius of the recess edge at this angle: rounded lobes, six per turn.
        const lobe = (1 + Math.cos(6 * Math.atan2(dy, dx))) / 2
        if (r < radius * (0.2 + 0.14 * lobe)) continue
      }
      mask[y * size + x] = 1
    }
  }
  return mask
}

// A 1-bit-per-pixel BMP, black where the part is, so potrace traces the part.
function toBmp(mask, size) {
  const rowSize = Math.ceil((size * 3) / 4) * 4
  const pixels = Buffer.alloc(rowSize * size, 255)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!mask[y * size + x]) continue
      // BMP rows are stored bottom-up.
      const at = (size - 1 - y) * rowSize + x * 3
      pixels[at] = 0
      pixels[at + 1] = 0
      pixels[at + 2] = 0
    }
  }
  const header = Buffer.alloc(54)
  header.write("BM", 0)
  header.writeUInt32LE(54 + pixels.length, 2)
  header.writeUInt32LE(54, 10)
  header.writeUInt32LE(40, 14)
  header.writeInt32LE(size, 18)
  header.writeInt32LE(size, 22)
  header.writeUInt16LE(1, 26)
  header.writeUInt16LE(24, 28)
  header.writeUInt32LE(pixels.length, 34)
  return Buffer.concat([header, pixels])
}

function traceToSvg(mask, size) {
  return new Promise((resolve, reject) => {
    potrace.trace(
      toBmp(mask, size),
      {
        threshold: 128,
        turdSize: 4,
        alphaMax: 1,
        optCurve: true,
        optTolerance: 0.2,
      },
      (error, svg) => {
        if (error) return reject(error)
        const paths = [
          ...svg.matchAll(/<path d="([^"]+)"(?: transform="([^"]+)")?/g),
        ]
        if (paths.length === 0) return reject(new Error("nothing to trace"))
        const body = paths
          .map(([, d, transform]) => {
            const attr = transform ? ` transform="${transform}"` : ""
            return `<path fill="currentColor" d="${d}"${attr}/>`
          })
          .join("")
        resolve(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${body}</svg>`
        )
      }
    )
  })
}

// kind is "star" for star-drive screws, "screw" for other screws, or null.
async function iconFor(file, kind) {
  if (kind)
    return traceToSvg(drawScrewHead(kind === "star", RESOLUTION), RESOLUTION)

  const triangles = await loadTriangles(file)
  if (triangles.length === 0) throw new Error("no geometry")
  const view = bestView(triangles)
  // The chosen view fills the frame, so its detail uses the full resolution.
  const span =
    Math.max(view.box.maxU - view.box.minU, view.box.maxV - view.box.minV) || 1
  const scale = (RESOLUTION * (1 - 2 * PADDING)) / span
  const mask = rasterize(triangles, view.axes, RESOLUTION, view.box, scale)
  if (!mask.some((value) => value === 1)) throw new Error("empty silhouette")
  return traceToSvg(mask, RESOLUTION)
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

const manifest = JSON.parse(
  fs.readFileSync(path.join(modelsDir, "manifest.json"), "utf8")
)
const [catalogHeader, ...catalogRows] = parseCsv(
  fs.readFileSync(catalogPath, "utf8")
)
const nameBySku = new Map(
  catalogRows.map((cells) => [
    cells[catalogHeader.indexOf("sku")],
    cells[catalogHeader.indexOf("name")],
  ])
)

// A file is a screw when one of the catalog parts it models is a screw. Couplers,
// nuts, brackets, and drivers are not.
const SCREW = /\b(screw|screws|thumbscrew|bolt)\b/i
const NOT_SCREW =
  /coupler|nut|insert|retainer|bracket|driver|gear|shaft|bearing|lead/i
const kindByFile = new Map()
for (const [sku, entry] of Object.entries(manifest)) {
  const name = nameBySku.get(sku) ?? ""
  if (!SCREW.test(name) || NOT_SCREW.test(name)) continue
  const star = /star drive/i.test(name)
  // A file keeps "star" if any of its parts is a star-drive screw.
  if (star || !kindByFile.has(entry.file)) {
    kindByFile.set(entry.file, star ? "star" : "screw")
  }
}

if (process.env.KINDDBG)
  console.log(
    "KIND",
    JSON.stringify(
      [...kindByFile].filter(([f]) => f.startsWith("1-00-inch-star"))
    )
  )
const files = [
  ...new Set(Object.values(manifest).map((entry) => entry.file)),
].sort()
fs.mkdirSync(iconsDir, { recursive: true })
const todo = files.filter(
  (file) =>
    force || !fs.existsSync(path.join(iconsDir, file.replace(/\.glb$/, ".svg")))
)
console.log(`${files.length} models, making ${todo.length} icons.`)

let failed = 0
for (const [index, file] of todo.entries()) {
  try {
    const svg = await iconFor(
      path.join(modelsDir, file),
      kindByFile.get(file) ?? null
    )
    fs.writeFileSync(
      path.join(iconsDir, file.replace(/\.glb$/, ".svg")),
      `${svg}\n`
    )
    if (index % 25 === 0) console.log(`${index + 1}/${todo.length} ${file}`)
  } catch (error) {
    failed++
    console.log(
      `FAILED ${file}: ${error instanceof Error ? error.message : error}`
    )
  }
}
console.log(`Done. ${todo.length - failed} made, ${failed} failed.`)
