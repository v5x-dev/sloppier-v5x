import { forwardRef, useMemo } from "react"
import SourceEditor, {
  type HighlightSpan,
  type SourceEditorRef,
} from "@workspace-sh/react-native-source-editor"
import { highlightSourceSync, sourceColors } from "@/lib/source-highlighting"
import {
  gutterFontSize,
  sourceFontSize,
  sourceLineHeight,
  sourcePaddingVertical,
} from "@/lib/source-layout"

export type { SourceEditorRef as CodeEditorRef }

const font = {
  family: "JetBrainsMono-Regular",
  boldFamily: "JetBrainsMono-Bold",
  italicFamily: "JetBrainsMono-Italic",
  boldItalicFamily: "JetBrainsMono-BoldItalic",
  size: sourceFontSize,
  lineHeight: sourceLineHeight,
}

const gutter = {
  fontFamily: "JetBrainsMono-Regular",
  fontSize: gutterFontSize,
  minimumWidth: 44,
  leadingInset: 8,
  trailingInset: 14,
}

const contentInsets = {
  top: sourcePaddingVertical,
  bottom: sourcePaddingVertical,
  left: 0,
  right: 24,
}

// Converts per-line tokens to spans over the whole text. Spans that only
// repeat the default color and style are dropped to keep the payload small.
function toSpans(lines: ReturnType<typeof highlightSourceSync>) {
  const spans: HighlightSpan[] = []
  let offset = 0
  for (const line of lines) {
    for (const token of line) {
      const color = token.color ?? sourceColors.foreground
      const fontStyle = token.fontStyle ?? 0
      if (color !== sourceColors.foreground || fontStyle)
        spans.push({
          start: offset,
          length: token.content.length,
          color,
          fontStyle,
        })
      offset += token.content.length
    }
    offset += 1 // the newline between lines
  }
  return spans
}

// Native source editor (STTextView) with the Birds of Paradise palette.
// Tapping the text places the caret natively and opens the keyboard.
export const CodeEditor = forwardRef<
  SourceEditorRef,
  {
    text: string
    path: string
    editable: boolean
    backgroundColor: string
    onChangeText: (text: string) => void
    onFocusChange?: (focused: boolean) => void
  }
>(function CodeEditor(
  { text, path, editable, backgroundColor, onChangeText, onFocusChange },
  ref
) {
  const highlights = useMemo(
    () => toSpans(highlightSourceSync(text, path)),
    [text, path]
  )
  const colors = useMemo(
    () => ({
      background: backgroundColor,
      foreground: sourceColors.foreground,
      caret: sourceColors.foreground,
      gutterBackground: backgroundColor,
      gutterText: sourceColors.gutter,
      gutterCurrentLineText: sourceColors.foreground,
    }),
    [backgroundColor]
  )
  return (
    <SourceEditor
      ref={ref}
      value={text}
      editable={editable}
      theme="dark"
      font={font}
      gutter={gutter}
      colors={colors}
      highlights={highlights}
      lineNumbers
      wrapLines={false}
      contentInsets={contentInsets}
      onChangeText={onChangeText}
      onFocusChange={onFocusChange}
      style={{ flex: 1, backgroundColor }}
    />
  )
})
