import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { useAction, useQuery } from "convex/react"
import { FileCodeIcon, XIcon } from "@phosphor-icons/react"
import { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
import { overlaySearch, type SearchFile } from "@v5x/backend/search"
import { Button } from "@v5x/ui/components/button"
import { Input } from "@v5x/ui/components/input"
import { Sheet, SheetContent, SheetClose } from "@v5x/ui/components/sheet"
import {
  getFiletypeFromFileName,
  getSharedHighlighter,
  type DiffsHighlighter,
} from "@pierre/diffs"
import { editorThemeOptions } from "@/lib/editor-theme"
import { errorMessage } from "@/lib/errors"
import type { WorkbenchSource } from "@/lib/workbench-source"

function SearchSnippet({
  path,
  match,
}: {
  path: string
  match: SearchFile["matches"][number]
}) {
  const [highlighter, setHighlighter] = useState<DiffsHighlighter | null>(null)
  const lang = getFiletypeFromFileName(path)
  useEffect(() => {
    let cancelled = false
    void getSharedHighlighter({
      themes: [editorThemeOptions.theme.dark],
      langs: [lang],
      preferredHighlighter: editorThemeOptions.preferredHighlighter,
    })
      .then((value) => {
        if (!cancelled) setHighlighter(value)
      })
      .catch(() => {
        /* Keep plain text available for unsupported grammars. */
      })
    return () => {
      cancelled = true
    }
  }, [lang])
  const tokens = useMemo(() => {
    if (highlighter) {
      try {
        return (
          highlighter.codeToTokens(match.text, {
            lang,
            theme: editorThemeOptions.theme.dark,
          }).tokens[0] ?? []
        )
      } catch {
        /* Fall back while the grammar loads. */
      }
    }
    return [{ content: match.text, offset: 0 }]
  }, [highlighter, lang, match.text])
  let offset = 0
  return (
    <span className="min-w-0 flex-1 truncate whitespace-pre" title={match.text}>
      {tokens.map((token, index) => {
        const start = offset
        offset += token.content.length
        const boundaries = [
          start,
          ...[match.start, match.end].filter(
            (value) => value > start && value < offset
          ),
          offset,
        ]
        return (
          <span
            key={index}
            style={{
              color: token.color,
              fontStyle:
                token.fontStyle && token.fontStyle & 1 ? "italic" : undefined,
              fontWeight:
                token.fontStyle && token.fontStyle & 2 ? "bold" : undefined,
            }}
          >
            {boundaries.slice(0, -1).map((boundary, part) => {
              const text = token.content.slice(
                boundary - start,
                boundaries[part + 1] - start
              )
              return boundary >= match.start && boundary < match.end ? (
                <mark
                  key={part}
                  className="rounded-sm bg-primary/20 text-inherit"
                >
                  {text}
                </mark>
              ) : (
                text
              )
            })}
          </span>
        )
      })}
    </span>
  )
}

const subscribeToNothing = () => () => {}

type Results = { files: SearchFile[]; truncated: boolean; skipped: number }
export function ProgramSearchPanel({
  programId,
  revision,
  drafts,
  onSelect,
  open,
  onOpenChange,
  input,
}: {
  programId: Id<"programs">
  revision?: string
  drafts: Pick<
    WorkbenchSource,
    "getDrafts" | "subscribeDrafts" | "getDraftVersion" | "replaceMatches"
  >
  onSelect: (path: string, line: number, column: number) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  input: React.RefObject<HTMLInputElement | null>
}) {
  const setOpen = onOpenChange
  const [query, setQuery] = useState("")
  const [sourceOnly, setSourceOnly] = useState(false)
  const [pathFilter, setPathFilter] = useState("")
  const [matchCase, setMatchCase] = useState(false)
  const [replacement, setReplacement] = useState("")
  const [replacing, setReplacing] = useState(false)
  const [replaceMessage, setReplaceMessage] = useState<string | null>(null)
  const [excluded, setExcluded] = useState<{ scope: string; keys: string[] }>({
    scope: "",
    keys: [],
  })
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<Results | null>(null)
  const [resultKey, setResultKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const resultsId = useId()
  const resultButtons = useRef(new Map<string, HTMLButtonElement>())
  const [selection, setSelection] = useState<{
    scope: string
    key: string
  } | null>(null)
  const pendingJump = useRef<{
    path: string
    line: number
    column: number
  } | null>(null)
  const search = useAction(api.codeStorage.searchProgram)
  const documents = useQuery(
    api.search.liveDocuments,
    open ? { programId } : "skip"
  )
  const liveRevision = JSON.stringify(documents)
  const searchKey = JSON.stringify([
    programId,
    query,
    matchCase,
    sourceOnly,
    pathFilter,
    revision,
    liveRevision,
  ])
  // Drafts only matter while the panel is open, so typing elsewhere does not rerender it.
  const draftVersion = useSyncExternalStore(
    open ? drafts.subscribeDrafts : subscribeToNothing,
    drafts.getDraftVersion
  )
  useEffect(() => {
    let cancelled = false
    setResult(null)
    setResultKey(null)
    setError(null)
    setLoading(open && Boolean(query))
    if (!open || !query) return
    const timer = window.setTimeout(() => {
      void search({ programId, query, matchCase, sourceOnly, pathFilter })
        .then((value) => {
          if (!cancelled) {
            setResult(value)
            setResultKey(searchKey)
          }
        })
        .catch((reason) => {
          if (!cancelled) setError(errorMessage(reason))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    open,
    programId,
    query,
    matchCase,
    sourceOnly,
    pathFilter,
    revision,
    liveRevision,
    retry,
    search,
    searchKey,
  ])
  const merged = useMemo(
    () =>
      overlaySearch(result?.files ?? [], drafts.getDrafts(), query, matchCase, {
        sourceOnly,
        pathFilter,
      }),
    [result, drafts, query, matchCase, sourceOnly, pathFilter, draftVersion]
  )
  const matches = merged.files.flatMap((file) =>
    file.matches.map((match) => ({
      path: file.path,
      ...match,
      key: JSON.stringify([file.path, match.line, match.column]),
    }))
  )
  const count = matches.length
  const scope = JSON.stringify([query, matchCase, sourceOnly, pathFilter])
  const excludedKeys = new Set(excluded.scope === scope ? excluded.keys : [])
  const selectedMatches = matches.filter(
    (match) => !excludedKeys.has(match.key)
  )
  const canReplace = Boolean(
    query &&
    result &&
    resultKey === searchKey &&
    !loading &&
    !error &&
    !result.skipped &&
    !result.truncated &&
    !merged.truncated &&
    selectedMatches.length &&
    !replacing
  )
  async function replaceSelected() {
    if (!canReplace) return
    const groups = new Map<string, typeof selectedMatches>()
    for (const match of selectedMatches)
      groups.set(match.path, [...(groups.get(match.path) ?? []), match])
    let applied = 0
    setReplacing(true)
    setReplaceMessage(null)
    try {
      for (const [path, items] of groups) {
        await drafts.replaceMatches(path, items, replacement)
        applied += items.length
      }
      setReplaceMessage(
        `Replaced ${applied} ${applied === 1 ? "match" : "matches"}.`
      )
    } catch (failure) {
      setReplaceMessage(
        `${applied ? `Replaced ${applied} matches. ` : ""}${errorMessage(failure)}`
      )
    } finally {
      setReplacing(false)
      setExcluded({ scope: "", keys: [] })
      setRetry((value) => value + 1)
    }
  }
  const selectedIndex =
    selection?.scope === scope
      ? matches.findIndex((match) => match.key === selection.key)
      : -1
  const selected = matches.at(selectedIndex < 0 ? 0 : selectedIndex)
  useEffect(() => {
    if (open && selected)
      resultButtons.current
        .get(selected.key)
        ?.scrollIntoView({ block: "nearest" })
  }, [open, selected?.key])
  function openMatch(target: { path: string; line: number; column: number }) {
    pendingJump.current = target
    setOpen(false)
  }
  return (
    <>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(value) => {
          if (value) input.current?.focus()
          else if (pendingJump.current) {
            const target = pendingJump.current
            pendingJump.current = null
            onSelect(target.path, target.line, target.column)
          }
        }}
      >
        <SheetContent
          side="right"
          aria-label="Search program"
          showCloseButton={false}
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey
            )
              return
            const target = event.target as HTMLElement
            if (
              target !== input.current &&
              !target.closest("[data-search-result]")
            )
              return
            if (!matches.length) return
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              const direction = event.key === "ArrowDown" ? 1 : -1
              const index =
                selectedIndex < 0
                  ? direction > 0
                    ? 0
                    : matches.length - 1
                  : Math.max(
                      0,
                      Math.min(matches.length - 1, selectedIndex + direction)
                    )
              const next = matches[index]
              setSelection({ scope, key: next.key })
              if (target !== input.current)
                resultButtons.current.get(next.key)?.focus()
            } else if (
              event.key === "Enter" &&
              selected &&
              target === input.current
            ) {
              event.preventDefault()
              openMatch(selected)
            }
          }}
          className="gap-0 font-serif data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        >
          <div className="space-y-3 border-b p-4">
            <div className="flex items-center gap-2">
              <Input
                ref={input}
                value={query}
                disabled={replacing}
                maxLength={200}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search for text…"
                aria-label="Search text"
                aria-controls={resultsId}
                aria-describedby={`${resultsId}-help`}
                className="font-mono"
              />
              <Button
                variant={matchCase ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label="Match case"
                aria-pressed={matchCase}
                disabled={replacing}
                onClick={() => setMatchCase((value) => !value)}
                className="shrink-0 font-mono"
              >
                Aa
              </Button>
              <SheetClose
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    aria-label="Close search"
                  />
                }
              >
                <XIcon />
              </SheetClose>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={replacement}
                disabled={replacing}
                onChange={(event) => setReplacement(event.target.value)}
                placeholder="Replace with…"
                aria-label="Replace with"
                className="font-mono"
              />
              <Button
                size="sm"
                disabled={!canReplace}
                onClick={() => void replaceSelected()}
              >
                {replacing
                  ? "Replacing…"
                  : `${replacement ? "Replace" : "Delete"} selected (${selectedMatches.length})`}
              </Button>
            </div>
            {replaceMessage && (
              <p role="status" className="text-xs text-muted-foreground">
                {replaceMessage}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="Search scope"
                className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border p-0.5"
              >
                <Button
                  size="xs"
                  variant={sourceOnly ? "ghost" : "secondary"}
                  aria-pressed={!sourceOnly}
                  onClick={() => setSourceOnly(false)}
                  disabled={replacing}
                >
                  All files
                </Button>
                <Button
                  size="xs"
                  variant={sourceOnly ? "secondary" : "ghost"}
                  aria-pressed={sourceOnly}
                  onClick={() => setSourceOnly(true)}
                  disabled={replacing}
                  title="Source and header files, excluding bundled libraries"
                >
                  Source files
                </Button>
              </div>
              <Input
                value={pathFilter}
                disabled={replacing}
                onChange={(event) => setPathFilter(event.target.value)}
                maxLength={200}
                aria-label="Filter by path"
                placeholder="Path: src/ or *.cpp"
                className="min-w-36 flex-1 font-mono text-xs"
              />
            </div>
            {query && (
              <p
                className="text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                {loading
                  ? "Searching…"
                  : error
                    ? "Search could not finish"
                    : `${count} ${count === 1 ? "match" : "matches"} in ${merged.files.length} ${merged.files.length === 1 ? "file" : "files"}`}
              </p>
            )}
            {count > 0 && (
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>Check the matches you want to replace.</span>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={replacing}
                  onClick={() =>
                    setExcluded({
                      scope,
                      keys: selectedMatches.length
                        ? matches.map((match) => match.key)
                        : [],
                    })
                  }
                >
                  {selectedMatches.length ? "Deselect all" : "Select all"}
                </Button>
              </div>
            )}
          </div>
          <p id={`${resultsId}-help`} className="sr-only">
            Use the up and down arrow keys to select a match. Press Enter to
            open it.
          </p>
          <div
            className="min-h-0 flex-1 overflow-y-auto p-2"
            aria-busy={loading}
          >
            {!query && (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                Enter text to find it anywhere in this program.
              </p>
            )}
            {error && (
              <div className="space-y-3 p-4 text-sm">
                <p className="text-destructive">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  Try again
                </Button>
              </div>
            )}
            {query && !loading && !error && count === 0 && (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                No matches. Try a different search.
              </p>
            )}
            <div id={resultsId} role="region" aria-label="Search results">
              {merged.files.map((file) => (
                <section
                  key={file.path}
                  role="group"
                  aria-label={file.path}
                  className="mb-3"
                >
                  <h3 className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                    <FileCodeIcon className="shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {file.path}
                    </span>
                    <span className="ml-auto shrink-0 tabular-nums">
                      {file.matches.length}
                    </span>
                  </h3>
                  {file.matches.map((match) => {
                    const key = JSON.stringify([
                      file.path,
                      match.line,
                      match.column,
                    ])
                    return (
                      <div key={key} className="flex items-start gap-1">
                        <input
                          type="checkbox"
                          aria-label={`Select match in ${file.path} at line ${match.line}, column ${match.column}`}
                          checked={!excludedKeys.has(key)}
                          disabled={replacing}
                          onChange={(event) =>
                            setExcluded({
                              scope,
                              keys: event.target.checked
                                ? [...excludedKeys].filter(
                                    (item) => item !== key
                                  )
                                : [...excludedKeys, key],
                            })
                          }
                          className="mt-2.5 accent-primary"
                        />
                        <button
                          type="button"
                          data-search-result=""
                          id={`${resultsId}-${matches.findIndex((item) => item.path === file.path && item.line === match.line && item.column === match.column)}`}
                          data-selected={
                            selected?.path === file.path &&
                            selected.line === match.line &&
                            selected.column === match.column
                          }
                          aria-current={
                            selected?.path === file.path &&
                            selected.line === match.line &&
                            selected.column === match.column
                              ? "true"
                              : undefined
                          }
                          ref={(element) => {
                            const buttonKey = JSON.stringify([
                              file.path,
                              match.line,
                              match.column,
                            ])
                            if (element)
                              resultButtons.current.set(buttonKey, element)
                            else resultButtons.current.delete(buttonKey)
                          }}
                          onFocus={() =>
                            setSelection({
                              scope,
                              key: JSON.stringify([
                                file.path,
                                match.line,
                                match.column,
                              ]),
                            })
                          }
                          className="flex w-full items-baseline gap-3 rounded-md px-3 py-2 text-left font-mono text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-ring data-[selected=true]:bg-primary/10 data-[selected=true]:ring-1 data-[selected=true]:ring-primary/40 data-[selected=true]:ring-inset"
                          onClick={() =>
                            openMatch({
                              path: file.path,
                              line: match.line,
                              column: match.column,
                            })
                          }
                        >
                          <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">
                            {match.line}
                          </span>
                          <SearchSnippet path={file.path} match={match} />
                        </button>
                      </div>
                    )
                  })}
                </section>
              ))}
            </div>
          </div>
          {(merged.truncated ||
            result?.truncated ||
            Boolean(result?.skipped)) && (
            <p className="border-t p-4 text-xs text-muted-foreground">
              {merged.truncated || result?.truncated
                ? "Showing up to 300 matches. Narrow your search before replacing. "
                : ""}
              {result?.skipped
                ? `${result.skipped} live files could not be searched. Try again after syncing before replacing.`
                : ""}
            </p>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
