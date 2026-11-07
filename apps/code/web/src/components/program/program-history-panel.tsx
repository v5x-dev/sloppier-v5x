import { DuplicateProgramDialog } from "@/components/program/duplicate-program-dialog"
import { ActionTooltip } from "@/components/shared/action-tooltip"
import { format, formatDistanceToNow } from "date-fns"
import { useEffect, useMemo, useRef, useState } from "react"
import { useAction, useMutation, useQuery } from "convex/react"
import { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
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
import { Button } from "@v5x/ui/components/button"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@v5x/ui/components/popover"
import { Spinner } from "@v5x/ui/components/spinner"
import { ScrollArea } from "@v5x/ui/components/scroll-area"
import { editorThemeOptions } from "@/lib/editor-theme"
import { errorMessage } from "@/lib/errors"

type History = FunctionReturnType<typeof api.codeStorage.history>
type Commit = History["commits"][number]
type ChangedFile = FunctionReturnType<
  typeof api.codeStorage.historyFiles
>[number]

type Diff = FunctionReturnType<typeof api.codeStorage.historyDiff>
/** What the user has open in the history panel. Choosing another commit replaces the whole value. */
type Detail =
  | { kind: "closed" }
  | { kind: "listing"; commit: Commit }
  | { kind: "failed"; commit: Commit; message: string }
  | {
      kind: "open"
      commit: Commit
      files: ChangedFile[]
      file: ChangedFile | null
      diff: Diff | null
      /** The last failure: a diff that would not load, a checkpoint, or a restore. */
      error: string | null
      action: Action
    }
/** The action on the open commit. Confirming a restore, restoring, and the result that follows are one flow. */
type Action =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "restoring" }
  | { kind: "done"; message: string }

