import { Color, Scene } from "three"
import * as Y from "yjs"
import { expect, it } from "vitest"
import { placePart, readPlacedParts } from "../src/design/document"
import { partShape } from "../src/design/library"
import type { PlacedPart } from "../src/design/model"
import { SceneStore } from "../src/viewport/scene-store"
import { ModelLoader } from "../src/viewport/models"
import { toWorldSnap } from "../src/design/snap"

const catalogId = "channel-1x2x1-aluminum"
const lengthMm = 127

function part(id: string, x: number): PlacedPart {
  return {
    id,
    catalogId,
    lengthMm,
    position: [x, 0, 0],
    rotation: [0, 0, 0, 1],
    color: "#ffffff",
  }
}

it("keeps the Snap Index correct when Parts are added, moved, and removed", () => {
  const color = new Color("#ffffff")
  const store = new SceneStore(
    new Scene(),
    {
      background: color,
      grid: color,
      gridMajor: color,
      accent: color,
      snap: color,
      highlight: color,
      foreground: color,
    },
    new ModelLoader(undefined, () => {}),
    () => {}
  )

  const first = part("first", 0)
  const second = part("second", 200)
  const firstShape = partShape(first)
  const secondShape = partShape(second)

  try {
    store.sync([first])
    expect(store.index.all()).toHaveLength(firstShape.snapPoints.length)

    store.sync([first, second])
    expect(store.index.all()).toHaveLength(
      firstShape.snapPoints.length + secondShape.snapPoints.length
    )
    expect(
      store.index.all().filter((snap) => snap.owner === "second")
    ).toHaveLength(secondShape.snapPoints.length)

    const moved = part("second", 350)
    store.sync([first, moved])
    const localSnap = secondShape.snapPoints[0]
    const expected = toWorldSnap(localSnap, moved)
    const indexed = store.index
      .all()
      .find((snap) => snap.owner === "second" && snap.snapId === localSnap.id)
    expect(indexed?.position.distanceTo(expected.position)).toBeLessThan(1e-6)
    expect(store.index.all()).toHaveLength(
      firstShape.snapPoints.length + secondShape.snapPoints.length
    )

    store.sync([moved])
    expect(store.index.all()).toHaveLength(secondShape.snapPoints.length)
    expect(store.index.all().every((snap) => snap.owner === "second")).toBe(
      true
    )

    const remote = new Y.Doc()
    const local = new Y.Doc()
    const shared = part("shared", 500)
    placePart(remote, shared, shared.id)
    local.on("update", () => store.sync(readPlacedParts(local).parts))
    Y.applyUpdate(local, Y.encodeStateAsUpdate(remote))

    const remotePart = remote.getMap<Y.Map<unknown>>("parts").get(shared.id)
    if (!remotePart) throw new Error("expected the shared Part")

    remotePart.set("lengthMm", 254)
    Y.applyUpdate(
      local,
      Y.encodeStateAsUpdate(remote, Y.encodeStateVector(local))
    )
    const lengthChanged = readPlacedParts(local).parts[0]
    const longerShape = partShape(lengthChanged)
    expect(store.shapeFor(shared.id)).toBe(longerShape)
    expect(
      store.index.all().filter((snap) => snap.owner === shared.id)
    ).toHaveLength(longerShape.snapPoints.length)

    remotePart.set("catalog", "angle-1x1-aluminum")
    Y.applyUpdate(
      local,
      Y.encodeStateAsUpdate(remote, Y.encodeStateVector(local))
    )
    const refChanged = readPlacedParts(local).parts[0]
    const angleShape = partShape(refChanged)
    expect(store.shapeFor(shared.id)).toBe(angleShape)
    const refIndexed = store.index
      .all()
      .filter((snap) => snap.owner === shared.id)
    expect(refIndexed).toHaveLength(angleShape.snapPoints.length)
    expect(new Set(refIndexed.map((snap) => snap.snapId))).toEqual(
      new Set(angleShape.snapPoints.map((snap) => snap.id))
    )
    remote.destroy()
    local.destroy()
  } finally {
    store.dispose()
  }
})
