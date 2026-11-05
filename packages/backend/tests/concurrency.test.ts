import { describe, expect, test, vi } from "vitest"
import { mapWithConcurrency } from "../convex/lib/concurrency"

// A call waits on a gate the test opens, so completion order comes from the test rather than timer lengths.
function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

describe("mapWithConcurrency", () => {
  test("keeps input order while capping calls in flight", async () => {
    const gates = [gate(), gate(), gate(), gate(), gate()]
    let inFlight = 0
    let peak = 0
    const results = mapWithConcurrency(
      ["a", "b", "c", "d", "e"],
      2,
      async (_, index) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await gates[index].opened
        inFlight--
        return `${index}`
      }
    )
    // Calls finish out of order; the results still follow the input order.
    for (const index of [1, 0, 2, 4, 3]) gates[index].open()
    await expect(results).resolves.toEqual(["0", "1", "2", "3", "4"])
    expect(peak).toBe(2)
  })

  test("a finished slot starts the next item without waiting for the batch", async () => {
    const started: number[] = []
    const finished: number[] = []
    const slow = gate()
    const run = mapWithConcurrency([0, 1, 2, 3], 2, async (_, index) => {
      started.push(index)
      if (index === 0) await slow.opened
      finished.push(index)
    })
    // Items 1-3 complete while item 0 is still held, so item 2 and item 3 used the freed slot.
    await vi.waitFor(() => expect(finished).toEqual([1, 2, 3]))
    expect(started).toEqual([0, 1, 2, 3])
    slow.open()
    await run
    expect(finished).toEqual([1, 2, 3, 0])
  })

  test("returns an empty list without calling the mapper", async () => {
    await expect(
      mapWithConcurrency([], 4, async () => {
        throw new Error("unreachable")
      })
    ).resolves.toEqual([])
  })

  test("rejects with the first failure and starts no new items", async () => {
    const started: number[] = []
    const held = gate()
    await expect(
      mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (_, index) => {
        started.push(index)
        if (index === 0) throw new Error("boom")
        await held.opened
      })
    ).rejects.toThrow("boom")
    // Only the two items already in flight started before the failure stopped the pool.
    expect(started).toEqual([0, 1])
    held.open()
  })

  test("rejects invalid concurrency limits", async () => {
    await expect(mapWithConcurrency([1], 0, async (n) => n)).rejects.toThrow(
      RangeError
    )
    await expect(mapWithConcurrency([1], 1.5, async (n) => n)).rejects.toThrow(
      RangeError
    )
  })
})
