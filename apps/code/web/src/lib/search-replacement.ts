import type { SearchMatch } from "@v5x/backend/search"

export type ReplacementAction = (
  matches: SearchMatch[],
  replacement: string
) => void

/** Recheck every displayed match against the live document before editing it. */
export function replacementEdits(
  text: string,
  matches: SearchMatch[],
  replacement: string
) {
  const lines = text.split("\n")
  return matches.map((match) => {
    const line = match.line > 0 ? lines.at(match.line - 1) : undefined
    const expected = match.text.slice(match.start, match.end)
    const character = match.column - 1
    if (
      line === undefined ||
      character < 0 ||
      line.slice(character, character + expected.length) !== expected
    )
      throw new Error(
        "A search result changed. Search again before replacing it."
      )
    const start = Math.max(0, character - 60)
    const end = Math.min(line.length, character + expected.length + 100)
    const preview =
      (start ? "…" : "") +
      line.slice(start, end).replace(/\r$/, "") +
      (end < line.length ? "…" : "")
    if (!expected || preview !== match.text)
      throw new Error(
        "A search result changed. Search again before replacing it."
      )
    return {
      range: {
        start: { line: match.line - 1, character },
        end: { line: match.line - 1, character: character + expected.length },
      },
      newText: replacement,
    }
  })
}
