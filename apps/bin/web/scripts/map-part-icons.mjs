// Picks the protobot icon for each catalog part, by name. Writes
// public/icons/part-icons.json: SKU -> icon path. Parts that match no rule keep
// their generated icon from generate-icons.mjs.
//
//   node scripts/map-part-icons.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, "..")
const catalogPath = path.join(
  root,
  "../../../packages/backend/data/bin/vex-v5rc-legal-parts.csv"
)
const outPath = path.join(root, "public/icons/part-icons.json")

// Rules run in order; the first match wins. Each icon is a file in
// public/icons/protobot.
const RULES = [
  // Phosphor icons are drawn by the app; their names start with "phosphor:".
  [/power cable/i, null, "phosphor:lightning"],
  [
    /\bscrew\b.*star drive|star drive.*\bscrew\b/i,
    /coupler|collar|shaft|retainer|bracket|lead/i,
    "screw-head",
  ],
  [
    /\b(screw|screws|thumbscrew|bolt)\b/i,
    /coupler|nut|insert|retainer|bracket|driver|gear|shaft|bearing|lead/i,
    "garage-screw",
  ],
  [/\bbrain\b/i, null, "brain"],
  [/motor/i, /cartridge/i, "motor"],
  [/\bhs\b.*gear|high strength gear/i, null, "hs-gears"],
  [/\bhs\b.*sprocket|high strength sprocket/i, null, "hs-sprockets"],
  [/gear/i, /bevel|shifter|bracket|gearbox/i, "gear"],
  [/sprocket/i, null, "sprockets"],
  [/omni/i, null, "omni-wheel-icon"],
  [/mecanum|mechanum/i, null, "mechanum-wheels"],
  [/traction/i, null, "traction-wheel"],
  [/flex wheel/i, null, "flex-wheels"],
  [/leg wheel/i, null, "leg-wheels"],
  [/standoff/i, /retainer|coupler/i, "standoff"],
  [/washer/i, null, "washer"],
  [/spacer/i, /plastic/i, "spacers-icon"],
  [/plastic spacer/i, null, "plastic-spacer"],
  [/\bnut\b|keps|nylock|hex nut/i, /retainer|bracket/i, "nut"],
  [/bearing/i, null, "bearing-icon"],
  [/shaft collar/i, /high strength|low profile/i, "normal-shaft-collar"],
  [/shaft/i, null, "shafts-icon"],
  [/c-channel/i, null, "c-channel-icon"],
  [/u-channel/i, null, "u-channel"],
  [/angle/i, null, "angles"],
  [/gusset/i, null, "gussets"],
  [/battery/i, null, "batteryv5"],
  [/cylinder/i, null, "cylinder"],
  [/radio/i, null, "radio"],
  [/sensor/i, null, "sensor"],
  [/insert/i, null, "inserts"],
  [/rubber bumper/i, null, "rubber-bumper-icon-1"],
  [/steel bar/i, null, "steel-bar"],
  [/\bplates?\b/i, null, "plates"],
  [/\brail/i, null, "rail-icon"],
  [/switch/i, null, "switch"],
]

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

const [header, ...body] = parseCsv(fs.readFileSync(catalogPath, "utf8"))
const sku = header.indexOf("sku")
const name = header.indexOf("name")
const map = {}
for (const cells of body) {
  const rule = RULES.find(([include, exclude, icon]) => {
    if (!include.test(cells[name])) return false
    return !(exclude && exclude.test(cells[name]))
  })
  if (!rule) continue
  if (rule[2].startsWith("phosphor:")) {
    map[cells[sku]] = rule[2]
  } else if (
    fs.existsSync(path.join(root, "public/icons/protobot", `${rule[2]}.svg`))
  ) {
    map[cells[sku]] = `/icons/protobot/${rule[2]}.svg`
  }
}
fs.writeFileSync(outPath, `${JSON.stringify(map, null, 2)}\n`)
console.log(
  `${Object.keys(map).length} of ${body.length} catalog parts have a protobot icon.`
)
