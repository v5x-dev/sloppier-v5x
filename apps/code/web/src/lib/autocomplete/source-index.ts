import { type ApiSymbol, type Parameter } from "./types"

export type Token = {
  value: string
  start: number
  end: number
  kind: "word" | "punctuation" | "literal" | "comment" | "directive"
}

/** Keep source offsets while excluding strings, comments, and preprocessor bodies. */
export function tokenize(text: string): Token[] {
  const result: Token[] = []
  const pattern =
    /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|R"([^\s()\\]{0,16})\([\s\S]*?\)\1"|"(?:\\[\s\S]|[^"\\])*"?|'(?:\\[\s\S]|[^'\\])*'?|^[\t ]*#(?:\\\r?\n|[^\n])*|[A-Za-z_$][\w$]*|\d+(?:[\w.]*\w)?|::|->|==|!=|<=|>=|&&|\|\||\+\+|--|[^\s]/gm
  for (const match of text.matchAll(pattern)) {
    const value = match[0]
    const kind = /^\s*#/.test(value)
      ? "directive"
      : value.startsWith("//") || value.startsWith("/*")
        ? "comment"
        : /^(?:R"|["']|\d)/.test(value)
          ? "literal"
          : /^[A-Za-z_$]/.test(value)
            ? "word"
            : "punctuation"
    result.push({
      value,
      start: match.index,
      end: match.index + value.length,
      kind,
    })
  }
  return result
}

export function codeTokens(text: string) {
  return tokenize(text).filter(
    (token) => token.kind !== "comment" && token.kind !== "directive"
  )
}

const controls = new Set([
  "if",
  "else",
  "while",
  "for",
  "switch",
  "catch",
  "return",
  "delete",
  "throw",
  "case",
  "break",
  "continue",
  "do",
  "static_assert",
])
const qualifiers = new Set([
  "extern",
  "static",
  "inline",
  "constexpr",
  "consteval",
  "constinit",
  "mutable",
  "virtual",
  "explicit",
  "friend",
  "typename",
  "register",
])
export const joinTokens = (tokens: Token[]) =>
  tokens
    .map((t) => t.value)
    .join(" ")
    .replace(/\s*::\s*/g, "::")
    .replace(/\s*([<>,*&[\]])\s*/g, "$1")
    .trim()

function split(tokens: Token[], delimiter = ",") {
  const parts: Token[][] = []
  let start = 0,
    depth = 0
  tokens.forEach((token, i) => {
    if (["(", "[", "{", "<"].includes(token.value)) depth++
    if ([")", "]", "}", ">"].includes(token.value)) depth--
    if (token.value === delimiter && depth === 0) {
      parts.push(tokens.slice(start, i))
      start = i + 1
    }
  })
  parts.push(tokens.slice(start))
  return parts
}

function variable(tokens: Token[]) {
  const stop = tokens.findIndex((t) => ["=", "{", "["].includes(t.value))
  const declaration = stop < 0 ? tokens : tokens.slice(0, stop)
  let at = declaration.length - 1
  while (at >= 0 && declaration[at].kind !== "word") at--
  const name = at < 0 ? undefined : declaration.at(at)
  if (!name || at === 0 || declaration[at - 1].value === "::") return null
  const typeTokens = declaration
    .slice(0, at)
    .filter((t) => !qualifiers.has(t.value))
  if (
    !typeTokens.some((t) => t.kind === "word") ||
    typeTokens.some((t) =>
      [".", "->", "(", ")", "+", "-", "!"].includes(t.value)
    )
  )
    return null
  return {
    name,
    type: joinTokens(typeTokens),
    initializer: stop < 0 ? [] : tokens.slice(stop + 1),
  }
}

