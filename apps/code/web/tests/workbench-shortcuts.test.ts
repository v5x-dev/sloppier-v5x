import { describe, expect, it } from "vitest"
import {
  adjacentTab,
  parseLineNumber,
} from "../src/components/program/workbench-shortcuts"

describe("parseLineNumber", () => {
  it("accepts whole one-based line numbers", () => {
    expect(parseLineNumber("1")).toBe(1)
    expect(parseLineNumber(" 42 ")).toBe(42)
  })

  it("rejects zero, negative, fractional, and non-numeric input", () => {
    expect(parseLineNumber("")).toBeNull()
    expect(parseLineNumber("0")).toBeNull()
    expect(parseLineNumber("-3")).toBeNull()
    expect(parseLineNumber("2.5")).toBeNull()
    expect(parseLineNumber("main")).toBeNull()
  })
})

describe("adjacentTab", () => {
  const paths = ["a.cpp", "b.cpp", "c.cpp"]

  it("moves to the neighboring tab in both directions", () => {
    expect(adjacentTab(paths, "b.cpp", 1)).toBe("c.cpp")
    expect(adjacentTab(paths, "b.cpp", -1)).toBe("a.cpp")
  })

  it("wraps at either end of the group", () => {
    expect(adjacentTab(paths, "c.cpp", 1)).toBe("a.cpp")
    expect(adjacentTab(paths, "a.cpp", -1)).toBe("c.cpp")
  })

  it("returns null when there is no other tab to switch to", () => {
    expect(adjacentTab(["a.cpp"], "a.cpp", 1)).toBeNull()
    expect(adjacentTab([], null, 1)).toBeNull()
  })

  it("starts from the first tab when no tab is active", () => {
    expect(adjacentTab(paths, null, 1)).toBe("a.cpp")
  })
})
