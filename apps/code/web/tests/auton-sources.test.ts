import { describe, expect, it } from "vitest"
import { readAutonSources } from "../src/lib/auton-sources"

const bytes = (text: string) => new TextEncoder().encode(text).buffer

describe("auton preview source reads", () => {
  it("overlaps reads, keeps path order, and decodes each file", async () => {
    const paths = [
      "src/a.cpp",
      "src/b.cpp",
      "src/c.cpp",
      "src/d.cpp",
      "src/e.cpp",
    ]
    let inFlight = 0
    let maxInFlight = 0
    const sources = await readAutonSources(paths, async (path) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight--
      return { bytes: bytes(`// ${path}`), contentRange: null }
    })
    expect([...sources.keys()]).toEqual(paths)
    expect(sources.get("src/c.cpp")).toBe("// src/c.cpp")
    expect(maxInFlight).toBeGreaterThan(1)
  })

  it("rejects a file whose range does not cover the whole file", async () => {
    await expect(
      readAutonSources(["src/big.cpp"], async () => ({
        bytes: bytes("x"),
        contentRange: "bytes 0-0/10",
      }))
    ).rejects.toThrow("src/big.cpp is too large to preview completely.")
  })
})
