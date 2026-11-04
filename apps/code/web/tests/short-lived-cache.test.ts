import { describe, expect, it } from "vitest"
import { createShortLivedCache } from "../src/lib/short-lived-cache"

describe("short-lived cache", () => {
  it("keeps one fresh value per key until it is taken", () => {
    const cache = createShortLivedCache<string>(1000, () => 0)
    cache.put("a", () => "first")
    cache.put("a", () => "second")
    expect(cache.take("a")).toBe("first")
    expect(cache.take("a")).toBeUndefined()
  })

  it("drops values that were never taken after the time to live", () => {
    let now = 0
    const cache = createShortLivedCache<string>(1000, () => now)
    cache.put("a", () => "stale")
    now = 1000
    expect(cache.take("a")).toBeUndefined()
    cache.put("a", () => "fresh")
    now = 1999
    expect(cache.take("a")).toBe("fresh")
  })
})
