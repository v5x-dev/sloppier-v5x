import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { createHistory } from "../src/design/history"
import {
  placePart,
  readConnections,
  readPlacedParts,
  removeParts,
  setPoses,
} from "../src/design/document"
import { IDENTITY } from "../src/design/model"

const PART = {
  catalogId: "screw-6-32-1-4",
  position: [0, 0, 0] as const,
  rotation: IDENTITY,
  color: "#7d8592",
}

/** Carries what each copy has made to the other, as the server would. */
function exchange(a: Y.Doc, b: Y.Doc) {
  const fromA = Y.encodeStateAsUpdate(a)
  const fromB = Y.encodeStateAsUpdate(b)
  Y.applyUpdate(b, fromA)
  Y.applyUpdate(a, fromB)
}

const positionOf = (doc: Y.Doc, id: string) =>
  readPlacedParts(doc).parts.find((p) => p.id === id)?.position

describe("undo for one person", () => {
  it("reverses this person's last move and redoes it", () => {
    const doc = new Y.Doc()
    placePart(doc, PART, "p")
    const history = createHistory(doc)
    setPoses(doc, [{ id: "p", position: [10, 0, 0], rotation: IDENTITY }])
    expect(positionOf(doc, "p")).toEqual([10, 0, 0])
    history.undo()
    expect(positionOf(doc, "p")).toEqual([0, 0, 0])
    history.redo()
    expect(positionOf(doc, "p")).toEqual([10, 0, 0])
  })

  it("makes a multi-part move one step", () => {
    const doc = new Y.Doc()
    placePart(doc, PART, "a")
    placePart(doc, PART, "b")
    const history = createHistory(doc)
    setPoses(doc, [
      { id: "a", position: [5, 0, 0], rotation: IDENTITY },
      { id: "b", position: [5, 0, 5], rotation: IDENTITY },
    ])
    history.undo()
    expect(positionOf(doc, "a")).toEqual([0, 0, 0])
    expect(positionOf(doc, "b")).toEqual([0, 0, 0])
    expect(history.canUndo()).toBe(false)
  })

  it("keeps two back-to-back moves as two steps", () => {
    const doc = new Y.Doc()
    placePart(doc, PART, "p")
    const history = createHistory(doc)
    setPoses(doc, [{ id: "p", position: [1, 0, 0], rotation: IDENTITY }])
    setPoses(doc, [{ id: "p", position: [2, 0, 0], rotation: IDENTITY }])
    history.undo()
    expect(positionOf(doc, "p")).toEqual([1, 0, 0])
  })

  it("never reverses a change that came from someone else", () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    placePart(a, PART, "p")
    exchange(a, b)
    const history = createHistory(a)
    // Someone else moves the Part. This person has made no change.
    setPoses(b, [{ id: "p", position: [40, 0, 0], rotation: IDENTITY }])
    exchange(a, b)
    expect(history.canUndo()).toBe(false)
    expect(positionOf(a, "p")).toEqual([40, 0, 0])
  })

  it("leaves a later remote move in place when this person undoes an earlier one", () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    placePart(a, PART, "p")
    exchange(a, b)
    const history = createHistory(a)
    setPoses(a, [{ id: "p", position: [10, 0, 0], rotation: IDENTITY }])
    exchange(a, b)
    // The other person has seen the move, then moves the Part again.
    setPoses(b, [{ id: "p", position: [0, 0, 30], rotation: IDENTITY }])
    exchange(a, b)
    history.undo()
    expect(positionOf(a, "p")).toEqual([0, 0, 30])
    expect(positionOf(b, "p")).toEqual([0, 0, 30])
  })

  it("never leaves a Part half-written when a concurrent move meets an undo", () => {
    for (let round = 0; round < 20; round++) {
      // Client IDs are random, so repeat: either copy may win the concurrent write.
      const a = new Y.Doc()
      const b = new Y.Doc()
      placePart(a, PART, "p")
      exchange(a, b)
      const history = createHistory(a)
      setPoses(a, [{ id: "p", position: [10, 0, 0], rotation: IDENTITY }])
      setPoses(b, [{ id: "p", position: [0, 0, 30], rotation: IDENTITY }])
      exchange(a, b)
      history.undo()
      exchange(a, b)
      const read = readPlacedParts(a)
      expect(read.invalid).toEqual([])
      expect(read.parts.map((p) => p.id)).toEqual(["p"])
      expect(readPlacedParts(b)).toEqual(read)
    }
  })

  it("does not redo over a change someone else made after the undo", () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    placePart(a, PART, "p")
    exchange(a, b)
    const history = createHistory(a)
    setPoses(a, [{ id: "p", position: [10, 0, 0], rotation: IDENTITY }])
    history.undo()
    exchange(a, b)
    setPoses(b, [{ id: "p", position: [0, 0, 30], rotation: IDENTITY }])
    exchange(a, b)
    history.redo()
    expect(positionOf(a, "p")).toEqual([0, 0, 30])
  })

  it("redoes this person's own step when nothing has changed since", () => {
    const doc = new Y.Doc()
    placePart(doc, PART, "p")
    const history = createHistory(doc)
    setPoses(doc, [{ id: "p", position: [10, 0, 0], rotation: IDENTITY }])
    history.undo()
    history.redo()
    expect(positionOf(doc, "p")).toEqual([10, 0, 0])
  })

  it("restores a deleted Part with its Connections", () => {
    const doc = new Y.Doc()
    placePart(doc, PART, "screw")
    placePart(
      doc,
      { ...PART, catalogId: "channel-1x2x1-aluminum", lengthMm: 444.5 },
      "channel",
      [
        {
          fastener: "screw",
          host: "channel",
          hostSnap: "hole-1",
          fastenerSnap: "pin-a",
        },
      ]
    )
    const history = createHistory(doc)
    removeParts(doc, ["screw"])
    expect(readConnections(doc)).toEqual([])
    history.undo()
    expect(
      readPlacedParts(doc)
        .parts.map((p) => p.id)
        .sort()
    ).toEqual(["channel", "screw"])
    expect(readConnections(doc).map((c) => [c.fastener, c.host])).toEqual([
      ["screw", "channel"],
    ])
  })
})

