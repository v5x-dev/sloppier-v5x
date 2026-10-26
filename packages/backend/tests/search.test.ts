import { expect, it } from "vitest"
import {
  overlaySearch,
  searchText,
  SEARCH_LIMIT,
} from "../convex/lib/programSearch"
it("searches literals with case and exact Unicode/CRLF columns", () => {
  expect(searchText("A.* a.* axx", "a.*").map((m) => m.column)).toEqual([1, 5])
  expect(searchText("A.* a.*", "a.*", true).map((m) => m.column)).toEqual([5])
  expect(
    searchText("😀 hit hit\r\nsecond hit", "hit").map((m) => [m.line, m.column])
  ).toEqual([
    [1, 4],
    [1, 8],
    [2, 8],
  ])
})
it("clips snippets while preserving highlights", () => {
  const [m] = searchText("a".repeat(200) + "needle" + "b".repeat(200), "needle")
  expect(m.column).toBe(201)
  expect(m.text.slice(m.start, m.end)).toBe("needle")
  expect(m.text.length).toBeLessThan(170)
})
it("overlays drafts and removes stale saved matches", () => {
  const result = overlaySearch(
    [{ path: "a.cpp", matches: searchText("needle", "needle") }],
    new Map([
      ["a.cpp", "gone"],
      ["b.cpp", "new needle"],
      [".v5x/internal", "needle"],
    ]),
    "needle",
    false
  )
  expect(result.files.map((f) => f.path)).toEqual(["b.cpp"])
})
it("sorts and caps matches, rejecting binary and multiline searches", () => {
  const result = overlaySearch(
    [],
    new Map([
      ["z", "x ".repeat(SEARCH_LIMIT + 1)],
      ["a", "x"],
    ]),
    "x",
    false
  )
  expect(result.files[0].path).toBe("a")
  expect(result.files.reduce((n, f) => n + f.matches.length, 0)).toBe(
    SEARCH_LIMIT
  )
  expect(result.truncated).toBe(true)
  expect(searchText("hello\0", "hello")).toEqual([])
  expect(searchText("hello", "")).toEqual([])
  expect(searchText("a\nb", "a\nb")).toEqual([])
})
it("combines repository chunks belonging to the same file", () => {
  const result = overlaySearch(
    [
      { path: "a", matches: searchText("x", "x") },
      { path: "a", matches: searchText("x x", "x") },
    ],
    new Map(),
    "x",
    false
  )
  expect(result.files[0].matches).toHaveLength(3)
})
it("filters directories, basenames and globs without treating regex characters as syntax", async () => {
  const { matchesSearchPath } = await import("../convex/lib/programSearch")
  expect(matchesSearchPath("src/main.cpp", { pathFilter: "src/" })).toBe(true)
  expect(matchesSearchPath("src-old/main.cpp", { pathFilter: "src/" })).toBe(
    false
  )
  expect(matchesSearchPath("main.cpp", { pathFilter: "*.cpp" })).toBe(true)
  expect(matchesSearchPath("src/main.cpp", { pathFilter: "*.cpp" })).toBe(true)
  expect(matchesSearchPath("include/main.h", { pathFilter: "*.cpp" })).toBe(
    false
  )
  expect(
    matchesSearchPath("src/nested/main.cpp", { pathFilter: "src/*.cpp" })
  ).toBe(false)
  expect(
    matchesSearchPath("src/nested/main.cpp", { pathFilter: "src/**/*.cpp" })
  ).toBe(true)
  expect(
    matchesSearchPath("src/a[1].cpp", { pathFilter: "src/a[1].cpp" })
  ).toBe(true)
  expect(matchesSearchPath("src/a1.cpp", { pathFilter: "src/a[1].cpp" })).toBe(
    false
  )
})
it("excludes bundled libraries in source scope and intersects path filters before capping", () => {
  const files = [
    {
      path: "include/pros/api.h",
      matches: searchText("x ".repeat(301), "x", false, 301),
    },
    { path: "README.md", matches: searchText("x", "x") },
    { path: "src/main.cpp", matches: searchText("x", "x") },
    { path: "include/main.h", matches: searchText("x", "x") },
  ]
  expect(
    overlaySearch(files, new Map(), "x", false, { sourceOnly: true }).files.map(
      (f) => f.path
    )
  ).toEqual(["include/main.h", "src/main.cpp"])
  const result = overlaySearch(
    files,
    new Map([
      ["src/draft.cpp", "x"],
      ["src/ignored.h", "x"],
    ]),
    "x",
    false,
    { sourceOnly: true, pathFilter: "*.cpp" }
  )
  expect(result.files.map((f) => f.path)).toEqual([
    "src/draft.cpp",
    "src/main.cpp",
  ])
  expect(result.truncated).toBe(false)
})
