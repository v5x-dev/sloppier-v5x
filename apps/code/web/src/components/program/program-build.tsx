import { ActionTooltip } from "@/components/shared/action-tooltip"
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import {
  HammerIcon,
  XIcon,
  WarningCircleIcon,
  WarningIcon,
  InfoIcon,
  CheckCircleIcon,
  FileCodeIcon,
  ArrowUpRightIcon,
  ClockCounterClockwiseIcon,
} from "@phosphor-icons/react"
import { submitBuild, type BuildSource } from "@/lib/build-program"
import {
  diagnosticRevision,
  diagnosticsAreStale,
  parseBuildDiagnostics,
  resolveDiagnosticPath,
  type BuildDiagnostic,
} from "@/lib/build-diagnostics"
import { useProgramConnection } from "./program-connection"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@workspace/ui/components/tabs"
import {
  Sheet,
  SheetContent,
  SheetClose,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@workspace/ui/components/sheet"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"
import { errorMessage } from "@/lib/errors"

export function ProgramBuild({
  dirty,
  prepareSource,
  paths,
  currentSha,
  onDiagnostic,
}: {
  dirty: boolean
  prepareSource: () => Promise<BuildSource>
  paths: readonly string[]
  currentSha?: string
  onDiagnostic: (path: string, diagnostic: BuildDiagnostic) => void
}) {
  const logRef = useRef<HTMLPreElement>(null)
  const pendingJump = useRef<{
    path: string
    diagnostic: BuildDiagnostic
  } | null>(null)
  const {
    status: state,
    ready,
    error: presenceError,
    request,
  } = useProgramConnection()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState("problems")
  const [pending, setPending] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [fallbackStartedAt, setFallbackStartedAt] = useState<number | null>(
    null
  )
  const [connectingStartedAt, setConnectingStartedAt] = useState<number | null>(
    null
  )
  const sawBuilding = useRef(false)
  const logs = state?.logs ?? ""
  const diagnostics = useMemo(() => parseBuildDiagnostics(logs), [logs])
  const groups = useMemo(() => {
    const grouped = new Map<string, BuildDiagnostic[]>()
    for (const diagnostic of diagnostics) {
      const key =
        resolveDiagnosticPath(diagnostic.path, paths) ?? diagnostic.path
      const items = grouped.get(key) ?? []
      items.push(diagnostic)
      grouped.set(key, items)
    }
    return [...grouped]
  }, [diagnostics, paths])
  const errors = diagnostics.filter((item) => item.severity === "error").length
  const warnings = diagnostics.filter(
    (item) => item.severity === "warning"
  ).length
  const stale = diagnosticsAreStale(logs, currentSha, dirty)
  const revision = diagnosticRevision(logs)
  const building = pending || Boolean(state?.building)
  const startedAt = state?.startedAt ?? fallbackStartedAt
  const elapsedSeconds =
    startedAt == null
      ? null
      : Math.max(0, Math.floor((now - startedAt) / 1000))
  const connectingSeconds =
    connectingStartedAt == null
      ? null
      : Math.max(0, Math.floor((now - connectingStartedAt) / 1000))
  const succeeded = !building && logs.trimEnd().endsWith("Build succeeded.")
  useEffect(() => {
    if (state?.building) {
      sawBuilding.current = true
      setFallbackStartedAt((current) => current ?? Date.now())
    } else if (sawBuilding.current) {
      sawBuilding.current = false
      setFallbackStartedAt(null)
    }
  }, [state?.building])
  useEffect(() => {
    if (!ready) setConnectingStartedAt((current) => current ?? Date.now())
    else setConnectingStartedAt(null)
  }, [ready])
  useEffect(() => {
    if (!building && ready) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [building, ready])
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs, open, tab])
  async function build(showSheet = true) {
    if (showSheet) setOpen(true)
    setPending(true)
    try {
      await submitBuild(
        (path, body, signal) => {
          if (path === "/build") setFallbackStartedAt(Date.now())
          return request(path, body, signal)
        },
        await prepareSource()
      )
    } catch (error) {
      toast.add({
        type: "error",
        title: "Could not build",
        description: errorMessage(error),
      })
    } finally {
      setPending(false)
    }
  }
  function buildOrOpen() {
    if (building || !ready) setOpen(true)
    else void build()
  }
  const buildFromKeyboard = useEffectEvent((event: KeyboardEvent) => {
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      event.shiftKey ||
      event.isComposing ||
      event.repeat ||
      event.key.toLowerCase() !== "b"
    )
      return
    event.preventDefault()
    if (building || !ready) return
    void build(false)
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => buildFromKeyboard(event)
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [])
  return (
    <>
      <ActionTooltip
        label={state?.building ? "View build logs" : "Build program"}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={state?.building ? "View build logs" : "Build program"}
          aria-busy={building}
          onClick={buildOrOpen}
        >
          {building ? <Spinner /> : <HammerIcon />}
        </Button>
      </ActionTooltip>
      {revision && diagnostics.length > 0 && (
        <ActionTooltip
          label={`View build problems, ${errors} errors, ${warnings} warnings`}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`View build problems, ${errors} errors, ${warnings} warnings`}
            onClick={() => {
              setTab("problems")
              setOpen(true)
            }}
          >
            {errors ? (
              <WarningCircleIcon className="text-destructive" />
            ) : (
              <FileCodeIcon />
            )}
          </Button>
        </ActionTooltip>
      )}
      <Sheet
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(isOpen) => {
          if (!isOpen && pendingJump.current) {
            const jump = pendingJump.current
            pendingJump.current = null
            onDiagnostic(jump.path, jump.diagnostic)
          }
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="gap-0 font-serif data-[side=bottom]:h-[55svh]"
        >
          <SheetHeader className="flex-row items-center gap-3 border-b">
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <SheetTitle className="flex shrink-0 items-center gap-2 text-sm">
                <HammerIcon className="size-4 text-muted-foreground" />
                Build
              </SheetTitle>
              <SheetDescription className="flex min-w-0 items-center gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-2 truncate">
                  {building ? (
                    <>
                      <Spinner className="size-3" />
                      Building committed source
                      {elapsedSeconds !== null && (
                        <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                          {elapsedSeconds}s
                        </span>
                      )}
                    </>
                  ) : !ready ? (
                    <>
                      <span>Connecting to the build service…</span>
                      {connectingSeconds !== null && (
                        <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                          {connectingSeconds}s
                        </span>
                      )}
                    </>
                  ) : succeeded ? (
                    "Build succeeded"
                  ) : revision ? (
                    "Build finished"
                  ) : (
                    "Build committed source to check for problems"
                  )}
                </span>
                {revision && (
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {revision.slice(0, 8)}
                  </span>
                )}
              </SheetDescription>
            </div>
            <Button
              size="sm"
              className="shrink-0"
              variant="outline"
              disabled={!ready || building}
              onClick={() => void build()}
            >
              <HammerIcon />
              {building ? "Building…" : "Build again"}
            </Button>
            <SheetClose
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0"
                  aria-label="Close build sheet"
                />
              }
            >
              <XIcon />
            </SheetClose>
          </SheetHeader>
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(String(value))}
            className="min-h-0 flex-1 gap-0"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
              <TabsList variant="line">
                <TabsTrigger value="problems" className="gap-2 px-2 text-xs">
                  Problems
                  <Badge
                    variant={errors ? "destructive" : "secondary"}
                    className="font-mono tabular-nums"
                  >
                    {diagnostics.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="output" className="px-2 text-xs">
                  Output
                </TabsTrigger>
              </TabsList>
              <div
                className="flex items-center gap-3 text-xs text-muted-foreground"
                aria-live="polite"
              >
                <span className="flex items-center gap-1.5">
                  <WarningCircleIcon className="size-3.5 text-destructive" />
                  <span className="font-mono tabular-nums">{errors}</span>{" "}
                  {errors === 1 ? "error" : "errors"}
                </span>
                <span className="flex items-center gap-1.5">
                  <WarningIcon className="size-3.5 text-primary" />
                  <span className="font-mono tabular-nums">
                    {warnings}
                  </span>{" "}
                  {warnings === 1 ? "warning" : "warnings"}
                </span>
              </div>
            </div>
            {presenceError && (
              <p
                role="alert"
                className="border-b px-4 py-2 text-xs text-destructive"
              >
                {presenceError}
              </p>
            )}
            {stale && (
              <div
                role="status"
                className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground"
              >
                <ClockCounterClockwiseIcon className="size-4 shrink-0" />
                Source has changed. Rebuild to update these locations.
              </div>
            )}
            <TabsContent
              value="problems"
              className="min-h-0 flex-1 overflow-auto"
            >
              {groups.length ? (
                <div className="divide-y">
                  {groups.map(([path, items]) => (
                    <section key={path} aria-label={path}>
                      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-muted px-4 py-2 text-xs">
                        <FileCodeIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span
                          className="min-w-0 truncate font-mono"
                          title={path}
                        >
                          {path}
                        </span>
                        <span className="ml-auto font-mono text-muted-foreground">
                          {items.length}
                        </span>
                      </div>
                      <ul className="divide-y divide-border/50">
                        {items.map((diagnostic, index) => {
                          const target = resolveDiagnosticPath(
                            diagnostic.path,
                            paths
                          )
                          const Icon =
                            diagnostic.severity === "error"
                              ? WarningCircleIcon
                              : diagnostic.severity === "warning"
                                ? WarningIcon
                                : InfoIcon
                          return (
                            <li key={index}>
                              <button
                                type="button"
                                disabled={!target}
                                title={
                                  target
                                    ? `Open ${target}:${diagnostic.line}`
                                    : "This file is outside the editable repository. See Build output for context."
                                }
                                className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset disabled:cursor-default disabled:hover:bg-transparent"
                                onClick={() => {
                                  if (target) {
                                    pendingJump.current = {
                                      path: target,
                                      diagnostic,
                                    }
                                    setOpen(false)
                                  }
                                }}
                              >
                                <Icon
                                  aria-label={diagnostic.severity}
                                  className={`mt-0.5 size-4 shrink-0 ${diagnostic.severity === "error" ? "text-destructive" : diagnostic.severity === "warning" ? "text-primary" : "text-muted-foreground"}`}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block font-mono text-xs leading-relaxed break-words">
                                    {diagnostic.message}
                                  </span>
                                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                    <span className="capitalize">
                                      {diagnostic.severity}
                                    </span>
                                    <span className="font-mono">
                                      Ln {diagnostic.line}
                                      {diagnostic.column
                                        ? `, Col ${diagnostic.column}`
                                        : ""}
                                    </span>
                                    {!target && <span>Dependency file</span>}
                                  </span>
                                </span>
                                {target && (
                                  <ArrowUpRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                                )}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="flex h-full min-h-36 flex-col items-center justify-center gap-2 p-6 text-center">
                  {building ? (
                    <Spinner className="size-5 text-muted-foreground" />
                  ) : succeeded ? (
                    <CheckCircleIcon className="size-6 text-primary" />
                  ) : (
                    <FileCodeIcon className="size-6 text-muted-foreground" />
                  )}
                  <p className="text-sm">
                    {building
                      ? "Checking your program…"
                      : succeeded
                        ? "No compiler problems"
                        : revision
                          ? "No source diagnostics found"
                          : "Ready when you are"}
                  </p>
                  <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                    {building
                      ? "Errors and warnings appear here as the compiler reports them."
                      : succeeded
                        ? "The compiler reported no errors or warnings."
                        : revision
                          ? "Check Build output for toolchain, linker, or other build messages."
                          : "Build your committed source to see errors and warnings grouped by file."}
                  </p>
                </div>
              )}
            </TabsContent>
            <TabsContent
              value="output"
              className="min-h-0 flex-1 overflow-hidden"
            >
              <pre
                ref={logRef}
                role="log"
                aria-live="off"
                className="h-full overflow-auto p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap"
              >
                {logs || "Waiting for build output…"}
              </pre>
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
    </>
  )
}
