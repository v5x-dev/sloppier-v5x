import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import {
  partsMap,
  placePart,
  readPlacedParts,
  removePart,
  setPose,
} from "../src/design/document"
import { IDENTITY } from "../src/design/model"

const PART = { catalogId: "screw-6-32-1-4", position: [1, 2, 3] as const, rotation: IDENTITY, color: "#7d8592" }

function exchange(a: Y.Doc, b: Y.Doc) {
  const fromA = Y.encodeStateAsUpdate(a)
  const fromB = Y.encodeStateAsUpdate(b)
  Y.applyUpdate(b, fromA)
  Y.applyUpdate(a, fromB)
}

describe("the Design document", () => {
  it("reads back what was placed", () => {
    const doc = new Y.Doc()
    const id = placePart(doc, { ...PART, position: [1, 2, 3] }, "part-1")
    expect(readPlacedParts(doc)).toEqual({
      parts: [{ id, catalogId: "screw-6-32-1-4", position: [1, 2, 3], rotation: IDENTITY, color: "#7d8592" }],
      invalid: [],
    })
  })

  it("keeps a Cut Part's length", () => {
    const doc = new Y.Doc()
    placePart(doc, { catalogId: "channel-1x2x1-aluminum", lengthMm: 444.5, position: [0, 0, 0], rotation: IDENTITY, color: "#b9c0cc" }, "c1")
    expect(readPlacedParts(doc).parts[0].lengthMm).toBe(444.5)
  })

  it("deletes a Part and ignores a move of a Part that is gone", () => {
    const doc = new Y.Doc()
    placePart(doc, PART, "gone")
    removePart(doc, "gone")
    expect(() => setPose(doc, "gone", [0, 0, 0], IDENTITY)).not.toThrow()
    expect(readPlacedParts(doc).parts).toEqual([])
  })

  it("lists an entry that does not read as invalid, not as a Part", () => {
    const doc = new Y.Doc()
    placePart(doc, PART, "good")
    partsMap(doc).set("bad", new Y.Map([["catalog", "screw-6-32-1-4"], ["position", "not a vector"]]))
    const { parts, invalid } = readPlacedParts(doc)
    expect(parts.map((p) => p.id)).toEqual(["good"])
    expect(invalid).toEqual(["bad"])
  })

  it("rejects a length that is not positive", () => {
    const doc = new Y.Doc()
    partsMap(doc).set("zero", new Y.Map([["catalog", "channel-1x2x1-aluminum"], ["position", [0, 0, 0]], ["rotation", [0, 0, 0, 1]], ["color", "#fff"], ["lengthMm", 0]]))
    expect(readPlacedParts(doc).invalid).toEqual(["zero"])
  })

  it("converges when two copies place Parts while apart", () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    placePart(a, PART, "from-a")
    placePart(b, { ...PART, position: [9, 9, 9] }, "from-b")
    exchange(a, b)
    expect(readPlacedParts(a)).toEqual(readPlacedParts(b))
    expect(readPlacedParts(a).parts.map((p) => p.id)).toEqual(["from-a", "from-b"])
  })

  it("keeps both moves when two people move different Parts at once", () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    placePart(a, PART, "p1")
    placePart(a, PART, "p2")
    exchange(a, b)
    setPose(a, "p1", [100, 0, 0], IDENTITY)
    setPose(b, "p2", [0, 0, 100], IDENTITY)
    exchange(a, b)
    const byId = Object.fromEntries(readPlacedParts(a).parts.map((p) => [p.id, p.position]))
    expect(byId).toEqual({ p1: [100, 0, 0], p2: [0, 0, 100] })
    expect(readPlacedParts(b)).toEqual(readPlacedParts(a))
  })

  it("keeps the last move of the same Part, and both copies agree", () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    placePart(a, PART, "p1")
    exchange(a, b)
    setPose(a, "p1", [10, 0, 0], IDENTITY)
    setPose(b, "p1", [0, 0, 20], IDENTITY)
    exchange(a, b)
    expect(readPlacedParts(a)).toEqual(readPlacedParts(b))
  })

  it("lets a delete beat a concurrent move", () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    placePart(a, PART, "p1")
    exchange(a, b)
    removePart(a, "p1")
    setPose(b, "p1", [5, 5, 5], IDENTITY)
    exchange(a, b)
    expect(readPlacedParts(a).parts).toEqual([])
    expect(readPlacedParts(b).parts).toEqual([])
  })
})
