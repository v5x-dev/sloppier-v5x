import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { partById } from "@/catalog/catalog"
import {
  applyDesignFile,
  designFileFrom,
  designFileOf,
  designFileText,
  parseDesignFile,
  MAX_FILE_PARTS,
} from "@/design/design-file"
import {
  addConnections,
  placePart,
  readConnections,
  readPlacedParts,
} from "@/design/document"
import { generateCutPart } from "@/catalog/cut-part"

const CHANNEL = "channel-1x2x1-steel"
const SCREW = "screw-8-32-1"
const PLATE = "plate-5x15-steel"
const MOTOR = "motor-v5-smart-11w"

function snapOf(catalogId: string): string {
  const part = partById(catalogId)
  if (part.kind !== "model") throw new Error("expected a fixed Part")
  return part.snapPoints[0].id
}

/** A Design with a channel, a plate, a screw joining them, and a motor. */
function sampleDoc(): Y.Doc {
  const doc = new Y.Doc()
  const plate = placePart(
    doc,
    {
      catalogId: PLATE,
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      color: "#7f8691",
    },
    "plate-1"
  )
  const screw = placePart(
    doc,
    {
      catalogId: SCREW,
      position: [0, 10, 0],
      rotation: [0, 0, 0, 1],
      color: "#c4cad3",
    },
    "screw-1"
  )
  placePart(
    doc,
    {
      catalogId: CHANNEL,
      lengthMm: 127,
      position: [40, 0, 0],
      rotation: [0, 0, 0, 1],
      color: "#7f8691",
    },
    "channel-1"
  )
  placePart(
    doc,
    {
      catalogId: MOTOR,
      position: [80, 0, 0],
      rotation: [0, 0, 0, 1],
      color: "#2d3138",
    },
    "motor-1"
  )
  addConnections(doc, [
    {
      fastener: screw,
      host: plate,
      fastenerSnap: snapOf(SCREW),
      hostSnap: snapOf(PLATE),
    },
  ])
  return doc
}

function fileFor(mutate: (file: Record<string, unknown>) => void): string {
  const base = designFileOf(sampleDoc(), "Base")
  const copy = JSON.parse(JSON.stringify(base)) as Record<string, unknown>
  mutate(copy)
  return JSON.stringify(copy)
}

function firstProblems(text: string): string[] {
  const result = parseDesignFile(text)
  if (result.ok) throw new Error("expected the file to be refused")
  return result.problems
}

describe("exporting", () => {
  it("writes the format, version, and units at the top, with the Design's name", () => {
    const file = designFileOf(sampleDoc(), "  Drive base\n")
    expect(file.format).toBe("v5x-design")
    expect(file.version).toBe(1)
    expect(file.units).toBe("mm")
    expect(file.name).toBe("Drive base")
  })

  it("names a Design with no name", () => {
    expect(designFileFrom("   ", [], []).name).toBe("Design")
  })

  it("is the same text for the same Design, so two exports can be compared", () => {
    const doc = sampleDoc()
    expect(designFileText(designFileOf(doc, "A"))).toBe(
      designFileText(designFileOf(doc, "A"))
    )
  })
})

describe("round trip", () => {
  it("reads back to the same Parts and Connections it was exported from", () => {
    const original = sampleDoc()
    const text = designFileText(designFileOf(original, "Round trip"))
    const parsed = parseDesignFile(text)
    if (!parsed.ok) throw new Error(parsed.problems.join("; "))
    expect(parsed.design.name).toBe("Round trip")

    const copy = new Y.Doc()
    expect(applyDesignFile(copy, parsed.design)).toBe(true)
    expect(readPlacedParts(copy).parts).toEqual(readPlacedParts(original).parts)
    expect(readConnections(copy)).toEqual(readConnections(original))
  })

  it("exports again to the same text after importing", () => {
    const original = sampleDoc()
    const text = designFileText(designFileOf(original, "Again"))
    const parsed = parseDesignFile(text)
    if (!parsed.ok) throw new Error(parsed.problems.join("; "))
    const copy = new Y.Doc()
    applyDesignFile(copy, parsed.design)
    expect(designFileText(designFileOf(copy, "Again"))).toBe(text)
  })

  it("refuses to write into a Design that already has Parts", () => {
    const parsed = parseDesignFile(
      designFileText(designFileOf(sampleDoc(), "x"))
    )
    if (!parsed.ok) throw new Error("setup failed")
    expect(applyDesignFile(sampleDoc(), parsed.design)).toBe(false)
  })

  it("keeps the import as one undo step", () => {
    const parsed = parseDesignFile(
      designFileText(designFileOf(sampleDoc(), "x"))
    )
    if (!parsed.ok) throw new Error("setup failed")
    const doc = new Y.Doc()
    let steps = 0
    doc.on("afterTransaction", () => steps++)
    applyDesignFile(doc, parsed.design)
    expect(steps).toBe(1)
  })

  it("keeps a Connection's screw and host on the Parts it names", () => {
    const parsed = parseDesignFile(
      designFileText(designFileOf(sampleDoc(), "x"))
    )
    if (!parsed.ok) throw new Error("setup failed")
    const [link] = parsed.design.connections
    expect(link.fastener).toBe("screw-1")
    expect(link.host).toBe("plate-1")
  })
})

