import { useContext, useState, useSyncExternalStore } from "react"
import { Input } from "@v5x/ui/components/input"
import "@vscode/codicons/dist/codicon.css"
import {
  DefinitionContext,
  useLanguageService,
} from "@/components/editor/language-session"

// Match the symbol icons and colors used by the editor completion menu.
const SYMBOL_ICONS: Partial<Record<number, [string, string?]>> = {
  2: ["symbol-method", "#b180d7"],
  3: ["symbol-method", "#b180d7"],
  4: ["symbol-method", "#b180d7"],
  5: ["symbol-field", "#75beff"],
  6: ["symbol-variable", "#75beff"],
  7: ["symbol-class", "#ee9d28"],
  8: ["symbol-interface", "#75beff"],
  9: ["symbol-namespace"],
  10: ["symbol-property"],
  12: ["symbol-enum", "#ee9d28"],
  13: ["symbol-enum", "#ee9d28"],
  20: ["symbol-enum-member", "#75beff"],
  21: ["symbol-constant"],
  22: ["symbol-structure"],
  23: ["symbol-event", "#ee9d28"],
  24: ["symbol-operator"],
  25: ["symbol-type-parameter"],
}

const emptySubscribe = () => () => {}
const zero = () => 0

export function ProgramSymbols() {
  const client = useLanguageService()
  const navigate = useContext(DefinitionContext)
  const [query, setQuery] = useState("")
  useSyncExternalStore(
    client?.subscribeSymbols ?? emptySubscribe,
    client?.getSymbolVersion ?? zero,
    zero
  )
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const symbols = (client?.programSymbols() ?? [])
    .filter(
      (symbol) =>
        symbol.path &&
        symbol.position &&
        terms.every((term) =>
          `${symbol.scope} ${symbol.name} ${symbol.path}`
            .toLowerCase()
            .includes(term)
        )
    )
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        (a.path ?? "").localeCompare(b.path ?? "") ||
        (a.position?.line ?? 0) - (b.position?.line ?? 0)
    )
  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-label="Program symbols"
    >
      <div className="px-3 pt-3 pb-3">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search symbols…"
          aria-label="Search symbols"
        />
      </div>
      <div className="min-h-0 overflow-y-auto" aria-label="Symbol results">
        {client?.error && (
          <p className="p-4 text-sm text-destructive">
            Some symbols could not be loaded: {client.error}
          </p>
        )}
        {(!client?.isReady && !client?.error) || client.sourceLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading symbols…</p>
        ) : symbols.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No symbols found.</p>
        ) : (
          symbols.map((symbol, index) => (
            <button
              key={`${symbol.path}:${symbol.position!.line}:${symbol.position!.character}:${index}`}
              className="flex h-8 w-full items-center gap-2 px-4 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              onClick={() => {
                navigate?.(
                  symbol.path!,
                  symbol.position!.line + 1,
                  symbol.position!.character + 1
                )
              }}
            >
              <span
                aria-hidden="true"
                className={`codicon codicon-${(SYMBOL_ICONS[symbol.kind] ?? ["symbol-variable"])[0]} shrink-0`}
                style={{ color: SYMBOL_ICONS[symbol.kind]?.[1] }}
              />
              <span className="min-w-0 truncate">
                {symbol.name}
                {symbol.parameters ? "()" : ""}
              </span>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {symbol.scope && `${symbol.scope} · `}
                {symbol.path}:{symbol.position!.line + 1}
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  )
}
