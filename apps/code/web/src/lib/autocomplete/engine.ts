import {
  codeTokens,
  indexSource,
  joinTokens,
  tokenize,
  type SourceIndex,
  type Token,
} from "./source-index"
import {
  offsetAt,
  positionAt,
  type ApiDatabase,
  type ApiSymbol,
  type CompletionItem,
  type CompletionList,
  type Position,
  type SignatureHelp,
  type TextRange,
} from "./types"

const qualified = (s: ApiSymbol) => (s.scope ? `${s.scope}::${s.name}` : s.name)
const baseType = (type: string) =>
  type
    .replace(/\b(const|volatile|class|struct|enum|typename)\b/g, "")
    .replace(/[&*]/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .trim()
const signature = (s: ApiSymbol) =>
  `${s.type ? s.type + " " : ""}${qualified(s)}${s.parameters ? `(${s.parameters.map((p) => p.label).join(", ")})` : ""}`
const keywords = [
  "auto",
  "bool",
  "break",
  "case",
  "char",
  "class",
  "const",
  "constexpr",
  "continue",
  "default",
  "double",
  "else",
  "enum",
  "extern",
  "false",
  "float",
  "for",
  "if",
  "int",
  "namespace",
  "nullptr",
  "private",
  "protected",
  "public",
  "return",
  "sizeof",
  "static",
  "struct",
  "switch",
  "template",
  "this",
  "true",
  "typedef",
  "typename",
  "unsigned",
  "using",
  "virtual",
  "void",
  "volatile",
  "while",
]
const snippets: CompletionItem[] = [
  {
    label: "if",
    insertText: "if (${1:condition}) {\n  $0\n}",
    kind: 15,
    insertTextFormat: 2,
  },
  {
    label: "if/else",
    insertText: "if (${1:condition}) {\n  $0\n} else {\n  \n}",
    kind: 15,
    insertTextFormat: 2,
  },
  {
    label: "for",
    insertText:
      "for (int ${1:i} = 0; ${1:i} < ${2:count}; ++${1:i}) {\n  $0\n}",
    kind: 15,
    insertTextFormat: 2,
  },
  {
    label: "while",
    insertText: "while (${1:condition}) {\n  $0\n}",
    kind: 15,
    insertTextFormat: 2,
  },
]

type FileIndex = { text: string; index: SourceIndex }
type Context = {
  path: string
  text: string
  offset: number
  replacement: TextRange
  index: SourceIndex
  symbols: ApiSymbol[]
  scopes: string[]
}

/** API metadata and tolerant source analysis behind one editor-independent interface. */
export class AutocompleteEngine {
  private files = new Map<string, FileIndex>()
  private api: ApiSymbol[]
  private byScope = new Map<string, ApiSymbol[]>()
  private byName = new Map<string, ApiSymbol[]>()
  constructor(private database: ApiDatabase) {
    this.api = database.symbols.map((symbol) => ({
      ...symbol,
      scope: this.canonical(symbol.scope),
    }))
    for (const symbol of this.api) {
      const scope = this.byScope.get(symbol.scope) ?? []
      scope.push(symbol)
      this.byScope.set(symbol.scope, scope)
      const name = this.byName.get(qualified(symbol)) ?? []
      name.push(symbol)
      this.byName.set(qualified(symbol), name)
    }
    // Unscoped enumerators are also members of their enclosing namespace/class.
    for (const symbol of [...this.api]) {
      if (symbol.kind !== 20) continue
      const enumeration = this.byName
        .get(symbol.scope)
        ?.find((s) => s.kind === 13)
      if (!enumeration || enumeration.scoped) continue
      const exposed = { ...symbol, scope: enumeration.scope }
      this.api.push(exposed)
      this.byScope.set(exposed.scope, [
        ...(this.byScope.get(exposed.scope) ?? []),
        exposed,
      ])
      this.byName.set(qualified(exposed), [
        ...(this.byName.get(qualified(exposed)) ?? []),
        exposed,
      ])
    }
  }
  setFile(path: string, text: string) {
    if (this.files.get(path)?.text !== text)
      this.files.set(path, { text, index: indexSource(path, text) })
  }
  removeFile(path: string) {
    this.files.delete(path)
  }
  getFile(path: string) {
    return this.files.get(path)?.text
  }
  clear() {
    this.files.clear()
  }

  private canonical(name: string) {
    let result = name.replace(/^::/, "")
    for (const [from, to] of Object.entries(this.database.inlineNamespaces))
      result = result.replace(new RegExp(`^${from}(?=::|$)`), to)
    return result
  }
  private context(path: string, position: Position): Context | null {
    const file = this.files.get(path)
    if (!file) return null
    const offset = offsetAt(file.text, position)
    const symbols = [...this.files.values()]
      .flatMap((f) => f.index.symbols)
      .filter(
        (s) =>
          s.start === undefined ||
          (s.path === path &&
            s.start <= offset &&
            (s.end ?? Infinity) >= offset)
      )
    const scopes = ["", ...(/\.c$/i.test(path) ? ["pros", "pros::c"] : [])]
    // Namespace and class declarations surrounding this position are also visible.
    const prefix = file.index.tokens.filter((t) => t.start < offset)
    const stack: string[] = []
    let head: Token[] = []
    for (const token of prefix) {
      if (token.value === "{") {
        const named = head.findIndex((t) =>
          ["namespace", "class", "struct"].includes(t.value)
        )
        stack.push(named >= 0 ? (head[named + 1]?.value ?? "") : "")
        head = []
      } else if (token.value === "}") {
        stack.pop()
        head = []
      } else if (token.value === ";") head = []
      else head.push(token)
    }
    const enclosing = stack.filter(Boolean)
    for (let i = 1; i <= enclosing.length; i++)
      scopes.push(enclosing.slice(0, i).join("::"))
    const included = new Set<string>()
    const visit = (current: string) => {
      if (included.has(current)) return
      included.add(current)
      for (const include of this.files.get(current)?.index.includes ?? []) {
        const directory = current.slice(0, current.lastIndexOf("/") + 1)
        const relative: string[] = []
        for (const part of (directory + include).split("/")) {
          if (part === "..") relative.pop()
          else if (part && part !== ".") relative.push(part)
        }
        const target =
          [relative.join("/"), include, `include/${include}`].find(
            (candidate) => this.files.has(candidate)
          ) ??
          [...this.files.keys()].find((candidate) =>
            candidate.endsWith(`/${include}`)
          )
        if (target) visit(target)
      }
    }
    visit(path)
    for (const includedPath of included) {
      for (const imported of this.files.get(includedPath)?.index.using ?? []) {
        if (!scopes.includes(imported.owner)) continue
        if (
          includedPath === path &&
          (offset < imported.start || offset > imported.end)
        )
          continue
        if (includedPath !== path && imported.start !== 0) continue
        scopes.push(this.canonical(imported.scope))
      }
    }
    return {
      path,
      text: file.text,
      offset,
      replacement: {
        start: {
          line: position.line,
          character:
            position.character -
            (/[A-Za-z0-9_]*$/.exec(file.text.slice(0, offset))?.[0].length ??
              0),
        },
        end: {
          line: position.line,
          character:
            position.character +
            (/^[A-Za-z0-9_]*/.exec(file.text.slice(offset))?.[0].length ?? 0),
        },
      },
      index: file.index,
      symbols,
      scopes: [...new Set(scopes)].reverse(),
    }
  }
  private lookup(name: string, ctx: Context, scope?: string): ApiSymbol[] {
    const full = this.canonical(name)
    const candidates =
      scope === undefined
        ? [...ctx.scopes.map((s) => (s ? `${s}::${full}` : full)), full]
        : [`${scope ? scope + "::" : ""}${full}`]
    for (const target of [...new Set(candidates)]) {
      const local = ctx.symbols.filter(
        (s) => this.canonical(qualified(s)) === target
      )
      if (local.length) {
        const inFile = local.filter(
          (s) => s.path === ctx.path && (s.offset ?? 0) <= ctx.offset
        )
        const nearest = inFile
          .sort(
            (a, b) =>
              (b.start ?? -1) - (a.start ?? -1) ||
              (b.offset ?? 0) - (a.offset ?? 0)
          )
          .at(0)
        if (nearest && nearest.kind !== 3) return [nearest]
        return local
      }
    }
    for (const target of [...new Set(candidates)]) {
      const api = this.byName.get(target)
      if (api?.length) return api
    }
    return []
  }
  private typeScope(
    type: string,
    ctx: Context,
    seen = new Set<string>()
  ): string {
    const name = this.canonical(baseType(type))
    if (!name || seen.has(name)) return name
    seen.add(name)
    const symbol = this.lookup(name, ctx).at(0)
    if (symbol?.alias) return this.typeScope(symbol.alias, ctx, seen)
    return symbol && [7, 9, 13, 22].includes(symbol.kind)
      ? this.canonical(qualified(symbol))
      : name
  }
  private symbolType(symbol: ApiSymbol, ctx: Context) {
    const parts = symbol.scope.split("::")
    const scopes = parts.map((_, i) =>
      parts.slice(0, parts.length - i).join("::")
    )
    return this.typeScope(symbol.type, {
      ...ctx,
      scopes: [...scopes, ...ctx.scopes],
    })
  }
  private members(
    scope: string,
    ctx: Context,
    seen = new Set<string>()
  ): ApiSymbol[] {
    scope = this.canonical(scope)
    if (seen.has(scope)) return []
    seen.add(scope)
    const direct = [
      ...(this.byScope.get(scope) ?? []),
      ...ctx.symbols.filter(
        (s) => this.canonical(s.scope) === scope && s.start === undefined
      ),
    ]
    const type = this.lookup(scope, ctx).at(0)
    const inherited = (type?.bases ?? []).flatMap((base) =>
      this.members(
        this.typeScope(base, {
          ...ctx,
          scopes: [type?.scope ?? "", ...ctx.scopes],
        }),
        ctx,
        seen
      )
    )
    return [
      ...direct,
      ...inherited.filter((s) => !direct.some((d) => d.name === s.name)),
    ]
  }
  private expressionStart(tokens: Token[], end = tokens.length) {
    let depth = 0
    let closing = -1
    for (let i = end - 1; i >= 0; i--) {
      const value = tokens[i].value
      if ([")", "]"].includes(value)) {
        if (!depth) closing = i
        depth++
      } else if (["(", "["].includes(value)) {
        if (!depth) return i + 1
        depth--
        if (
          !depth &&
          value === "(" &&
          ["if", "while", "for", "switch", "catch"].includes(
            tokens[i - 1]?.value
          )
        )
          return closing + 1
      } else if (
        !depth &&
        [
          ";",
          "{",
          "}",
          ",",
          "=",
          "+",
          "-",
          "!",
          "==",
          "!=",
          "&&",
          "||",
          "return",
          "else",
        ].includes(value)
      )
        return i + 1
    }
    return 0
  }
  private resolve(tokens: Token[], ctx: Context, depth = 0): ApiSymbol[] {
    if (!tokens.length || depth > 12) return []
    if (["&", "*"].includes(tokens[0].value))
      return this.resolve(tokens.slice(1), ctx, depth + 1)
    const last = tokens.at(-1)!.value
    if ([")", "]"].includes(last)) {
      let balance = 1,
        open = tokens.length - 2
      const opening = last === ")" ? "(" : "["
      for (; open >= 0; open--) {
        if (tokens[open].value === last) balance++
        if (tokens[open].value === opening && --balance === 0) break
      }
      if (open < 0) return []
      if (open === 0) return this.resolve(tokens.slice(1, -1), ctx, depth + 1)
      const values = this.resolve(tokens.slice(0, open), ctx, depth + 1)
      if (last === "]")
        return values.map((s) => ({
          ...s,
          type:
            /<(.+)>/.exec(s.type)?.[1].split(",")[0] ??
            s.type.replace(/\[[^\]]*\]/g, ""),
        }))
      return values.map((s) =>
        s.parameters
          ? { ...s, kind: 6 }
          : [7, 22].includes(s.kind)
            ? { ...s, type: qualified(s), kind: 6 }
            : s
      )
    }
    let balance = 0
    for (let i = tokens.length - 1; i >= 0; i--) {
      const value = tokens[i].value
      if ([")", "]", ">"].includes(value)) balance++
      else if (["(", "[", "<"].includes(value)) balance--
      else if (!balance && [".", "->", "::"].includes(value)) {
        const receivers = this.resolve(tokens.slice(0, i), ctx, depth + 1)
        const member = joinTokens(tokens.slice(i + 1))
        return receivers.flatMap((s) =>
          this.members(
            [7, 9, 13, 22].includes(s.kind)
              ? s.alias
                ? this.typeScope(s.alias, ctx)
                : this.canonical(qualified(s))
              : this.symbolType(s, ctx),
            ctx
          ).filter((m) => m.name === member)
        )
      }
    }
    const name = joinTokens(tokens)
    const found = this.lookup(name, ctx)
    return found.map((s) =>
      /^auto[&*]*$/.test(s.type) && s.alias
        ? (this.resolve(codeTokens(s.alias), ctx, depth + 1)[0] ?? s)
        : s
    )
  }
  private callContext(ctx: Context) {
    const tokens = codeTokens(ctx.text.slice(0, ctx.offset))
    const stack: { index: number; parameter: number; close: string }[] = []
    for (let i = 0; i < tokens.length; i++) {
      const value = tokens[i].value
      if (["(", "[", "{"].includes(value))
        stack.push({
          index: i,
          parameter: 0,
          close: { "(": ")", "[": "]", "{": "}" }[value]!,
        })
      else if (stack.at(-1)?.close === value) stack.pop()
      else if (value === "," && stack.length)
        stack[stack.length - 1].parameter++
    }
    const call = [...stack]
      .reverse()
      .find(
        (s) =>
          s.close === ")" &&
          !["if", "while", "for", "switch", "sizeof"].includes(
            tokens[s.index - 1]?.value
          )
      )
    if (!call) return null
    const expression = tokens.slice(
      this.expressionStart(tokens, call.index),
      call.index
    )
    let symbols = this.resolve(expression, ctx)
    symbols = symbols.flatMap((s) =>
      [7, 22].includes(s.kind)
        ? this.members(qualified(s), ctx).filter((m) => m.kind === 4)
        : s
    )
    return { ...call, symbols: symbols.filter((s) => s.parameters), tokens }
  }
  private item(
    symbol: ApiSymbol,
    ctx: Context,
    insertion = symbol.name
  ): CompletionItem {
    const suffix = /^[A-Za-z0-9_]*/.exec(ctx.text.slice(ctx.offset))![0]
    const next = ctx.text.slice(ctx.offset + suffix.length).trimStart()
    const callable = symbol.parameters !== undefined
    const params = symbol.parameters ?? []
    const insertText =
      callable && !next.startsWith("(")
        ? `${insertion}(${params.length ? "$0" : ""})`
        : insertion
    return {
      label: symbol.name,
      filterText: symbol.name,
      labelDetails: {
        detail: callable
          ? `(${params.map((p) => p.label).join(", ")})`
          : undefined,
        description: symbol.scope,
      },
      kind: symbol.kind,
      detail: signature(symbol),
      documentation: symbol.documentation,
      insertText,
      insertTextFormat: callable ? 2 : 1,
      textEdit: { range: ctx.replacement, newText: insertText },
      retrigger: callable && params.length > 0,
    }
  }
  complete(path: string, position: Position): CompletionList {
    const ctx = this.context(path, position)
    const empty = { isIncomplete: false, items: [] }
    if (!ctx) return empty
    const token = tokenize(ctx.text).find(
      (t) => t.start < ctx.offset && t.end >= ctx.offset
    )
    const line = ctx.text.slice(
      ctx.text.lastIndexOf("\n", ctx.offset - 1) + 1,
      ctx.offset
    )
    const include = /^\s*#\s*include\s*[<"]([^>"]*)$/.exec(line)
    if (include) {
      const prefix = include[1]
      const start = ctx.offset - prefix.length
      const headers = [...this.database.headers, ...this.files.keys()].filter(
        (p) => p !== path
      )
      return {
        isIncomplete: false,
        items: [...new Set(headers)]
          .filter((p) => p.startsWith(prefix))
          .map((name) => ({
            label: name,
            filterText: name.slice(
              prefix.length - (/[A-Za-z0-9_]*$/.exec(prefix)?.[0].length ?? 0)
            ),
            kind: 17,
            textEdit: {
              range: {
                start: positionAt(ctx.text, start),
                end: positionAt(ctx.text, ctx.offset),
              },
              newText: name,
            },
          })),
      }
    }
    if (token && ["comment", "literal", "directive"].includes(token.kind))
      return empty
    const before = ctx.text.slice(0, ctx.offset).replace(/[A-Za-z_][\w]*$/, "")
    const tokens = codeTokens(before)
    const operator = tokens.at(-1)?.value
    if (operator && [".", "->", "::"].includes(operator)) {
      const expression = tokens.slice(
        this.expressionStart(tokens, tokens.length - 1),
        -1
      )
      const receivers = this.resolve(expression, ctx)
      const symbols = receivers.flatMap((s) =>
        this.members(
          [7, 9, 13, 22].includes(s.kind)
            ? s.alias
              ? this.typeScope(s.alias, ctx)
              : this.canonical(qualified(s))
            : this.symbolType(s, ctx),
          ctx
        )
      )
      return {
        isIncomplete: false,
        items: this.unique(
          symbols.filter(
            (s) =>
              s.kind !== 4 &&
              (operator === "::" || ![7, 9, 13, 22].includes(s.kind))
          )
        ).map((s) => this.item(s, ctx)),
      }
    }
    const call = this.callContext(ctx)
    if (call) {
      const parameters = call.symbols.flatMap(
        (s) => s.parameters?.[call.parameter] ?? []
      )
      const choices = parameters.flatMap((p) => {
        const owner = call.symbols.find((s) => s.parameters?.includes(p))!
        const scope = this.symbolType({ ...owner, type: p.type }, ctx)
        const type = this.lookup(scope, ctx).at(0)
        if (type?.kind !== 13) {
          if (!type || ![7, 22].includes(type.kind)) return []
          return ctx.symbols
            .filter(
              (symbol) =>
                [5, 6].includes(symbol.kind) &&
                this.symbolType(symbol, ctx) === scope
            )
            .map((symbol) => this.item(symbol, ctx))
        }
        return this.members(scope, ctx)
          .filter((s) => s.kind === 20)
          .map((s) => {
            const parent = scope.includes("::")
              ? scope.slice(0, scope.lastIndexOf("::"))
              : ""
            const insertion = type.scoped
              ? `${scope}::${s.name}`
              : ctx.scopes.includes(parent)
                ? s.name
                : `${parent ? parent + "::" : ""}${s.name}`
            return this.item(s, ctx, insertion)
          })
      })
      if (choices.length)
        return { isIncomplete: false, items: this.uniqueItems(choices) }
    }
    const visible = [
      ...ctx.symbols.filter(
        (s) =>
          ctx.scopes.includes(s.scope) &&
          (s.path !== path || s.offset === undefined || s.offset <= ctx.offset)
      ),
      ...this.api.filter((s) => ctx.scopes.includes(s.scope)),
    ]
    const globals = this.unique(visible.filter((s) => s.kind !== 4)).map((s) =>
      this.item(s, ctx)
    )
    return {
      isIncomplete: false,
      items: [
        ...globals,
        ...keywords.map((label) => ({ label, kind: 14 })),
        ...snippets,
      ],
    }
  }
  signatures(path: string, position: Position): SignatureHelp | null {
    const ctx = this.context(path, position)
    if (!ctx) return null
    const call = this.callContext(ctx)
    if (!call?.symbols.length) return null
    const symbols = this.unique(call.symbols)
    const best = symbols.findIndex(
      (s) => (s.parameters?.length ?? 0) > call.parameter
    )
    return {
      activeParameter: call.parameter,
      activeSignature: Math.max(0, best),
      signatures: symbols.map((s) => ({
        label: signature(s),
        documentation: s.documentation,
        parameters: s.parameters?.map((p) => ({ label: p.label })),
      })),
    }
  }
  symbolAt(path: string, position: Position) {
    const ctx = this.context(path, position)
    if (!ctx) return []
    const tokens = codeTokens(ctx.text)
    const at = tokens.findIndex(
      (t) => t.start <= ctx.offset && t.end >= ctx.offset && t.kind === "word"
    )
    if (at < 0) return []
    const expression = tokens.slice(
      this.expressionStart(tokens, at + 1),
      at + 1
    )
    const resolved = this.resolve(expression, ctx)
    return resolved.length ? resolved : this.lookup(tokens[at].value, ctx)
  }
  describe(path: string, position: Position) {
    return this.unique(this.symbolAt(path, position))
      .map(
        (s) =>
          `\`\`\`cpp\n${signature(s)}\n\`\`\`${s.documentation ? `\n\n${s.documentation}` : ""}`
      )
      .join("\n\n")
  }
  private unique(symbols: ApiSymbol[]) {
    const seen = new Set<string>()
    return symbols.filter((s) => {
      const key = `${s.scope}:${s.name}:${s.parameters?.map((p) => p.type).join(",") ?? s.kind}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
  private uniqueItems(items: CompletionItem[]) {
    return items.filter(
      (s, i) =>
        items.findIndex((other) => other.insertText === s.insertText) === i
    )
  }
}
