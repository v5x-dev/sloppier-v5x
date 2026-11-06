// Traces the protobot icons (PNG) into single-color SVGs. A light, opaque pixel
// is the part; transparent and dark pixels are the background.
//
//   node scripts/trace-protobot-icons.mjs <dir with protobot PNGs>
//
// Output goes to public/icons/protobot, one <slug>.svg per PNG.
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { PNG } = require("pngjs")
const potrace = require("potrace")

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, "../public/icons/protobot")
const source = process.argv[2]
if (!source) {
  console.error("Usage: node scripts/trace-protobot-icons.mjs <dir with PNGs>")
  process.exit(2)
}

// A 1-bit-per-pixel BMP: black where the part is, so potrace traces the part.
function toBmp(mask, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const pixels = Buffer.alloc(rowSize * height, 255)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue
      const at = (height - 1 - y) * rowSize + x * 3
      pixels[at] = 0
      pixels[at + 1] = 0
      pixels[at + 2] = 0
    }
  const header = Buffer.alloc(54)
  header.write("BM", 0)
  header.writeUInt32LE(54 + pixels.length, 2)
  header.writeUInt32LE(54, 10)
  header.writeUInt32LE(40, 14)
  header.writeInt32LE(width, 18)
  header.writeInt32LE(height, 22)
  header.writeUInt16LE(1, 26)
  header.writeUInt16LE(24, 28)
  header.writeUInt32LE(pixels.length, 34)
  return Buffer.concat([header, pixels])
}

function trace(bmp, width, height) {
  return new Promise((resolve, reject) => {
    potrace.trace(
      bmp,
      {
        threshold: 128,
        turdSize: 2,
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
            return `<path fill="currentColor" fill-rule="evenodd" d="${d}"${attr}/>`
          })
          .join("")
        resolve(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${body}</svg>`
        )
      }
    )
  })
}

fs.mkdirSync(outDir, { recursive: true })
const slug = (name) =>
  name
    .replace(/\.png$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

let failed = 0
const files = fs
  .readdirSync(source)
  .filter((f) => f.toLowerCase().endsWith(".png"))
for (const file of files) {
  try {
    const png = PNG.sync.read(fs.readFileSync(path.join(source, file)))
    const { width, height, data } = png
    const mask = new Uint8Array(width * height)
    // Opaque light pixels are the part. Some icons have opaque dark holes,
    // which must stay background.
    for (let i = 0; i < width * height; i++) {
      const light = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3 >= 128
      mask[i] = data[i * 4 + 3] >= 128 && light ? 1 : 0
    }
    if (!mask.some((v) => v === 1)) throw new Error("no opaque pixels")
    const svg = await trace(toBmp(mask, width, height), width, height)
    fs.writeFileSync(path.join(outDir, `${slug(file)}.svg`), `${svg}\n`)
  } catch (error) {
    failed++
    console.log(
      `FAILED ${file}: ${error instanceof Error ? error.message : error}`
    )
  }
}
console.log(
  `Traced ${files.length - failed} of ${files.length} icons into public/icons/protobot.`
)
