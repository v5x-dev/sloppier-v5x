export type HoverValue =
  string | { value: string; kind?: string; language?: string }
export type HoverContents = HoverValue | HoverValue[]
export type HoverBlock = {
  kind: "code" | "text" | "heading" | "list"
  text: string
  language?: string
}

/** Keep documentation code blocks and prose separate without rendering server HTML. */
export function hoverContent(contents: HoverContents) {
  const blocks: HoverBlock[] = []
  let source: string | undefined
  for (const value of Array.isArray(contents) ? contents : [contents]) {
    if (typeof value !== "string" && value.language) {
      blocks.push({ kind: "code", text: value.value, language: value.language })
      continue
    }
    const text = typeof value === "string" ? value : value.value
    let pending: string[] = []
    let language: string | undefined
    let fenced = false
    let list = false
    const flush = () => {
      const content = pending.join("\n").trim()
      if (content)
        blocks.push({
          kind: fenced ? "code" : list ? "list" : "text",
          text: content,
          ...(fenced ? { language: language || "cpp" } : {}),
        })
      pending = []
      list = false
    }
    for (const line of text.split("\n")) {
      const fence = line.match(/^\s*```([\w+-]*)/)
      if (fence) {
        flush()
        fenced = !fenced
        language = fence[1]
        continue
      }
      if (!fenced) {
        const provided = line.match(/^provided by\s+(.+?)\s*$/i)
        if (provided) {
          flush()
          source = provided[1].replace(/^["`]|["`]$/g, "")
          continue
        }
        const heading = line.match(/^#{1,6}\s+(.+)/)
        if (heading) {
          flush()
          blocks.push({ kind: "heading", text: heading[1].trim() })
          continue
        }
        const bullet = line.match(/^\s*[-*]\s+(.+)/)
        if (bullet) {
          if (!list) flush()
          list = true
          pending.push(bullet[1])
          continue
        }
        if (list && line.trim()) {
          if (/^\s+/.test(line)) {
            pending[pending.length - 1] += ` ${line.trim()}`
            continue
          }
          flush()
        }
        if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line) || !line.trim()) {
          flush()
          continue
        }
      }
      pending.push(line)
    }
    flush()
  }
  // Plaintext documentation is also supported. A namespace/signature block
  // still deserves the same C++ highlighting as a fenced markdown block.
  for (const block of blocks) {
    if (
      block.kind === "text" &&
      /^(?:\/\/ In namespace |(?:class|struct|enum|namespace)\s)/.test(
        block.text
      )
    ) {
      block.kind =
        block.text.includes("\n") || /[{};]/.test(block.text)
          ? "code"
          : "heading"
      if (block.kind === "code") block.language = "cpp"
    }
  }
  return { source, blocks }
}

export type InlineSegment = { text: string; style?: "code" | "strong" }

// Calls, constants and macros are code. A namespace prefix such as pros:: is part
// of the same token, so it stays inside the code span with its identifier.
const inlinePattern =
  /(`[^`]+`|\*\*[^*]+\*\*|\b\w+(?:::\w+)*\(\)|\b(?:\w+::)*E[A-Z0-9_]{2,}\b|\b(?:\w+::)*[A-Z][A-Z0-9]*_[A-Z0-9_]+\b)/
const identifierPattern =
  /^(?:\w+(?:::\w+)*\(\)|(?:\w+::)*E[A-Z0-9_]{2,}|(?:\w+::)*[A-Z][A-Z0-9]*_[A-Z0-9_]+)$/

/** Splits one line of documentation prose into plain, code, and bold segments. */
export function inlineSegments(text: string): InlineSegment[] {
  return text
    .split(inlinePattern)
    .filter(Boolean)
    .map((part): InlineSegment => {
      if (
        (part.startsWith("`") && part.endsWith("`")) ||
        identifierPattern.test(part)
      )
        return {
          text: part.startsWith("`") ? part.slice(1, -1) : part,
          style: "code",
        }
      if (part.startsWith("**") && part.endsWith("**"))
        return { text: part.slice(2, -2), style: "strong" }
      return { text: part }
    })
}
