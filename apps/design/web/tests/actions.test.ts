import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import {
  connectSelection,
  deleteSelection,
  disconnectSelection,
  duplicateSelection,
  moveBy,
  turnBy,
} from "../src/design/actions"
import {
  addConnections,
  placePart,
  readConnections,
  readPlacedParts,
} from "../src/design/document"
import { createHistory } from "../src/design/history"
import { IDENTITY } from "../src/design/model"

const CHANNEL = "channel-1x2x1-aluminum"
const SCREW = "screw-6-32-1-4"

function fixture() {
  const doc = new Y.Doc()
  placePart(
    doc,
    {
      catalogId: CHANNEL,
      lengthMm: 444.5,
      position: [0, 100, 0],
      rotation: IDENTITY,
      color: "#fff",
    },
    "a"
  )
  placePart(
    doc,
    {
      catalogId: CHANNEL,
      lengthMm: 444.5,
      position: [0, 100, 60],
      rotation: IDENTITY,
      color: "#fff",
    },
    "b"
  )
  placePart(
    doc,
    {
      catalogId: SCREW,
      position: [0, 100, 30],
      rotation: IDENTITY,
      color: "#fff",
    },
    "s"
  )
  addConnections(doc, [
    { fastener: "s", host: "a", hostSnap: "h", fastenerSnap: "pin-a" },
    { fastener: "s", host: "b", hostSnap: "h", fastenerSnap: "pin-b" },
  ])
  return doc
}

const at = (doc: Y.Doc, id: string) =>
  readPlacedParts(doc).parts.find((p) => p.id === id)!

describe("editor actions", () => {
  it("moves a selection's connected group by a typed offset, as one step", () => {
    const doc = fixture()
    const history = createHistory(doc)
    moveBy(doc, new Set(["a"]), [0, 0, 12.7])
    expect(at(doc, "b").position[2]).toBeCloseTo(72.7, 6)
    expect(at(doc, "s").position[2]).toBeCloseTo(42.7, 6)
    history.undo()
    expect(at(doc, "b").position[2]).toBe(60)
  })

  it("moves a Part alone and breaks its Connections when alone is set", () => {
    const doc = fixture()
    moveBy(doc, new Set(["a"]), [0, 0, 5], true)
    expect(readConnections(doc).map((c) => c.host)).toEqual(["b"])
  })

  it("turns a Part about a screw without moving the Part on the far side", () => {
    const doc = fixture()
    const bBefore = at(doc, "b").position
    turnBy(doc, new Set(["a"]), {
      angle: Math.PI / 2,
      axis: [0, 1, 0],
      pivotFastener: "s",
    })
    expect(at(doc, "b").position).toEqual(bBefore)
  })

  it("turns the selection about its own centre, even when that takes it under the ground", () => {
    const doc = fixture()
    const before = at(doc, "a").rotation
    turnBy(doc, new Set(["a"]), { angle: Math.PI / 2, axis: [1, 0, 0] })
    expect(at(doc, "a").rotation).not.toEqual(before)
  })

  it("connects a selected screw to the channels it passes through, and disconnects it", () => {
    const doc = new Y.Doc()
    placePart(
      doc,
      {
        catalogId: CHANNEL,
        lengthMm: 444.5,
        position: [0, 100, 0],
        rotation: IDENTITY,
        color: "#fff",
      },
      "a"
    )
    placePart(
      doc,
      {
        catalogId: SCREW,
        position: [0, 100, 0],
        rotation: IDENTITY,
        color: "#fff",
      },
      "s"
    )
    expect(connectSelection(doc, new Set(["s"]))).toBe(0)
    disconnectSelection(doc, new Set(["a"]))
    expect(readConnections(doc)).toEqual([])
  })

  it("duplicates a selection with its internal Connections and new ids", () => {
    const doc = fixture()
    const copies = duplicateSelection(doc, new Set(["a", "s", "b"]))
    expect(copies).toHaveLength(3)
    expect(copies.some((id) => ["a", "s", "b"].includes(id))).toBe(false)
    expect(readConnections(doc)).toHaveLength(4)
  })

  it("deletes a selection and every Connection to it, as one step", () => {
    const doc = fixture()
    const history = createHistory(doc)
    deleteSelection(doc, new Set(["s"]))
    expect(readConnections(doc)).toEqual([])
    history.undo()
    expect(readConnections(doc)).toHaveLength(2)
  })
})
