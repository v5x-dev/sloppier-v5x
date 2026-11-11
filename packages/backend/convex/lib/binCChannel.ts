// All C-channels are one part, C-Channel, with three options: material, width,
// and length. Each combination is counted on its own. The VEX catalog lists
// eight of these combinations as separate parts, and those names are still
// recognized so the old rows can be folded into the new one.
//
// This file has no Convex imports, so the app can use it too.
export const C_CHANNEL_SKU = "C-CHANNEL"
export const C_CHANNEL_NAME = "C-Channel"

export const cChannelMaterials = ["steel", "aluminum"] as const
export type CChannelMaterial = (typeof cChannelMaterials)[number]

export const cChannelWidths = [2, 3, 5] as const
export type CChannelWidth = (typeof cChannelWidths)[number]

export const cChannelLengths = Array.from({ length: 35 }, (_, i) => i + 1)

export type CChannelOptions = {
  material: CChannelMaterial
  width: CChannelWidth
  length: number
}

// What a C-channel shows before anyone picks: the most common VEX size.
export const defaultCChannel: CChannelOptions = {
  material: "steel",
  width: 2,
  length: 35,
}

const materialLabels: Record<CChannelMaterial, string> = {
  steel: "Steel",
  aluminum: "Aluminum",
}

// The stored form of an option set, e.g. "steel-2x35". It is what the
// `variant` fields hold, so it stays short and sorts by material then width.
export function encodeCChannel(options: CChannelOptions): string {
  return `${options.material}-${options.width}x${options.length}`
}

// The option set for a stored variant, or null if it is not a valid one.
export function decodeCChannel(variant: string): CChannelOptions | null {
  const match = /^(steel|aluminum)-(\d+)x(\d+)$/.exec(variant)
  if (!match) return null
  const width = Number(match[2])
  const length = Number(match[3])
  const isWidth = (cChannelWidths as readonly number[]).includes(width)
  const isLength = cChannelLengths.includes(length)
  if (!isWidth || !isLength) return null
  const options = {
    material: match[1] as CChannelMaterial,
    width: width as CChannelWidth,
    length,
  }
  return encodeCChannel(options) === variant ? options : null
}

// "Steel · 2 × 35"
export function cChannelLabel(variant: string): string | null {
  const options = decodeCChannel(variant)
  if (!options) return null
  return `${materialLabels[options.material]} · ${options.width} × ${options.length}`
}

// The part's name with its option set, for lists and history: "C-Channel,
// Steel · 2 × 35". Parts without a variant keep their name.
export function displayName(name: string, variant: string | undefined) {
  if (variant === undefined) return name
  const label = cChannelLabel(variant)
  return label === null ? name : `${name}, ${label}`
}

// The VEX part number for each combination the catalog sells on its own. Used
// to show the 3D model for a size; a size without one has no model.
const vexSkuByVariant = new Map<string, string>([
  [encodeCChannel({ material: "steel", width: 5, length: 25 }), "275-1138"],
  [encodeCChannel({ material: "steel", width: 5, length: 35 }), "275-1139"],
  [encodeCChannel({ material: "aluminum", width: 2, length: 25 }), "276-2288"],
  [encodeCChannel({ material: "aluminum", width: 2, length: 35 }), "276-2289"],
  [encodeCChannel({ material: "aluminum", width: 5, length: 25 }), "276-2290"],
  [encodeCChannel({ material: "aluminum", width: 5, length: 35 }), "276-2298"],
  [encodeCChannel({ material: "steel", width: 2, length: 35 }), "276-2906"],
  [encodeCChannel({ material: "aluminum", width: 3, length: 35 }), "276-4359"],
])

export function vexSkuForVariant(variant: string): string | null {
  return vexSkuByVariant.get(variant) ?? null
}

export function allVexSkus(): string[] {
  return [...vexSkuByVariant.values()]
}

// The stored variant for a VEX C-channel name such as "1x2x1x35 Steel C-Channel"
// (width 2, length 35), or null for any other name.
export function variantForVexName(name: string): string | null {
  const match = /^1x(\d+)x1x(\d+) (Steel|Aluminum) C-Channel$/.exec(name)
  if (!match) return null
  const variant = `${match[3].toLowerCase()}-${match[1]}x${match[2]}`
  return decodeCChannel(variant) === null ? null : variant
}
