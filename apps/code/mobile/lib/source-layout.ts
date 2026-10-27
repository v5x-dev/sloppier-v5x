// Shared metrics for the source view and the source editor. Both modes lay
// text out with these values, so switching modes never moves a character.
export const sourceFontSize = 13
export const sourceLineHeight = 22
export const sourcePaddingVertical = 12
export const gutterFontSize = 11
export const gutterPaddingRight = 14
// JetBrains Mono advances 0.6em per character.
export const charWidth = sourceFontSize * 0.6
// iOS text layout puts default tab stops every 28 points.
const tabInterval = 28

export type SourceScroll = { x: number; y: number }

export function gutterWidth(lineCount: number) {
  return Math.max(44, String(lineCount).length * 8 + 24)
}

export function contentWidth(lines: string[], windowWidth: number) {
  let columns = 0
  for (const line of lines)
    columns = Math.max(columns, line.replace(/\t/g, "    ").length)
  return Math.max(
    windowWidth,
    gutterWidth(lines.length) + 24 + columns * charWidth
  )
}

export function tokenFont(fontStyle = 0) {
  return fontStyle & 2
    ? fontStyle & 1
      ? "JetBrainsMonoBoldItalic"
      : "JetBrainsMonoBold"
    : fontStyle & 1
      ? "JetBrainsMonoItalic"
      : "JetBrainsMono"
}

// Maps a tap's x position within a line's text to the nearest caret column.
export function columnAt(line: string, x: number) {
  let left = 0
  for (let index = 0; index < line.length; index++) {
    const code = line.charCodeAt(index)
    // The low half of a surrogate pair is part of the previous character.
    if (code >= 0xdc00 && code <= 0xdfff) continue
    const right =
      line[index] === "\t"
        ? (Math.floor(left / tabInterval) + 1) * tabInterval
        : left + charWidth
    if (x < (left + right) / 2) return index
    left = right
  }
  return line.length
}

// The x position of a caret column within a line's text.
export function xAt(line: string, column: number) {
  let x = 0
  for (let index = 0; index < Math.min(column, line.length); index++) {
    const code = line.charCodeAt(index)
    if (code >= 0xdc00 && code <= 0xdfff) continue
    x =
      line[index] === "\t"
        ? (Math.floor(x / tabInterval) + 1) * tabInterval
        : x + charWidth
  }
  return x
}
