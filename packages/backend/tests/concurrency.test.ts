import { describe, expect, test } from "vitest"
import { mapWithConcurrency } from "../convex/lib/concurrency"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("mapWithConcurrency", () => {
  test("keeps input order while capping calls in flight", async () => {
    let inFlight = 0
    let peak = 0
    const results = await mapWithConcurrency(
      [30, 5, 20, 1, 10],
      2,
      async (delay, index) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await wait(delay)
        inFlight--
        return `${index}:${delay}`
      }
    )
    expect(results).toEqual(["0:30", "1:5", "2:20", "3:1", "4:10"])
    expect(peak).toBe(2)
  })

  test("a finished slot starts the next item without waiting for the batch", async () => {
    const started: number[] = []
    const finished: number[] = []
    await mapWithConcurrency([50, 1, 1, 1], 2, async (delay, index) => {
      started.push(index)
      await wait(delay)
      finished.push(index)
    })
    // Item 2 starts as soon as item 1 finishes, while item 0 is still running.
    expect(started).toEqual([0, 1, 2, 3])
    expect(finished.indexOf(0)).toBeGreaterThan(finished.indexOf(2))
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
    await expect(
      mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (_, index) => {
        started.push(index)
        await wait(index === 0 ? 1 : 10)
        if (index === 0) throw new Error("boom")
      })
    ).rejects.toThrow("boom")
    // Only the two items already in flight started before the failure stopped the pool.
    expect(started).toEqual([0, 1])
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