export function ProgramHistoryPanel({
  programId,
  programName,
  revision,
  canRestore,
  onRestore,
  initiallyOpen = false,
}: {
  programId: Id<"programs">
  programName: string
  revision?: string
  canRestore: boolean
  onRestore: (sha: string) => Promise<string | null>
  initiallyOpen?: boolean
}) {
  const uploads = useQuery(api.uploads.list, { programId })
  const checkpoints = useQuery(api.checkpoints.list, { programId })
  const createCheckpoint = useAction(api.codeStorage.createCheckpoint)
  const removeCheckpoint = useMutation(api.checkpoints.remove)
  const [checkpointName, setCheckpointName] = useState("")
  const [checkpointBusy, setCheckpointBusy] = useState(false)
  const history = useAction(api.codeStorage.history)
  const historyFiles = useAction(api.codeStorage.historyFiles)
  const historyDiff = useAction(api.codeStorage.historyDiff)
  const [open, setOpen] = useState(initiallyOpen)
  const [page, setPage] = useState<History | null>(null)
  const [detail, setDetail] = useState<Detail>({ kind: "closed" })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const restoreBusy = useRef(false)
  // Projections of `detail`, so the markup reads the values it always has.
  const commit = detail.kind === "closed" ? null : detail.commit
  const files = detail.kind === "open" ? detail.files : null
  const file = detail.kind === "open" ? detail.file : null
  const diff = detail.kind === "open" ? detail.diff : null
  const detailError =
    detail.kind === "failed"
      ? detail.message
      : detail.kind === "open"
        ? detail.error
        : null
  const confirm = detail.kind === "open" && detail.action.kind === "confirming"
  const restoring = detail.kind === "open" && detail.action.kind === "restoring"
  const result =
    detail.kind === "open" && detail.action.kind === "done"
      ? detail.action.message
      : null
  const setAction = (action: Action) =>
    setDetail((current) =>
      current.kind === "open" ? { ...current, action } : current
    )
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
  /** Changes the open commit. A reply for an earlier selection never reaches here, and a closed panel ignores it. */
  const updateOpen = (
    update: (open: Extract<Detail, { kind: "open" }>) => Detail
  ) =>
    setDetail((current) =>
      current.kind === "open" ? update(current) : current
    )
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
      if (request === detailRequest.current)
        updateOpen((view) => ({ ...view, diff: next }))
    } catch (err) {
      if (request === detailRequest.current)
        updateOpen((view) => ({ ...view, error: errorMessage(err) }))
    }
  }
  async function loadFiles(target: Commit) {
    const request = ++detailRequest.current
    setDetail({ kind: "listing", commit: target })
    try {
      const next = await historyFiles({ programId, sha: target.sha })
      if (request !== detailRequest.current) return
      const first = next.at(0) ?? null
      setDetail({
        kind: "open",
        commit: target,
        files: next,
        file: first,
        diff: null,
        error: null,
        action: { kind: "idle" },
      })
      if (first) await loadDiff(target, first, request)
    } catch (err) {
      if (request === detailRequest.current)
        setDetail({
          kind: "failed",
          commit: target,
          message: errorMessage(err),
        })
    }
  }
  function openCommit(next: Commit) {
    void loadFiles(next)
  }
  function selectFile(next: ChangedFile) {
    if (!commit) return
    const request = ++detailRequest.current
    updateOpen((view) => ({
      ...view,
      file: next,
      diff: null,
      error: null,
      action: { kind: "idle" },
    }))
    void loadDiff(commit, next, request)
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
  async function saveCheckpoint() {
    if (!commit || checkpointBusy) return
    setCheckpointBusy(true)
    updateOpen((view) => ({ ...view, error: null }))
    try {
      await createCheckpoint({
        programId,
        sha: commit.sha,
        name: checkpointName,
      })
      setCheckpointName("")
      setAction({ kind: "done", message: "Checkpoint saved." })
    } catch (err) {
      updateOpen((view) => ({ ...view, error: errorMessage(err) }))
    } finally {
      setCheckpointBusy(false)
    }
  }
  async function removeSavedCheckpoint(checkpointId: Id<"programCheckpoints">) {
    try {
      await removeCheckpoint({ checkpointId })
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  async function restore() {
    if (!commit || !canRestore || restoreBusy.current) return
    const sha = commit.sha
    restoreBusy.current = true
    updateOpen((view) => ({
      ...view,
      error: null,
      action: { kind: "restoring" },
    }))
    // The restore's outcome applies only while the same commit is still open.
    const settle = (
      change: (open: Extract<Detail, { kind: "open" }>) => Detail
    ) =>
      setDetail((current) =>
        current.kind === "open" && current.commit.sha === sha
          ? change(current)
          : current
      )
    try {
      const warning = await onRestore(sha)
      settle((view) => ({
        ...view,
        action: {
          kind: "done",
          message: warning ?? "Program restored in a new commit.",
        },
      }))
    } catch (err) {
      settle((view) => ({
        ...view,
        error: errorMessage(err),
        action: { kind: "confirming" },
      }))
    } finally {
      restoreBusy.current = false
    }
  }
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        if (restoring) return
        setOpen(value)
        setAction({ kind: "idle" })
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
                setDetail({ kind: "closed" })
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
              {commit ? commit.message : "Saved versions"}
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
          <ScrollArea className="max-h-[60svh] [&_[data-slot=scroll-area-viewport]]:max-h-[60svh]">
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
            <section className="border-b" aria-label="Upload activity">
              {uploads === undefined ? (
                <p className="p-3 text-xs text-muted-foreground">
                  Loading upload activity…
                </p>
              ) : uploads.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">
                  No uploads recorded yet.
                </p>
              ) : (
                <ul className="divide-y">
                  {uploads.map((item) => (
                    <li key={item._id} className="px-3 py-2 text-sm">
                      <div>
                        {item.userName} uploaded to slot {item.slot}
                      </div>
                      <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
                        <span className="font-mono" title={item.revision}>
                          {item.revision.slice(0, 7)}
                        </span>
                        <time
                          dateTime={new Date(item.uploadedAt).toISOString()}
                          title={format(
                            item.uploadedAt,
                            "MMMM d, yyyy 'at' h:mm a"
                          )}
                        >
                          {format(item.uploadedAt, "MMM d, yyyy 'at' h:mm a")}
                        </time>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {!!checkpoints?.length && (
              <section
                className="border-b"
                aria-label="Competition checkpoints"
              >
                <h3 className="px-3 pt-3 text-xs font-semibold text-muted-foreground">
                  Checkpoints
                </h3>
                <ul>
                  {checkpoints.map((item) => (
                    <li
                      key={item._id}
                      className="flex items-center gap-1 px-3 py-1"
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 rounded py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => openCommit(item)}
                      >
                        <span className="block truncate text-sm">
                          {item.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.message} · {item.sha.slice(0, 7)}
                        </span>
                      </button>
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label={`Remove checkpoint ${item.name}`}
                        onClick={() => void removeSavedCheckpoint(item._id)}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
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
          </ScrollArea>
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
              <ScrollArea className="max-h-28 shrink-0 border-b sm:max-h-none sm:w-44 sm:border-r sm:border-b-0 [&_[data-slot=scroll-area-viewport]]:max-h-28 sm:[&_[data-slot=scroll-area-viewport]]:max-h-none">
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
              </ScrollArea>
              <ScrollArea
                className="min-h-0 min-w-0 flex-1 bg-background"
                aria-label="Commit file diff"
                horizontal
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
              </ScrollArea>
            </div>
            <div className="space-y-2 border-t p-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDuplicateOpen(true)}
              >
                Duplicate from this commit
              </Button>
              {duplicateOpen && (
                <DuplicateProgramDialog
                  programId={programId}
                  programName={programName}
                  sha={commit.sha}
                  open={duplicateOpen}
                  onOpenChange={setDuplicateOpen}
                />
              )}
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void saveCheckpoint()
                }}
              >
                <label className="sr-only" htmlFor="checkpoint-name">
                  Checkpoint name
                </label>
                <input
                  id="checkpoint-name"
                  className="min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                  placeholder="Checkpoint name, e.g. Skills run"
                  maxLength={80}
                  value={checkpointName}
                  onChange={(event) => setCheckpointName(event.target.value)}
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={!checkpointName.trim() || checkpointBusy}
                >
                  Save checkpoint
                </Button>
              </form>
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
                      onClick={() => setAction({ kind: "idle" })}
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
                      : "Restores every file to this version. History is kept, and the restore becomes a new version."}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canRestore || restoring}
                    onClick={() => setAction({ kind: "confirming" })}
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
