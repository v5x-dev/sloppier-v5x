// Orders names the way people read sizes. Numbers compare as numbers, fractions
// as their value, so 1.25" comes before 2" and 2.5", and 1/4" before 1/2".
// Other text compares as text.
type Token = number | string

const piece = /\d+(?:\.\d+)?(?:\/\d+)?|\D+/g

function tokens(name: string): Token[] {
  return (name.match(piece) ?? []).map((part): Token => {
    if (!/^\d/.test(part)) return part
    const [whole, bottom] = part.split("/")
    return bottom === undefined ? Number(whole) : Number(whole) / Number(bottom)
  })
}

export function compareNames(a: string, b: string): number {
  const x = tokens(a)
  const y = tokens(b)
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const p = x[i]
    const q = y[i]
    if (typeof p === "number" && typeof q === "number") {
      if (p !== q) return p - q
      continue
    }
    const order = String(p).localeCompare(String(q), undefined, {
      sensitivity: "base",
    })
    if (order !== 0) return order
  }
  return x.length - y.length || a.localeCompare(b)
}
