import { useEffect, useMemo, useRef, useState } from "react"
import { useAction, useQuery } from "convex/react"
import { MagnifyingGlassIcon, FileCodeIcon, XIcon } from "@phosphor-icons/react"
import { api } from "@workspace/backend/api"
import type { Id } from "@workspace/backend/dataModel"
import { overlaySearch, type SearchFile } from "@workspace/backend/search"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Sheet, SheetContent, SheetClose } from "@workspace/ui/components/sheet"
import {
  getFiletypeFromFileName,
  getSharedHighlighter,
  type DiffsHighlighter,
} from "@pierre/diffs"
import { editorThemeOptions } from "@/lib/editor-theme"
import { errorMessage } from "@/lib/errors"

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

type Results = { files: SearchFile[]; truncated: boolean; skipped: number }
export function ProgramSearch({
  projectId,
  revision,
  getDrafts,
  subscribeDrafts,
  onSelect,
}: {
  projectId: Id<"projects">
  revision?: string
  getDrafts: () => ReadonlyMap<string, string>
  subscribeDrafts: (listener: () => void) => () => void
  onSelect: (path: string, line: number, column: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [sourceOnly, setSourceOnly] = useState(false)
  const [pathFilter, setPathFilter] = useState("")
  const [matchCase, setMatchCase] = useState(false)
  const [version, setVersion] = useState(0)
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<Results | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const pendingJump = useRef<{
    path: string
    line: number
    column: number
  } | null>(null)
  const search = useAction(api.codeStorage.searchProject)
  const documents = useQuery(
    api.search.liveDocuments,
    open ? { projectId } : "skip"
  )
  const liveRevision = JSON.stringify(documents)
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault()
        setOpen(true)
        input.current?.focus()
      }
    }
    window.addEventListener("keydown", shortcut)
    return () => window.removeEventListener("keydown", shortcut)
  }, [])
  useEffect(() => {
    if (!open) return
    setVersion((v) => v + 1)
    return subscribeDrafts(() => setVersion((v) => v + 1))
  }, [open, subscribeDrafts])
  useEffect(() => {
    let cancelled = false
    setResult(null)
    setError(null)
    setLoading(open && Boolean(query))
    if (!open || !query) return
    const timer = window.setTimeout(() => {
      void search({ projectId, query, matchCase, sourceOnly, pathFilter })
        .then((value) => {
          if (!cancelled) setResult(value)
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
    projectId,
    query,
    matchCase,
    sourceOnly,
    pathFilter,
    revision,
    liveRevision,
    retry,
    search,
  ])
  const merged = useMemo(
    () =>
      overlaySearch(result?.files ?? [], getDrafts(), query, matchCase, {
        sourceOnly,
        pathFilter,
      }),
    [result, getDrafts, query, matchCase, sourceOnly, pathFilter, version]
  )
  const count = merged.files.reduce((sum, file) => sum + file.matches.length, 0)
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Search project"
        title="Search project (Ctrl/Cmd+Shift+F)"
        onClick={() => setOpen(true)}
      >
        <MagnifyingGlassIcon />
      </Button>
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
          aria-label="Search project"
          showCloseButton={false}
          className="gap-0 font-serif data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        >
          <div className="space-y-3 border-b p-4">
            <div className="flex items-center gap-2">
              <Input
                ref={input}
                value={query}
                maxLength={200}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search for text…"
                aria-label="Search text"
                className="font-mono"
              />
              <Button
                variant={matchCase ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label="Match case"
                aria-pressed={matchCase}
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
                >
                  All files
                </Button>
                <Button
                  size="xs"
                  variant={sourceOnly ? "secondary" : "ghost"}
                  aria-pressed={sourceOnly}
                  onClick={() => setSourceOnly(true)}
                  title="Source and header files, excluding bundled libraries"
                >
                  Source files
                </Button>
              </div>
              <Input
                value={pathFilter}
                onChange={(event) => setPathFilter(event.target.value)}
                maxLength={200}
                aria-label="Filter by path"
                placeholder="Path: src/ or *.cpp"
                className="min-w-36 flex-1 font-mono text-xs"
              />
            </div>
            <p
              className="text-xs text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              {!query
                ? "Literal text search · Ctrl/Cmd + Shift + F"
                : loading
                  ? "Searching…"
                  : error
                    ? "Search could not finish"
                    : `${count} ${count === 1 ? "match" : "matches"} in ${merged.files.length} ${merged.files.length === 1 ? "file" : "files"}`}
            </p>
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto p-2"
            aria-busy={loading}
          >
            {!query && (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                Enter text to find it anywhere in this project.
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
            {merged.files.map((file) => (
              <section key={file.path} className="mb-3">
                <h3 className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                  <FileCodeIcon className="shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {file.path}
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums">
                    {file.matches.length}
                  </span>
                </h3>
                {file.matches.map((match) => (
                  <button
                    key={`${match.line}:${match.column}`}
                    type="button"
                    className="flex w-full items-baseline gap-3 rounded-md px-3 py-2 text-left font-mono text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-ring"
                    onClick={() => {
                      pendingJump.current = {
                        path: file.path,
                        line: match.line,
                        column: match.column,
                      }
                      setOpen(false)
                    }}
                  >
                    <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">
                      {match.line}
                    </span>
                    <SearchSnippet path={file.path} match={match} />
                  </button>
                ))}
              </section>
            ))}
          </div>
          {(merged.truncated ||
            result?.truncated ||
            Boolean(result?.skipped)) && (
            <p className="border-t p-4 text-xs text-muted-foreground">
              {merged.truncated || result?.truncated
                ? "Showing up to 300 matches. Narrow your search for more specific results. "
                : ""}
              {result?.skipped
                ? `${result.skipped} live files could not be searched. Try again after syncing.`
                : ""}
            </p>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
