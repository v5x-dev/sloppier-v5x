import assert from "node:assert/strict"
import test from "node:test"
import { parametricMesh } from "../lib/parametric.mjs"

test("parametric prisms have outward face normals and polygon volume", () => {
  const sides = 8
  const radiusMm = 20
  const heightMm = 165
  const mesh = parametricMesh([
    { kind: "cylinder", diameterMm: 2 * radiusMm, heightMm, sides },
  ])

  const { positions, normals } = mesh
  for (let i = 0; i < positions.length; i += 9) {
    const center = [0, 0, 0]
    for (let vertex = 0; vertex < 3; vertex++)
      for (let axis = 0; axis < 3; axis++)
        center[axis] += positions[i + vertex * 3 + axis] / 3

    const normal = [normals[i], normals[i + 1], normals[i + 2]]
    if (Math.abs(center[1]) > heightMm / 2 - 1e-6) {
      assert.ok(
        normal[1] * center[1] > 0,
        `cap normal points out at triangle ${i / 9}`
      )
    } else {
      assert.ok(
        normal[0] * center[0] + normal[2] * center[2] > 0,
        `side normal points out at triangle ${i / 9}`
      )
    }
  }

  const expectedVolume =
    (sides / 2) * radiusMm ** 2 * Math.sin((2 * Math.PI) / sides) * heightMm
  assert.ok(Math.abs(mesh.volumeMm3 - expectedVolume) < expectedVolume * 1e-6)
})