describe("the Connection schema", () => {
  it("stores a Connection and reads it back, whether or not it has a fastener snap", () => {
    const doc = new Y.Doc()
    placePart(doc, PART, "screw")
    placePart(doc, PART, "channel", [
      {
        fastener: "screw",
        host: "channel",
        hostSnap: "hole-1",
        fastenerSnap: "pin-a",
      },
      { fastener: "screw", host: "channel", hostSnap: "hole-2" },
    ])
    const read = readConnections(doc)
    expect(read).toHaveLength(2)
    expect(read.map((c) => c.fastenerSnap ?? null).sort()).toEqual([
      null,
      "pin-a",
    ])
  })

  it("ignores a Connection whose Part is gone", () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    placePart(a, PART, "screw")
    placePart(a, PART, "channel")
    exchange(a, b)
    // One person joins the screw to the channel while the other deletes the screw.
    placePart(a, PART, "extra", [
      { fastener: "screw", host: "extra", hostSnap: "hole-1" },
    ])
    removeParts(b, ["screw"])
    exchange(a, b)
    expect(readConnections(a)).toEqual([])
    expect(readConnections(b)).toEqual([])
    expect(
      readPlacedParts(a)
        .parts.map((p) => p.id)
        .sort()
    ).toEqual(["channel", "extra"])
  })

  it("converges when two people add Connections to the same Parts at once", () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    placePart(a, PART, "screw")
    placePart(a, PART, "channel")
    exchange(a, b)
    const join = {
      fastener: "screw",
      host: "channel",
      hostSnap: "hole-1",
      fastenerSnap: "pin-a",
    }
    placePart(a, PART, "by-a", [join])
    placePart(b, PART, "by-b", [
      { ...join, hostSnap: "hole-2", fastenerSnap: "pin-b" },
    ])
    exchange(a, b)
    const fromA = readConnections(a)
    expect(fromA).toHaveLength(2)
    expect(readConnections(b)).toEqual(fromA)
  })
})
