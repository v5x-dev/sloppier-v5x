import { describe, expect, it } from "vitest"
import { SlotTable } from "../src/design/slots"

describe("SlotTable", () => {
  it("packs slots from zero and moves the last id into a gap", () => {
    const table = new SlotTable()
    expect([table.add("a"), table.add("b"), table.add("c")]).toEqual([0, 1, 2])
    expect(table.remove("a")).toEqual({ slot: 0, moved: { id: "c", slot: 0 } })
    expect(table.slotOf("c")).toBe(0)
    expect(table.idAt(1)).toBe("b")
    expect(table.count).toBe(2)
  })

  it("removing the last id moves nothing", () => {
    const table = new SlotTable()
    table.add("a")
    table.add("b")
    expect(table.remove("b")).toEqual({ slot: 1 })
    expect(table.count).toBe(1)
  })

  it("returns the existing slot when an id is added twice, and nothing for an unknown id", () => {
    const table = new SlotTable()
    expect(table.add("a")).toBe(0)
    expect(table.add("a")).toBe(0)
    expect(table.count).toBe(1)
    expect(table.remove("zzz")).toBeUndefined()
  })

  it("stays packed through a long run of adds and removes", () => {
    const table = new SlotTable()
    let seed = 3
    const next = () => (seed = (seed * 48271) % 2147483647)
    const live = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const id = `p${next() % 60}`
      if (live.has(id)) {
        table.remove(id)
        live.delete(id)
      } else {
        table.add(id)
        live.add(id)
      }
      expect(table.count).toBe(live.size)
      for (let slot = 0; slot < table.count; slot++) {
        expect(table.slotOf(table.idAt(slot)!)).toBe(slot)
      }
    }
  })
})