/** A tolerant declaration index for incomplete C/C++. It does not execute macros. */
export function indexSource(path: string, text: string) {
  const lineStarts = [0]
  for (let i = 0; i < text.length; i++)
    if (text[i] === "\n") lineStarts.push(i + 1)
  const position = (offset: number) => {
    let low = 0,
      high = lineStarts.length
    while (low + 1 < high) {
      const middle = (low + high) >>> 1
      if (lineStarts[middle] <= offset) low = middle
      else high = middle
    }
    return { line: low, character: offset - lineStarts[low] }
  }
  const all = tokenize(text)
  const tokens = all.filter(
    (t) => t.kind !== "comment" && t.kind !== "directive"
  )
  const symbols: ApiSymbol[] = []
  const comments = new Map<number, Token>()
  let comment: Token | undefined
  for (const token of all) {
    if (token.kind === "comment") comment = token
    else if (comment) comments.set(token.start, comment)
  }
  const using: { scope: string; owner: string; start: number; end: number }[] =
    []
  const pairs = new Map<number, number>()
  const stack: number[] = []
  for (let i = 0; i < tokens.length; i++) {
    if (["{", "(", "["].includes(tokens[i].value)) stack.push(i)
    else if (["}", ")", "]"].includes(tokens[i].value)) {
      const expected = { "}": "{", ")": "(", "]": "[" }[tokens[i].value]
      if (tokens[stack.at(-1) ?? -1]?.value === expected) {
        const open = stack.pop()!
        pairs.set(open, i)
      }
    }
  }
  const add = (
    token: Token,
    scope: string,
    kind: number,
    type: string,
    extra: Partial<ApiSymbol> = {}
  ) => {
    const previous = comments.get(token.start)
    const documentation =
      previous &&
      /^\s*(?:[A-Za-z_:*&<>\s]+)?$/.test(text.slice(previous.end, token.start))
        ? previous.value
            .replace(/^\/\*+|\*\/$|^\s*\/\/\/?\s?|^\s*\*\s?/gm, "")
            .trim()
        : undefined
    symbols.push({
      name: token.value,
      scope,
      kind,
      type,
      path,
      position: position(token.start),
      offset: token.start,
      documentation,
      ...extra,
    })
  }
  const parse = (
    from: number,
    to: number,
    scope: string,
    local?: { start: number; end: number },
    record: "class" | "struct" | undefined = undefined
  ) => {
    let start = from
    let access = record === "class" ? "private" : "public"
    const emit = (part: Token[], bodyStart?: number, bodyEnd?: number) => {
      if (!part.length) return
      if (part[0].value === "namespace" && part[2]?.value === "=") {
        add(part[1], scope, 9, joinTokens(part.slice(3)), {
          alias: joinTokens(part.slice(3)),
        })
        return
      }
      if (part[0].value === "using") {
        if (part[1]?.value === "namespace")
          using.push({
            scope: joinTokens(part.slice(2)),
            owner: scope,
            start: local?.start ?? 0,
            end: local?.end ?? text.length,
          })
        else if (part[2]?.value === "=")
          add(part[1], scope, 7, joinTokens(part.slice(3)), {
            alias: joinTokens(part.slice(3)),
          })
        else {
          const name = part.at(-1)
          if (name)
            add(name, scope, 7, joinTokens(part.slice(1)), {
              alias: joinTokens(part.slice(1)),
            })
        }
        return
      }
      if (controls.has(part[0].value)) return
      const open = part.findIndex((t) => t.value === "(")
      const close = open < 0 ? -1 : part.map((t) => t.value).lastIndexOf(")")
      const name = open < 1 ? undefined : part.at(open - 1)
      if (
        open > 0 &&
        close > open &&
        name?.kind === "word" &&
        !part.slice(0, open).some((t) => ["=", ".", "->"].includes(t.value))
      ) {
        const arguments_ = split(part.slice(open + 1, close))
        const params: Parameter[] = arguments_
          .filter((p) => p.length && joinTokens(p) !== "void")
          .map((p) => {
            const v = variable(p)
            return {
              name: v?.name.value ?? "",
              type: v?.type ?? joinTokens(p),
              label: joinTokens(p),
              optional: p.some((t) => t.value === "="),
            }
          })
        // A parenthesized constructor expression is a variable, not a function.
        const constructorInit = arguments_.some(
          (p) =>
            p[0]?.kind === "literal" ||
            p.some((t) => t.value === "{") ||
            /^[A-Z_][A-Z_0-9]*$/.test(p.at(-1)?.value ?? "") ||
            ["true", "false", "nullptr"].includes(p[0]?.value)
        )
        if (!constructorInit && (open > 1 || record)) {
          if (access === "public")
            add(
              name,
              scope,
              record ? (name.value === scope.split("::").at(-1) ? 4 : 2) : 3,
              joinTokens(
                part.slice(0, open - 1).filter((t) => !qualifiers.has(t.value))
              ),
              { parameters: params, ...local }
            )
          if (bodyStart !== undefined && bodyEnd !== undefined) {
            const region = {
              start: tokens[bodyStart].start,
              end: tokens[bodyEnd]?.end ?? text.length,
            }
            for (const p of arguments_) {
              const v = variable(p)
              if (v) add(v.name, scope, 6, v.type, region)
            }
            parse(bodyStart + 1, bodyEnd, scope, region)
          }
          return
        }
        const declaration = part.slice(0, open)
        const v = variable(declaration)
        if (v && access === "public")
          add(v.name, scope, record ? 5 : 6, v.type, local)
        return
      }
      const pieces = split(part)
      let type = ""
      for (const [i, piece] of pieces.entries()) {
        const v = variable(piece)
        if (v) {
          type = v.type
          if (access === "public")
            add(v.name, scope, record ? 5 : 6, type, {
              ...local,
              ...(/^auto[&*]*$/.test(type)
                ? { alias: joinTokens(v.initializer) }
                : {}),
            })
        } else if (
          i > 0 &&
          type &&
          piece[0]?.kind === "word" &&
          access === "public"
        )
          add(piece[0], scope, record ? 5 : 6, type, local)
      }
    }
    for (let i = from; i < to; i++) {
      const token = tokens[i]
      if (
        ["public", "private", "protected"].includes(token.value) &&
        tokens[i + 1]?.value === ":"
      ) {
        access = token.value
        start = i + 2
        i++
      } else if (token.value === "(") {
        const close = pairs.get(i)
        if (close !== undefined) i = close
      } else if (token.value === "{") {
        const end = Math.min(pairs.get(i) ?? to, to)
        const head = tokens.slice(start, i)
        const declaration = head.findIndex((t) =>
          ["namespace", "class", "struct", "enum"].includes(t.value)
        )
        if (declaration >= 0 && !head.some((t) => t.value === "(")) {
          const tag = head[declaration].value
          let nameAt = declaration + 1
          if (
            tag === "enum" &&
            ["class", "struct"].includes(head[nameAt]?.value)
          )
            nameAt++
          const name = head.at(nameAt)
          const nested =
            name?.kind === "word"
              ? `${scope ? scope + "::" : ""}${joinTokens(head.slice(nameAt, head.findIndex((t) => t.value === ":") < 0 ? undefined : head.findIndex((t) => t.value === ":")))}`
              : scope
          if (name && access === "public")
            add(
              name,
              scope,
              tag === "namespace" ? 9 : tag === "enum" ? 13 : 7,
              "",
              {
                ...(tag === "enum"
                  ? { scoped: nameAt !== declaration + 1 }
                  : {}),
                bases: head.some((t) => t.value === ":")
                  ? split(
                      head.slice(head.findIndex((t) => t.value === ":") + 1)
                    ).map((p) =>
                      joinTokens(
                        p.filter(
                          (t) => !["public", "virtual"].includes(t.value)
                        )
                      )
                    )
                  : [],
              }
            )
          if (tag === "enum") {
            for (const part of split(tokens.slice(i + 1, end)))
              if (part[0]?.kind === "word") add(part[0], nested, 20, nested)
          } else
            parse(
              i + 1,
              end,
              nested,
              local,
              tag === "class" || tag === "struct" ? tag : undefined
            )
        } else if (head.some((t) => t.value === ")")) emit(head, i, end)
        else if (head.length && !controls.has(head[0].value)) {
          // Braced initialization belongs to the declaration ending at ';'.
          i = end
          continue
        } else
          parse(i + 1, end, scope, {
            start: token.start,
            end: tokens[end]?.end ?? text.length,
          })
        i = end
        start = i + 1
      } else if (token.value === ";") {
        emit(tokens.slice(start, i))
        start = i + 1
      }
    }
  }
  parse(0, tokens.length, "")
  return {
    symbols,
    using,
    tokens,
    includes: all
      .filter((t) => t.kind === "directive")
      .flatMap(
        (t) => /^\s*#\s*include\s*[<"]([^>"]+)/.exec(t.value)?.[1] ?? []
      ),
  }
}
export type SourceIndex = ReturnType<typeof indexSource>
