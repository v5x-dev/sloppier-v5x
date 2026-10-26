export type SearchMatch = {
  line: number
  column: number
  text: string
  start: number
  end: number
}
export type SearchFile = { path: string; matches: SearchMatch[] }
export const SEARCH_LIMIT = 300
export function literalPattern(query: string) {
  return query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
/** Literal, single-line matches with bounded context and exact UTF-16 columns. */
export function searchText(
  text: string,
  query: string,
  matchCase = false,
  limit = SEARCH_LIMIT
): SearchMatch[] {
  if (!query || /[\r\n]/.test(query) || text.includes("\0")) return []
  const pattern = new RegExp(literalPattern(query), matchCase ? "gu" : "giu")
  const results: SearchMatch[] = []
  let line = 1
  let lineStart = 0
  for (const match of text.matchAll(pattern)) {
    if (results.length >= limit) break
    while (true) {
      const newline = text.indexOf("\n", lineStart)
      if (newline < 0 || newline >= match.index) break
      line++
      lineStart = newline + 1
    }
    const lineEnd = text.indexOf("\n", match.index)
    const start = Math.max(lineStart, match.index - 60)
    const end = Math.min(
      lineEnd < 0 ? text.length : lineEnd,
      match.index + match[0].length + 100
    )
    const prefix = start > lineStart ? "…" : ""
    const suffix = end < (lineEnd < 0 ? text.length : lineEnd) ? "…" : ""
    results.push({
      line,
      column: match.index - lineStart + 1,
      text: prefix + text.slice(start, end).replace(/\r$/, "") + suffix,
      start: prefix.length + match.index - start,
      end: prefix.length + match.index - start + match[0].length,
    })
  }
  return results
}

export type SearchFilters = { sourceOnly?: boolean; pathFilter?: string }
export const SEARCH_SOURCE_EXCLUDES = [
  "firmware/**",
  "include/api.h",
  "include/pros/**",
  "include/EZ-Template/**",
  "include/okapi/**",
  "include/liblvgl/**",
  "**/node_modules/**",
  "**/vendor/**",
]

export function searchPathGlob(filter: string) {
  const path = filter.trim().replace(/^\.\//, "").replace(/^\/+/, "")
  if (!path) return "**/*"
  if (path.endsWith("/")) return `${path}**`
  return path.includes("/") ? path : `**/${path}`
}

function matchesGlob(path: string, glob: string) {
  let pattern = ""
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]
    if (char === "*" && glob[index + 1] === "*") {
      index++
      if (glob[index + 1] === "/") {
        index++
        pattern += "(?:.*/)?"
      } else pattern += ".*"
    } else if (char === "*") pattern += "[^/]*"
    else if (char === "?") pattern += "[^/]"
    else pattern += literalPattern(char)
  }
  return new RegExp(`^${pattern}$`).test(path)
}

export function matchesSearchPath(path: string, filters: SearchFilters = {}) {
  if (path.startsWith(".v5x/")) return false
  if (
    filters.sourceOnly &&
    (!/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|s|rs|py|js|jsx|ts|tsx)$/i.test(path) ||
      SEARCH_SOURCE_EXCLUDES.some((glob) => matchesGlob(path, glob)))
  )
    return false
  return (
    !filters.pathFilter?.trim() ||
    matchesGlob(path, searchPathGlob(filters.pathFilter))
  )
}

export function overlaySearch(
  files: SearchFile[],
  drafts: ReadonlyMap<string, string>,
  query: string,
  matchCase: boolean,
  filters: SearchFilters = {}
) {
  const merged = new Map<string, SearchMatch[]>()
  for (const file of files) {
    if (!matchesSearchPath(file.path, filters)) continue
    const matches = merged.get(file.path) ?? []
    matches.push(...file.matches)
    merged.set(file.path, matches)
  }
  for (const [path, text] of drafts) {
    if (matchesSearchPath(path, filters))
      merged.set(path, searchText(text, query, matchCase, SEARCH_LIMIT + 1))
  }
  let remaining = SEARCH_LIMIT
  const result: SearchFile[] = []
  let truncated = false
  for (const [path, matches] of [...merged].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    if (matches.length > remaining) truncated = true
    const kept = matches.slice(0, remaining)
    if (kept.length) result.push({ path, matches: kept })
    remaining -= kept.length
  }
  return { files: result, truncated }
}
