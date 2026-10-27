import type { CompletionItem } from "./language-service"

// Editor-independent completion rules, following VS Code's defaults.

export const isWordChar = (char: string) => /[A-Za-z0-9_]/.test(char)

export function wordStartAt(text: string, offset: number) {
  let start = offset
  while (start > 0 && isWordChar(text[start - 1])) start--
  return start
}

/** Quick suggestions stay off in comments and strings, like VS Code. */
export function inCommentOrString(text: string, offset: number) {
  if (text.lastIndexOf("/*", offset - 2) > text.lastIndexOf("*/", offset - 2))
    return true
  const line = text.slice(text.lastIndexOf("\n", offset - 1) + 1, offset)
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quote) {
      if (char === "\\") i++
      else if (char === quote) quote = null
    } else if (char === '"' || char === "'") quote = char
    else if (char === "/" && line[i + 1] === "/") return true
  }
  return quote !== null
}

export type Match = { item: CompletionItem; positions: number[]; score: number }

export function itemLabel(item: CompletionItem) {
  return item.label
}

/** Fuzzy match: in-order characters, first one at a word boundary. */
export function fuzzyMatch(word: string, label: string) {
  if (!word) return { positions: [] as number[], score: 0 }
  const lower = label.toLowerCase()
  const query = word.toLowerCase()
  const positions: number[] = []
  let score = 0
  for (let i = 0, j = 0; i < label.length && j < query.length; i++) {
    if (lower[i] !== query[j]) continue
    const boundary =
      i === 0 ||
      label[i - 1] === "_" ||
      (/[a-z]/.test(label[i - 1]) && /[A-Z]/.test(label[i]))
    if (j === 0 && !boundary) continue
    score += positions.at(-1) === i - 1 ? 3 : boundary ? 2 : 1
    if (label[i] === word[j]) score++
    positions.push(i)
    j++
  }
  if (positions.length !== query.length) return null
  if (positions[0] === 0) score += 10
  return { positions, score }
}

export function filterItems(items: CompletionItem[], word: string) {
  const matches: Match[] = []
  for (const item of items) {
    const label = itemLabel(item)
    const filter = item.filterText ?? label
    const match = fuzzyMatch(word, filter)
    if (!match) continue
    // Highlight only when the filter text is the displayed label.
    matches.push({
      item,
      positions: filter === label ? match.positions : [],
      score: match.score,
    })
  }
  return matches.sort(
    (a, b) =>
      b.score - a.score ||
      (a.item.sortText ?? a.item.label).localeCompare(
        b.item.sortText ?? b.item.label
      )
  )
}

/**
 * Expand a completion snippet to text plus the first tab stop's range. Later tab
 * stops keep their placeholder text.
 */
export function expandSnippet(snippet: string) {
  let text = ""
  const stops = new Map<number, [number, number]>()
  const parse = (input: string, i: number, until?: string): number => {
    while (i < input.length) {
      const char = input[i]
      if (until && char === until) return i + 1
      if (char === "\\" && i + 1 < input.length) {
        text += input[i + 1]
        i += 2
      } else if (char === "$" && /\d/.test(input[i + 1] ?? "")) {
        const digits = /^\d+/.exec(input.slice(i + 1))![0]
        if (!stops.has(+digits)) stops.set(+digits, [text.length, text.length])
        i += 1 + digits.length
      } else if (char === "$" && input[i + 1] === "{") {
        const head = /^\$\{(\d+)([:|}])/.exec(input.slice(i))
        if (!head) {
          text += char
          i++
          continue
        }
        const index = Number(head[1])
        const start = text.length
        i += head[0].length
        if (head[2] === ":") i = parse(input, i, "}")
        else if (head[2] === "|") {
          const end = input.indexOf("|}", i)
          text += input.slice(i, end).split(",")[0]
          i = end + 2
        }
        if (!stops.has(index)) stops.set(index, [start, text.length])
      } else {
        text += char
        i++
      }
    }
    return i
  }
  parse(snippet, 0)
  const first = [...stops.keys()]
    .filter((n) => n > 0)
    .sort((a, b) => a - b)
    .at(0)
  const selection = stops.get(first ?? 0) ?? [text.length, text.length]
  return { text, selection }
}
