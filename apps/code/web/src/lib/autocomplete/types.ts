export type Position = { line: number; character: number }
export type TextRange = { start: Position; end: Position }
export type TextEdit = { range: TextRange; newText: string }
export type CompletionItem = {
  label: string
  labelDetails?: { detail?: string; description?: string }
  kind?: number
  detail?: string
  documentation?: string | { kind: string; value: string }
  sortText?: string
  filterText?: string
  insertText?: string
  insertTextFormat?: number
  textEdit?: TextEdit
  additionalTextEdits?: TextEdit[]
  retrigger?: boolean
}
export type CompletionList = { isIncomplete: boolean; items: CompletionItem[] }
export type SignatureHelp = {
  signatures: {
    label: string
    documentation?: string | { kind: string; value: string }
    parameters?: { label: string | [number, number] }[]
    activeParameter?: number
  }[]
  activeSignature?: number
  activeParameter?: number
}
export type Parameter = {
  name: string
  type: string
  label: string
  optional?: boolean
}
export type ApiSymbol = {
  name: string
  scope: string
  kind: number
  type: string
  parameters?: Parameter[]
  documentation?: string
  bases?: string[]
  alias?: string
  scoped?: boolean
  static?: boolean
  path?: string
  position?: Position
  /** Local declarations are visible only inside this source interval. */
  start?: number
  end?: number
  offset?: number
}
export type ApiDatabase = {
  symbols: ApiSymbol[]
  inlineNamespaces: Record<string, string>
  headers: string[]
}

export function positionAt(text: string, offset: number): Position {
  const before = text.slice(0, offset)
  const line = before.lastIndexOf("\n")
  return { line: before.split("\n").length - 1, character: offset - line - 1 }
}
export function offsetAt(text: string, position: Position) {
  let start = 0
  for (let line = 0; line < position.line; line++) {
    const next = text.indexOf("\n", start)
    if (next < 0) return text.length
    start = next + 1
  }
  const end = text.indexOf("\n", start)
  return Math.min(start + position.character, end < 0 ? text.length : end)
}
