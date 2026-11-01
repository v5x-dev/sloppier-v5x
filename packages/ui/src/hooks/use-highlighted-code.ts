import * as React from "react"
import type { LiveTokenizer } from "@pierre/highlights"

import { loadHighlighter } from "@v5x/ui/lib/highlighter"

type LoadedHighlighter = NonNullable<
  Awaited<ReturnType<typeof loadHighlighter>>
>
type Loaded = {
  language: string
  highlighter: LoadedHighlighter | null
  tokenizer: LiveTokenizer | null
}

export function useHighlightedCode(value: string, language: string) {
  // A trailing newline would render as an extra empty line.
  const code = value.endsWith("\n") ? value.slice(0, -1) : value
  const [loaded, setLoaded] = React.useState<Loaded | null>(null)

  React.useEffect(() => {
    let cancelled = false
    let tokenizer: LiveTokenizer | null = null

    loadHighlighter(language)
      .then((next) => {
        if (!cancelled) {
          tokenizer = next?.createTokenizer() ?? null
          setLoaded({ language, highlighter: next, tokenizer })
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
      tokenizer?.dispose()
    }
  }, [language])

  const active = loaded?.language === language ? loaded : null
  const current = React.useRef<{
    tokenizer: LiveTokenizer | null
    code: string
  }>({ tokenizer: null, code: "" })

  return React.useMemo(() => {
    if (!active?.highlighter || !active.tokenizer) {
      return code.split("\n")
    }

    const { tokenizer, highlighter } = active

    if (current.current.tokenizer !== tokenizer) {
      current.current = { tokenizer, code: "" }
    }

    if (current.current.code !== code) {
      if (code.startsWith(current.current.code)) {
        const line = tokenizer.lineCount - 1
        const character = tokenizer.getLineLength(line)
        tokenizer.applyEdits([
          {
            range: {
              start: { line, character },
              end: { line, character },
            },
            newText: code.slice(current.current.code.length),
          },
        ])
      } else {
        tokenizer.reset(code)
      }
      current.current.code = code
    }

    return Array.from({ length: tokenizer.lineCount }, (_, line) =>
      highlighter.renderTokens(tokenizer.getLineTokens(line).tokens)
    )
  }, [active, code])
}
