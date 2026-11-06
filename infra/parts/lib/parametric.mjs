// Parametric Parts: solids written from published dimensions, for field elements that
// have no STEP or mesh source. Each Part lists its shapes in millimetres with the axis
// along Y (the Part frame is Y up). The output is flat triangles, centred on the bounds,
// the same as a converted STEP model. Shapes may overlap; their volumes are summed, so
// callers must not rely on the volume of a Part whose shapes overlap.

const TAU = Math.PI * 2

/** Vertices of a regular polygon in the XZ plane, `radius` from its centre. */
function polygon(sides, radius) {
  const out = []
  for (let k = 0; k < sides; k++) {
    const a = (k * TAU) / sides
    out.push([radius * Math.cos(a), radius * Math.sin(a)])
  }
  return out
}

/**
 * A straight prism along Y, centred on the origin. `across` is the flat-to-flat width for
 * an octagon-like polygon; `diameterMm` is used for a round cylinder. `sides` 64 reads as
 * a cylinder.
 */
export function prismTriangles({ sides, radiusMm, heightMm, at = [0, 0, 0] }) {
  const ring = polygon(sides, radiusMm)
  const top = heightMm / 2
  const bottom = -heightMm / 2
  const tris = []
  const v = (p, y) => [p[0] + at[0], y + at[1], p[1] + at[2]]
  for (let k = 0; k < sides; k++) {
    const a = ring[k],
      b = ring[(k + 1) % sides]
    tris.push([v([0, 0], top), v(b, top), v(a, top)])
    tris.push([v([0, 0], bottom), v(a, bottom), v(b, bottom)])
    tris.push([v(a, bottom), v(b, top), v(b, bottom)])
    tris.push([v(a, bottom), v(a, top), v(b, top)])
  }
  return tris
}

/** The radius that gives a regular polygon its flat-to-flat width `acrossFlatsMm`. */
export function radiusForAcrossFlats(sides, acrossFlatsMm) {
  return acrossFlatsMm / 2 / Math.cos(Math.PI / sides)
}

/** Shapes listed in a Part's manifest entry, to triangles. */
export function shapeTriangles(shape) {
  if (shape.kind === "cylinder")
    return prismTriangles({
      sides: shape.sides ?? 64,
      radiusMm: shape.diameterMm / 2,
      heightMm: shape.heightMm,
      at: shape.at,
    })
  if (shape.kind === "polygon-prism")
    return prismTriangles({
      sides: shape.sides,
      radiusMm: radiusForAcrossFlats(shape.sides, shape.acrossFlatsMm),
      heightMm: shape.heightMm,
      at: shape.at,
    })
  if (shape.kind === "triangle-prism") {
    // An equilateral triangle with side `sideMm`: its circumradius is side / sqrt(3).
    return prismTriangles({
      sides: 3,
      radiusMm: shape.sideMm / Math.sqrt(3),
      heightMm: shape.heightMm,
      at: shape.at,
    })
  }
  throw new Error(`Unknown parametric shape "${shape.kind}"`)
}

/**
 * Joins a Part's shapes into one mesh, centred on its bounding box. Returns flat positions
 * and normals (one normal per triangle), the bounds, and the summed volume.
 */
export function parametricMesh(shapes) {
  const tris = shapes.flatMap(shapeTriangles)
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const t of tris)
    for (const p of t)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[k])
        hi[k] = Math.max(hi[k], p[k])
      }
  const center = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2)
  const positions = new Float32Array(tris.length * 9)
  const normals = new Float32Array(tris.length * 9)
  let volume = 0
  tris.forEach((t, i) => {
    const p = t.map((q) => [
      q[0] - center[0],
      q[1] - center[1],
      q[2] - center[2],
    ])
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]]
    const w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]]
    let n = [
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0],
    ]
    const len = Math.hypot(...n) || 1
    n = n.map((x) => x / len)
    for (let k = 0; k < 3; k++) {
      positions.set(p[k], i * 9 + k * 3)
      normals.set(n, i * 9 + k * 3)
    }
    volume +=
      (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) -
        p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) +
        p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) /
      6
  })
  const sizeMm = { x: hi[0] - lo[0], y: hi[1] - lo[1], z: hi[2] - lo[2] }
  return {
    positions,
    normals,
    triangles: tris.length,
    sizeMm,
    volumeMm3: Math.abs(volume),
    bounds: { min: lo, max: hi, center },
  }
}
