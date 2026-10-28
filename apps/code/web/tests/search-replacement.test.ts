import { describe, expect, test } from "vitest"
import { searchText } from "@workspace/backend/search"
import { replacementEdits } from "../src/lib/search-replacement"

describe("search replacement", () => {
  test("replaces selected matches with UTF-16 positions and literal text", () => {
    const text = "🤖 motor motor\nother motor"
    const matches = searchText(text, "motor")
    expect(replacementEdits(text, [matches[0], matches[2]], "$&")).toEqual([
      {
        range: {
          start: { line: 0, character: 3 },
          end: { line: 0, character: 8 },
        },
        newText: "$&",
      },
      {
        range: {
          start: { line: 1, character: 6 },
          end: { line: 1, character: 11 },
        },
        newText: "$&",
      },
    ])
  })

  test("rejects stale matches before creating any edits", () => {
    const matches = searchText("motor motor", "motor")
    expect(() => replacementEdits("motor other", matches, "wheel")).toThrow(
      "changed"
    )
    expect(() =>
      replacementEdits("motor motors", [matches[0]], "wheel")
    ).toThrow("changed")
  })

  test("allows deletion and matches in CRLF files", () => {
    const text = "motor\r\nnext"
    expect(
      replacementEdits(text, searchText(text, "motor"), "")[0].newText
    ).toBe("")
  })
})
