import { ActionTooltip } from "@/components/shared/action-tooltip"
import { format, formatDistanceToNow } from "date-fns"
import { useEffect, useMemo, useRef, useState } from "react"
import { useAction } from "convex/react"
import { api } from "@workspace/backend/api"
import type { Id } from "@workspace/backend/dataModel"
import type { FunctionReturnType } from "convex/server"
import { parsePatchFiles } from "@pierre/diffs"
import { FileDiff } from "@pierre/diffs/react"
import {
  ClockCounterClockwiseIcon,
  ArrowLeftIcon,
  ArrowClockwiseIcon,
  GitCommitIcon,
  FileCodeIcon,
} from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@workspace/ui/components/popover"
import { Spinner } from "@workspace/ui/components/spinner"
import { editorThemeOptions } from "@/lib/editor-theme"
import { errorMessage } from "@/lib/errors"

type History = FunctionReturnType<typeof api.codeStorage.history>
type Commit = History["commits"][number]
type ChangedFile = FunctionReturnType<
  typeof api.codeStorage.historyFiles
>[number]

export function ProgramHistory({
  programId,
  revision,
  canRestore,
  onRestore,
}: {
  programId: Id<"programs">
  revision?: string
  canRestore: boolean
  onRestore: (sha: string) => Promise<string | null>
}) {
  const history = useAction(api.codeStorage.history)
  const historyFiles = useAction(api.codeStorage.historyFiles)
  const historyDiff = useAction(api.codeStorage.historyDiff)
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<History | null>(null)
  const [commit, setCommit] = useState<Commit | null>(null)
  const [files, setFiles] = useState<ChangedFile[] | null>(null)
  const [file, setFile] = useState<ChangedFile | null>(null)
  const [diff, setDiff] = useState<FunctionReturnType<
    typeof api.codeStorage.historyDiff
  > | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const restoreBusy = useRef(false)
  const [result, setResult] = useState<string | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    if (!open) return
    const request = ++generation.current
    setLoading(true)
    setError(null)
    void history({ programId })
      .then((next) => {
        if (request === generation.current) setPage(next)
      })
      .catch((err) => {
        if (request === generation.current) setError(errorMessage(err))
      })
      .finally(() => {
        if (request === generation.current) setLoading(false)
      })
    return () => {
      generation.current++
    }
  }, [open, programId, revision, refresh, history])
  // Commit and file loads run from the handlers that select them, so a stale reply
  // from an earlier selection is dropped by comparing against the latest request.
  const detailRequest = useRef(0)
  async function loadDiff(
    target: Commit,
    changed: ChangedFile,
    request: number
  ) {
    try {
      const next = await historyDiff({
        programId,
        sha: target.sha,
        path: changed.path,
      })
      if (request === detailRequest.current) setDiff(next)
    } catch (err) {
      if (request === detailRequest.current) setDetailError(errorMessage(err))
    }
  }
  async function loadFiles(target: Commit) {
    const request = ++detailRequest.current
    setFiles(null)
    setFile(null)
    setDiff(null)
    setDetailError(null)
    setConfirm(false)
    setResult(null)
    try {
      const next = await historyFiles({ programId, sha: target.sha })
      if (request !== detailRequest.current) return
      setFiles(next)
      const first = next.at(0)
      setFile(first ?? null)
      if (first) await loadDiff(target, first, request)
    } catch (err) {
      if (request === detailRequest.current) setDetailError(errorMessage(err))
    }
  }
  function openCommit(next: Commit) {
    setCommit(next)
    void loadFiles(next)
  }
  function selectFile(next: ChangedFile) {
    if (!commit) return
    setFile(next)
    setDiff(null)
    setDetailError(null)
    setConfirm(false)
    setResult(null)
    void loadDiff(commit, next, ++detailRequest.current)
  }
  function reload() {
    setRefresh((current) => current + 1)
    if (commit) void loadFiles(commit)
  }
  const parsed = useMemo(() => {
    if (!diff?.raw) return []
    try {
      return parsePatchFiles(diff.raw).flatMap((patch) => patch.files)
    } catch {
      return []
    }
  }, [diff])
  async function more() {
    if (!page?.nextCursor || loading) return
    const request = generation.current
    setLoading(true)
    setError(null)
    try {
      const next = await history({ programId, cursor: page.nextCursor })
      if (generation.current === request)
        setPage((current) => ({
          ...next,
          commits: [
            ...(current?.commits ?? []),
            ...next.commits.filter(
              (item) => !current?.commits.some((old) => old.sha === item.sha)
            ),
          ],
        }))
    } catch (err) {
      if (generation.current === request) setError(errorMessage(err))
    } finally {
      if (generation.current === request) setLoading(false)
    }
  }
  async function restore() {
    if (!commit || !canRestore || restoreBusy.current) return
    restoreBusy.current = true
    setRestoring(true)
    setDetailError(null)
    try {
      const warning = await onRestore(commit.sha)
      setResult(warning ?? "Program restored in a new commit.")
      setConfirm(false)
    } catch (err) {
      setDetailError(errorMessage(err))
    } finally {
      restoreBusy.current = false
      setRestoring(false)
    }
  }
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        if (restoring) return
        setOpen(value)
        setConfirm(false)
        setResult(null)
        if (value && commit) void loadFiles(commit)
      }}
    >
      <ActionTooltip label="Program history">
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Program history"
            />
          }
        >
          <ClockCounterClockwiseIcon />
        </PopoverTrigger>
      </ActionTooltip>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={12}
        className={`${commit ? "w-[min(56rem,calc(100vw-2rem))]" : "w-96 max-w-[calc(100vw-2rem)]"} gap-0 overflow-hidden p-0 font-serif`}
      >
        <PopoverHeader className="flex-row items-center gap-2 border-b p-3">
          {commit ? (
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={restoring}
              aria-label="Back to commits"
              onClick={() => {
                detailRequest.current++
                setCommit(null)
                setDetailError(null)
                setResult(null)
                setConfirm(false)
              }}
            >
              <ArrowLeftIcon />
            </Button>
          ) : (
            <ClockCounterClockwiseIcon className="size-4 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <PopoverTitle>
              {commit ? "Commit changes" : "Program history"}
            </PopoverTitle>
            <PopoverDescription className="truncate text-xs">
              {commit ? commit.message : "Saved versions on main"}
            </PopoverDescription>
          </div>
          {commit && (
            <span className="font-mono text-xs text-muted-foreground">
              {commit.sha.slice(0, 8)}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh history"
            disabled={loading || restoring}
            onClick={reload}
          >
            <ArrowClockwiseIcon />
          </Button>
        </PopoverHeader>
        {!commit ? (
          <div className="max-h-[60svh] overflow-auto">
            {error && (
              <p role="alert" className="p-3 text-xs text-destructive">
                {error}
                <Button size="xs" variant="ghost" onClick={reload}>
                  Retry
                </Button>
              </p>
            )}
            {!page && loading && (
              <div className="flex items-center gap-2 p-6 text-xs text-muted-foreground">
                <Spinner />
                Loading commits…
              </div>
            )}
            {page?.commits.length === 0 && !loading && (
              <p className="p-6 text-sm text-muted-foreground">
                No source commits on this page.
                {page.hasMore ? " Load more to look further back." : ""}
              </p>
            )}
            <ul className="divide-y">
              {page?.commits.map((item) => (
                <li key={item.sha}>
                  <button
                    type="button"
                    className="flex w-full gap-3 p-3 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                    onClick={() => openCommit(item)}
                  >
                    <GitCommitIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-sm"
                        title={item.message}
                      >
                        {item.message}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span>{item.author}</span>
                        <time
                          dateTime={item.date}
                          title={format(
                            new Date(item.date),
                            "MMMM d, yyyy 'at' h:mm a"
                          )}
                        >
                          {formatDistanceToNow(new Date(item.date), {
                            addSuffix: true,
                          })}
                        </time>
                      </span>
                    </span>
                    <span className="mt-0.5 shrink-0 font-mono text-xs text-muted-foreground">
                      {item.sha.slice(0, 7)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {page?.hasMore && (
              <div className="border-t p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  disabled={loading || !page.nextCursor}
                  onClick={() => void more()}
                >
                  {loading ? "Loading…" : "Load more commits"}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-2 border-b px-3 py-2 text-xs text-muted-foreground">
              <span>{commit.author}</span>
              <time dateTime={commit.date}>
                {format(new Date(commit.date), "MMM d, yyyy 'at' h:mm a")}
              </time>
            </div>
            {detailError && (
              <p role="alert" className="border-b p-3 text-xs text-destructive">
                {detailError}
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={restoring}
                  onClick={reload}
                >
                  Retry
                </Button>
              </p>
            )}
            <div className="flex h-[min(55svh,32rem)] min-h-0 flex-col sm:flex-row">
              <div className="max-h-28 shrink-0 overflow-auto border-b sm:max-h-none sm:w-44 sm:border-r sm:border-b-0">
                {!files && !detailError && (
                  <div className="p-4">
                    <Spinner />
                  </div>
                )}
                {files?.length === 0 && (
                  <p className="p-3 text-xs text-muted-foreground">
                    No source files changed.
                  </p>
                )}
                {files?.map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    disabled={restoring}
                    aria-pressed={file?.path === item.path}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                    onClick={() => selectFile(item)}
                  >
                    <FileCodeIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span
                        className="block truncate font-mono"
                        title={item.path}
                      >
                        {item.path}
                      </span>
                      <span className="mt-1 block text-muted-foreground capitalize">
                        {item.state.replaceAll("_", " ")}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <div
                className="min-h-0 min-w-0 flex-1 overflow-auto bg-background"
                aria-label="Commit file diff"
              >
                {file && !diff && !detailError && (
                  <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                    <Spinner />
                    Loading diff…
                  </div>
                )}
                {diff?.message && (
                  <p className="p-4 text-xs text-muted-foreground">
                    {diff.message}
                  </p>
                )}
                {parsed.map((fileDiff, i) => (
                  <FileDiff
                    key={`${commit.sha}:${file?.path}:${i}`}
                    fileDiff={fileDiff}
                    options={{ ...editorThemeOptions, diffStyle: "unified" }}
                  />
                ))}
                {diff?.raw && !parsed.length && (
                  <pre className="p-3 font-mono text-xs whitespace-pre-wrap">
                    {diff.raw}
                  </pre>
                )}
              </div>
            </div>
            <div className="space-y-2 border-t p-3">
              {result && (
                <p role="status" className="text-xs text-muted-foreground">
                  {result}
                </p>
              )}
              {confirm ? (
                <div className="space-y-3">
                  <p className="text-xs leading-relaxed">
                    Restore all program files to commit{" "}
                    <span className="font-mono">{commit.sha.slice(0, 8)}</span>?
                    This replaces all program files, removes files added since
                    this commit, and restores deleted files. It creates a new
                    commit. Collaborators must reopen the program before
                    editing.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={restoring}
                      onClick={() => setConfirm(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={!canRestore || restoring}
                      onClick={() => void restore()}
                    >
                      {restoring && <Spinner />}
                      {restoring ? "Restoring…" : "Restore commit"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {!canRestore
                      ? "Commit and sync current edits before restoring."
                      : "Restore all program files without rewriting history."}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canRestore || restoring}
                    onClick={() => setConfirm(true)}
                  >
                    <ClockCounterClockwiseIcon />
                    Restore commit
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
