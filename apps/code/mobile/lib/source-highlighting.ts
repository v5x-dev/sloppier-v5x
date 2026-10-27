import { refractor } from "refractor/core"
import cpp from "refractor/cpp"
import makefile from "refractor/makefile"
import json from "refractor/json"
import yaml from "refractor/yaml"
import python from "refractor/python"
import bash from "refractor/bash"
import markdown from "refractor/markdown"
import birdsOfParadise from "./themes/birds-of-paradise-zed.json"

const style = birdsOfParadise.themes[0].style
export const sourceColors = {
  background: style["editor.background"],
  foreground: style["editor.foreground"],
  gutter: "#a49a88",
  selection: style.players[0].selection,
}
export type SourceToken = {
  content: string
  color?: string
  fontStyle?: number
}
type SyntaxStyle = { color: string; font_style?: string; font_weight?: number }
type SyntaxNode = {
  type: string
  value?: string
  properties?: Record<string, unknown>
  children?: readonly SyntaxNode[]
}
const syntax: Record<string, SyntaxStyle> = style.syntax
const categories: Record<string, string> = {
  comment: "comment",
  prolog: "comment",
  doctype: "preproc",
  cdata: "comment",
  keyword: "keyword",
  operator: "operator",
  number: "number",
  boolean: "boolean",
  constant: "constant",
  string: "string",
  char: "string",
  "attr-value": "string",
  regex: "string.regex",
  escape: "string.escape",
  function: "function",
  "function-definition": "function",
  "class-name": "type",
  "class-name-base": "type",
  "type-definition": "type",
  namespace: "namespace",
  variable: "variable",
  parameter: "variable",
  property: "property",
  punctuation: "punctuation",
  macro: "preproc",
  directive: "preproc",
  "directive-hash": "preproc",
  "macro-name": "constant",
  symbol: "string.special.symbol",
  tag: "tag",
  "attr-name": "attribute",
  selector: "selector",
  title: "title",
  bold: "emphasis.strong",
  italic: "emphasis",
  url: "link_uri",
  inserted: "diff.plus",
  deleted: "diff.minus",
}
for (const language of [cpp, makefile, json, yaml, python, bash, markdown])
  refractor.register(language)

export async function highlightSource(
  contents: string,
  path: string
): Promise<SourceToken[][]> {
  return highlightSourceSync(contents, path)
}

// Each line's token contents join back to the exact source line, so the
// editor can render tokens as TextInput children without altering the text.
export function highlightSourceSync(
  contents: string,
  path: string
): SourceToken[][] {
  const name = path.split("/").pop()?.toLowerCase() ?? ""
  const extension = name.split(".").pop() ?? ""
  const languages: Record<string, string> = {
    c: "c",
    h: "cpp",
    cc: "cpp",
    cpp: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    hh: "cpp",
    mk: "makefile",
    mak: "makefile",
    make: "makefile",
    json: "json",
    pros: "json",
    yaml: "yaml",
    yml: "yaml",
    py: "python",
    sh: "bash",
    bash: "bash",
    md: "markdown",
  }
  const language = /^(gnu|bsd)?makefile$/.test(name)
    ? "makefile"
    : name === ".clang-format"
      ? "yaml"
      : languages[extension]
  if (!language)
    return contents
      .split("\n")
      .map((content) => [
        { content, color: sourceColors.foreground, fontStyle: 0 },
      ])
  const root = refractor.highlight(contents, language)
  const lines: SourceToken[][] = [[]]
  const visit = (
    node: SyntaxNode,
    inherited: SyntaxStyle,
    inComment = false
  ) => {
    const classes = node.properties?.className
    const names = Array.isArray(classes)
      ? classes.filter((name): name is string => typeof name === "string")
      : []
    let tokenStyle = inherited
    if (!inComment)
      for (const name of names) {
        const match = syntax[categories[name]]
        if (match) tokenStyle = match
      }
    const comment = inComment || names.includes("comment")
    if (node.type === "text") {
      const parts = (node.value ?? "").split("\n")
      parts.forEach((content, index) => {
        if (index) lines.push([])
        if (!content) return
        const fontStyle =
          (tokenStyle.font_style === "italic" ? 1 : 0) |
          ((tokenStyle.font_weight ?? 400) >= 700 ? 2 : 0)
        const line = lines[lines.length - 1]
        const previous = line[line.length - 1]
        if (
          previous?.color === tokenStyle.color &&
          previous.fontStyle === fontStyle
        )
          previous.content += content
        else line.push({ content, color: tokenStyle.color, fontStyle })
      })
    } else
      for (const child of node.children ?? []) visit(child, tokenStyle, comment)
  }
  visit(root, { color: sourceColors.foreground })
  return lines
}
