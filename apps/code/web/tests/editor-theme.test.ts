import { expect, test } from "vitest"
import { getSharedHighlighter, disposeHighlighter } from "@pierre/diffs"
import { editorThemeOptions } from "../src/lib/editor-theme"

test("Highlights loads the Zed Birds of Paradise syntax palette", async () => {
  const theme = editorThemeOptions.theme.dark
  try {
    const highlighter = await getSharedHighlighter({
      themes: [theme],
      langs: ["cpp"],
      preferredHighlighter: editorThemeOptions.preferredHighlighter,
    })
    expect(highlighter.name).toBe("highlights")
    const result = highlighter.codeToTokens('void initialize() { if (true) return; }\n// comment', { lang: "cpp", theme })
    const colors = result.tokens.flat().map((token) => token.color)
    expect(colors.map((color) => color?.toLowerCase())).toContain("#ef5d32")
    expect(colors.map((color) => color?.toLowerCase())).toContain("#6b4e32")
  } finally {
    await disposeHighlighter()
  }
})
