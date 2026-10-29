import { useContext, useRef, useState, useSyncExternalStore } from "react"
import { ListMagnifyingGlassIcon, XIcon } from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Sheet, SheetClose, SheetContent } from "@workspace/ui/components/sheet"
import { ActionTooltip } from "@/components/shared/action-tooltip"
import {
  DefinitionContext,
  useLanguageService,
} from "@/components/editor/language-session"

const emptySubscribe = () => () => {}
const zero = () => 0

export function ProgramSymbols() {
  const client = useLanguageService()
  const navigate = useContext(DefinitionContext)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const pending = useRef<{ path: string; line: number; column: number } | null>(
    null
  )
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
    <>
      <ActionTooltip label="Program symbols">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Program symbols"
          onClick={() => setOpen(true)}
        >
          <ListMagnifyingGlassIcon />
        </Button>
      </ActionTooltip>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(value) => {
          if (!value && pending.current) {
            const target = pending.current
            pending.current = null
            navigate?.(target.path, target.line, target.column)
          }
        }}
      >
        <SheetContent
          side="right"
          aria-label="Program symbols"
          showCloseButton={false}
        >
          <div className="flex items-center gap-2 border-b p-4">
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search symbols…"
              aria-label="Search symbols"
            />
            <SheetClose
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close symbols"
                />
              }
            >
              <XIcon />
            </SheetClose>
          </div>
          <div className="min-h-0 overflow-y-auto" aria-label="Symbol results">
            {client?.error && (
              <p className="p-4 text-sm text-destructive">
                Some symbols could not be loaded: {client.error}
              </p>
            )}
            {(!client?.isReady && !client?.error) || client.sourceLoading ? (
              <p className="p-4 text-sm text-muted-foreground">
                Loading symbols…
              </p>
            ) : symbols.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No symbols found.
              </p>
            ) : (
              symbols.map((symbol, index) => (
                <button
                  key={`${symbol.path}:${symbol.position!.line}:${symbol.position!.character}:${index}`}
                  className="flex w-full flex-col gap-1 border-b px-4 py-3 text-left hover:bg-accent focus-visible:bg-accent"
                  onClick={() => {
                    pending.current = {
                      path: symbol.path!,
                      line: symbol.position!.line + 1,
                      column: symbol.position!.character + 1,
                    }
                    setOpen(false)
                  }}
                >
                  <span className="text-sm font-medium">
                    {symbol.scope ? `${symbol.scope}::` : ""}
                    {symbol.name}
                    {symbol.parameters
                      ? `(${symbol.parameters.map((parameter) => parameter.label).join(", ")})`
                      : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {symbol.path}:{symbol.position!.line + 1}
                  </span>
                </button>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
