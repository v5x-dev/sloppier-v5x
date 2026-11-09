// Robosource star drive screws can be bought color coded by length. The chart
// lists 13 lengths, and the catalog has the same 13 star drive screws from 1/4"
// to 2.5". The chart's shortest bar is labeled 0.290" rather than 0.250", so the
// 1/4" screw takes that color.
export type ScrewColor = {
  name: string
  hex: string
  length: string
}

// Keyed by length in thousandths of an inch, so fractions and decimals compare
// exactly.
const screwColors = new Map<number, ScrewColor>([
  [250, { name: "yellow", hex: "#d9d11f", length: '0.290"' }],
  [375, { name: "orange", hex: "#f2a20c", length: '0.375"' }],
  [500, { name: "red", hex: "#ee1111", length: '0.500"' }],
  [625, { name: "bright green", hex: "#2be01f", length: '0.625"' }],
  [750, { name: "dark green", hex: "#0b8a12", length: '0.750"' }],
  [875, { name: "light blue", hex: "#6ab4e8", length: '0.875"' }],
  [1000, { name: "blue", hex: "#1212c8", length: '1.000"' }],
  [1250, { name: "pink", hex: "#f0b4e6", length: '1.250"' }],
  [1500, { name: "magenta", hex: "#c010a8", length: '1.500"' }],
  [1750, { name: "white", hex: "#ffffff", length: '1.750"' }],
  [2000, { name: "black", hex: "#111111", length: '2.000"' }],
  [2250, { name: "tan", hex: "#d4c4a4", length: '2.250"' }],
  [2500, { name: "brown", hex: "#8a5a10", length: '2.500"' }],
])

// Only the plain star drive screw is coded. Locking, set, hex, and thumb screws
// are not.
const starDriveScrew = /^(\d+\/\d+|\d*\.\d+|\d+)"\s+Star Drive Screw$/

// The color for a part's name, or null when it is not a coded screw.
export function screwColorForName(name: string): ScrewColor | null {
  const match = starDriveScrew.exec(name.trim())
  if (!match) return null
  const length = match[1]
  const [whole, bottom] = length.split("/")
  const inches =
    bottom === undefined ? Number(whole) : Number(whole) / Number(bottom)
  return screwColors.get(Math.round(inches * 1000)) ?? null
}