describe("rejecting a bad file", () => {
  it.each<[string, string, RegExp]>([
    ["text that is not JSON", "{not json", /not valid JSON/],
    ["JSON that is not a Design", "[1,2]", /does not hold a Design/],
    [
      "a file from another format",
      JSON.stringify({ format: "other", version: 1 }),
      /not a v5x Design file/,
    ],
    [
      "a newer version",
      JSON.stringify({ format: "v5x-design", version: 2 }),
      /version 2/,
    ],
    [
      "inches",
      JSON.stringify({
        format: "v5x-design",
        version: 1,
        units: "in",
        parts: [],
        connections: [],
      }),
      /millimetres/,
    ],
  ])("refuses %s", (_name, text, message) => {
    const problems = firstProblems(text)
    expect(problems.join(" ")).toMatch(message)
  })

  it("refuses a Part from a catalog this app does not have", () => {
    const text = fileFor((f) => {
      ;(f.parts as Record<string, unknown>[])[0].catalog =
        "motor-from-the-future"
    })
    expect(firstProblems(text).join(" ")).toMatch(
      /not a Part in this app's catalog/
    )
  })

  it("refuses a Cut Part with no length, and a fixed Part with one", () => {
    const noLength = fileFor((f) => {
      const cut = (f.parts as Record<string, unknown>[]).find(
        (p) => p.catalog === CHANNEL
      )
      delete cut?.lengthMm
    })
    expect(firstProblems(noLength).join(" ")).toMatch(/length does not fit/)
    const fixedWithLength = fileFor((f) => {
      ;(f.parts as Record<string, unknown>[]).find(
        (p) => p.catalog === MOTOR
      )!.lengthMm = 100
    })
    expect(firstProblems(fixedWithLength).join(" ")).toMatch(
      /only a Cut Part has a length/
    )
  })

  it("refuses a channel length that is not a whole number of holes", () => {
    const text = fileFor((f) => {
      ;(f.parts as Record<string, unknown>[]).find(
        (p) => p.catalog === CHANNEL
      )!.lengthMm = 100
    })
    expect(firstProblems(text).join(" ")).toMatch(/length does not fit/)
  })

  it("refuses bad positions, rotations, and colours", () => {
    const text = fileFor((f) => {
      const parts = f.parts as Record<string, unknown>[]
      parts[0].position = [0, 0]
      parts[1].rotation = [0, 0, 0, 2]
      parts[2].color = "red"
    })
    const problems = firstProblems(text).join(" ")
    expect(problems).toMatch(/position/)
    expect(problems).toMatch(/rotation/)
    expect(problems).toMatch(/colour/)
  })

  it("refuses a Part id that is used twice, and an id with odd characters", () => {
    const twice = fileFor((f) => {
      const parts = f.parts as Record<string, unknown>[]
      parts[1].id = parts[0].id
    })
    expect(firstProblems(twice).join(" ")).toMatch(/used twice/)
    const odd = fileFor((f) => {
      ;(f.parts as Record<string, unknown>[])[0].id = "../../etc"
    })
    expect(firstProblems(odd).join(" ")).toMatch(/1 to 64 letters/)
  })

  it("refuses a Connection to a Part that is not in the file", () => {
    const text = fileFor((f) => {
      ;(f.connections as Record<string, unknown>[])[0].host = "gone"
    })
    expect(firstProblems(text).join(" ")).toMatch(/not in this file/)
  })

  it("refuses a Snap Point that the Part does not have", () => {
    const text = fileFor((f) => {
      ;(f.connections as Record<string, unknown>[])[0].hostSnap =
        "hole-that-is-not-there"
    })
    expect(firstProblems(text).join(" ")).toMatch(
      /Snap Point on the host Part does not exist/
    )
  })

  it("refuses a shaft that names a Snap Point on itself", () => {
    const channel = partById(CHANNEL)
    if (channel.kind !== "cut") throw new Error("expected a Cut Part")
    const hostSnap = generateCutPart(channel, 127).snapPoints[0].id
    const text = fileFor((f) => {
      const parts = f.parts as Record<string, unknown>[]
      parts.push({
        id: "shaft-1",
        catalog: "shaft-square-1-4",
        lengthMm: 200,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        color: "#7f8691",
      })
      ;(f.connections as Record<string, unknown>[]).push({
        id: "link-shaft",
        fastener: "shaft-1",
        host: "channel-1",
        hostSnap,
        fastenerSnap: "anything",
      })
    })
    expect(firstProblems(text).join(" ")).toMatch(
      /shaft does not name a Snap Point/
    )
  })

  it("refuses a file with too many Parts", () => {
    const parts = Array.from({ length: MAX_FILE_PARTS + 1 }, (_, i) => ({
      id: `p${i}`,
    }))
    expect(
      firstProblems(
        JSON.stringify({
          format: "v5x-design",
          version: 1,
          units: "mm",
          parts,
          connections: [],
        })
      ).join(" ")
    ).toMatch(/at most/)
  })

  it("reports each problem, not just the first", () => {
    const text = fileFor((f) => {
      const parts = f.parts as Record<string, unknown>[]
      parts[0].color = "x"
      parts[1].position = "nope"
    })
    expect(firstProblems(text).length).toBeGreaterThanOrEqual(2)
  })
})

describe("name", () => {
  it("is trimmed to one line and a sensible length, and defaults when missing", () => {
    const base = designFileOf(sampleDoc(), "x")
    const named = parseDesignFile(
      JSON.stringify({ ...base, name: "A\nB" + "c".repeat(200) })
    )
    if (!named.ok) throw new Error(named.problems.join(" "))
    expect(named.design.name.startsWith("A B")).toBe(true)
    expect(named.design.name.length).toBeLessThanOrEqual(120)
    const unnamed = parseDesignFile(
      JSON.stringify({ ...base, name: undefined })
    )
    if (!unnamed.ok) throw new Error(unnamed.problems.join(" "))
    expect(unnamed.design.name).toBe("Imported Design")
  })
})
