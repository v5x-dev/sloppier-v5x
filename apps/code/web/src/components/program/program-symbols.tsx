import { useContext, useState, useSyncExternalStore } from "react"
import { CaretRightIcon } from "@phosphor-icons/react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@v5x/ui/components/collapsible"
import { Input } from "@v5x/ui/components/input"
import { ScrollArea } from "@v5x/ui/components/scroll-area"
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
        (a.path ?? "").localeCompare(b.path ?? "") ||
        a.name.localeCompare(b.name) ||
        (a.position?.line ?? 0) - (b.position?.line ?? 0)
    )
  const files = new Map<string, typeof symbols>()
  for (const symbol of symbols) {
    const path = symbol.path!
    const group = files.get(path) ?? []
    group.push(symbol)
    files.set(path, group)
  }
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
      <ScrollArea className="min-h-0 flex-1" aria-label="Symbol results">
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
          [...files].map(([path, fileSymbols]) => (
            <Collapsible key={path} defaultOpen>
              <CollapsibleTrigger className="group flex w-full items-center gap-1 px-3 pt-2 pb-1 text-left font-mono text-xs text-muted-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                <CaretRightIcon className="size-3 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
                <span className="min-w-0 break-all">{path}</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                {fileSymbols.map((symbol, index) => (
                  <button
                    key={`${symbol.path}:${symbol.position!.line}:${symbol.position!.character}:${index}`}
                    className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
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
                    <span className="min-w-0 flex-1 break-all">
                      {symbol.name}
                      {symbol.parameters ? "()" : ""}
                      {symbol.scope && (
                        <span className="block text-muted-foreground">
                          {symbol.scope}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-muted-foreground">
                      {symbol.position!.line + 1}
                    </span>
                  </button>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ))
        )}
      </ScrollArea>
    </section>
  )
}
