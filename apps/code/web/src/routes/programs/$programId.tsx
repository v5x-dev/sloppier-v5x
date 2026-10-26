import { ProgramSearch } from "@/components/program-search"
import { ProgramHistory } from "@/components/program-history"
import type { DiagnosticTarget } from "@/lib/build-diagnostics"
import { editorThemeOptions } from "@/lib/editor-theme"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDndContext,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers"
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  ArrowClockwiseIcon,
  CaretLeftIcon,
  FileDashedIcon,
  GitCommitIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react"
import { File } from "@pierre/diffs/react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { api } from "@workspace/backend/api"
import type { Doc, Id } from "@workspace/backend/dataModel"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@workspace/ui/components/sidebar"
import { cn } from "@workspace/ui/lib/utils"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { toast } from "@workspace/ui/components/toast"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { useAction, useMutation, useQuery } from "convex/react"
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  RepositoryExplorer,
  type ExplorerUpdate,
} from "@/components/repository-explorer"
import { containsPath } from "@/lib/explorer"
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { LiveFileEditor, type LivePerson } from "@/components/live-file-editor"
import { MAX_SOURCE_BYTES } from "@/lib/live-document"
import { AuthGate } from "@/components/auth-gate"
import { errorMessage } from "@/lib/errors"
import {
  ProgramConnection,
  useProgramConnection,
} from "@/components/program-connection"
import { ProgramBuild } from "@/components/program-build"
import { ProgramUpload } from "@/components/program-upload"
import { useProgramBinaries } from "@/hooks/use-program-binaries"
import { prepareUploadBuild, waitForSourceSync } from "@/lib/build-program"

export const Route = createFileRoute("/programs/$programId")({
  component: () => (
    <AuthGate>
      <ProgramPage />
    </AuthGate>
  ),
})

// Reserved for live-editing CRDT blobs; not user source.
const RESERVED_PREFIX = ".v5x/"
const MAX_READ_BYTES = 512 * 1024

const treeStyle = {
  "--trees-bg-override": "var(--sidebar)",
  "--trees-padding-inline-override": "0px",
  "--trees-fg-override": "var(--sidebar-foreground)",
  "--trees-fg-muted-override": "var(--muted-foreground)",
  "--trees-bg-muted-override": "var(--sidebar-accent)",
  "--trees-selected-bg-override": "var(--sidebar-accent)",
  "--trees-selected-fg-override": "var(--sidebar-accent-foreground)",
  "--trees-border-color-override": "var(--sidebar-border)",
  "--trees-accent-override": "var(--primary)",
  "--trees-focus-ring-color-override": "var(--ring)",
  "--trees-git-modified-color-override": "var(--primary)",
  "--trees-font-family-override": "var(--font-serif)",
  height: "100%",
} as React.CSSProperties

function ProgramPage() {
  const { programId } = Route.useParams()
  const projectId = programId as Id<"projects">
  const program = useQuery(api.projects.get, { projectId })

  if (program === undefined) {
    return (
      <div className="flex h-svh items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  if (program.repositoryStatus === "ready") {
    return (
      <ProgramConnection key={program._id} projectId={program._id}>
        <Workbench program={program} />
      </ProgramConnection>
    )
  }

  return (
    <div className="flex h-svh flex-col">
      <ProvisioningState program={program} />
    </div>
  )
}

function ProvisioningState({ program }: { program: Doc<"projects"> }) {
  const retry = useMutation(api.projects.retryProvisioning)

  if (program.repositoryStatus === "failed") {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WarningCircleIcon />
          </EmptyMedia>
          <EmptyTitle>Repository setup failed</EmptyTitle>
          <EmptyDescription>
            {program.repositoryError ??
              "Code Storage could not import the template."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            onClick={() =>
              retry({ projectId: program._id }).catch((error) =>
                toast.add({
                  type: "error",
                  title: "Could not retry setup",
                  description: errorMessage(error),
                })
              )
            }
          >
            <ArrowClockwiseIcon data-icon="inline-start" />
            Retry setup
          </Button>
          <Button
            variant="outline"
            render={<Link to="/" />}
            nativeButton={false}
          >
            All programs
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Spinner />
        </EmptyMedia>
        <EmptyTitle>Setting up the repository</EmptyTitle>
        <EmptyDescription>
          Copying the starter files into Code Storage. This page opens the
          editor when it finishes.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" render={<Link to="/" />} nativeButton={false}>
          All programs
        </Button>
      </EmptyContent>
    </Empty>
  )
}

type LoadedFile = {
  contents: string
  truncated: boolean
  editorKey?: string
}

function Workbench({ program }: { program: Doc<"projects"> }) {
  const binaries = useProgramBinaries()
  const { request: buildRequest } = useProgramConnection()
  const buildManifest = useAction(api.codeStorage.buildManifest)
  const listFiles = useAction(api.codeStorage.listFiles)
  const readFile = useAction(api.codeStorage.readFile)
  const commitFiles = useAction(api.codeStorage.commitFiles)
  const restoreHistoryFile = useAction(api.codeStorage.restoreHistoryFile)

  const [paths, setPaths] = useState<string[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [openPaths, setOpenPaths] = useState<string[]>([])
  const tabSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const [diagnosticTarget, setDiagnosticTarget] = useState<
    (DiagnosticTarget & { path: string }) | null
  >(null)
  const [activePath, setActivePath] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Partial<Record<string, LoadedFile>>>({})
  const [readError, setReadError] = useState<Partial<Record<string, string>>>(
    {}
  )
  // Last committed text per path, and the editor's live text per path.
  const committed = useRef(new Map<string, string>())
  const drafts = useRef(new Map<string, string>())
  const draftListeners = useRef(new Set<() => void>())
  const getSearchDrafts = useCallback(() => drafts.current, [])
  const subscribeSearchDrafts = useCallback((listener: () => void) => {
    draftListeners.current.add(listener)
    return () => {
      draftListeners.current.delete(listener)
    }
  }, [])
  const scrollPositions = useRef(new Map<string, number>())
  const [dirtyPaths, setDirtyPaths] = useState<string[]>([])
  const [commitOpen, setCommitOpen] = useState(false)
  const [filePeople, setFilePeople] = useState<Record<string, LivePerson[]>>({})
  const [liveSync, setLiveSync] = useState<Record<string, boolean>>({})
  const allSynced = Object.values(liveSync).every(Boolean)
  const syncedRef = useRef(allSynced)
  syncedRef.current = allSynced
  const operationBusy = useRef(false)
  const savePending = useRef(false)
  const initialOpen = useRef(false)

  async function prepareSource() {
    const { sha, paths } = await buildManifest({ projectId: program._id })
    const files: Record<string, Uint8Array> = {}
    let total = 0
    for (const path of paths) {
      const bytes = new Uint8Array(await readBytes(path, true, sha))
      total += bytes.length
      if (total > 96 * 1024 * 1024)
        throw new Error("Source snapshot exceeds 96 MiB.")
      files[path] = bytes
    }
    return { sha, files }
  }

  const loadPaths = useCallback(async () => {
    setListError(null)
    try {
      const all: string[] = []
      let cursor: string | undefined
      do {
        const page = await listFiles({ projectId: program._id, cursor })
        all.push(...page.paths)
        cursor = page.hasMore ? page.nextCursor : undefined
      } while (cursor)
      setPaths(all.filter((path) => !path.startsWith(RESERVED_PREFIX)).sort())
    } catch (error) {
      setListError(errorMessage(error))
    }
  }, [listFiles, program._id])

  useEffect(() => {
    void loadPaths()
  }, [loadPaths])

  const openFile = useCallback((path: string) => {
    setOpenPaths((current) =>
      current.includes(path) ? current : [...current, path]
    )
    setActivePath(path)
  }, [])

  useEffect(() => {
    if (!paths || initialOpen.current) return
    initialOpen.current = true
    const entry = pickEntryFile(paths)
    if (entry) openFile(entry)
  }, [paths, openFile])

  useEffect(() => {
    const requestedPath = activePath
    if (!requestedPath || loaded[requestedPath] || readError[requestedPath])
      return
    let cancelled = false
    readFile({
      projectId: program._id,
      path: requestedPath,
      length: MAX_READ_BYTES,
    })
      .then(({ bytes, contentRange }) => {
        if (cancelled) return
        const contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
        if (contents.includes("\0"))
          throw new Error(
            "This is a binary file. Use Download to open it locally."
          )
        const total = Number(contentRange?.split("/").at(1))
        committed.current.set(requestedPath, contents)
        setLoaded((current) => ({
          ...current,
          [requestedPath]: {
            contents,
            editorKey: `${program._id}:${crypto.randomUUID()}`,
            truncated: Number.isFinite(total) && total > bytes.byteLength,
          },
        }))
      })
      .catch((error) => {
        if (cancelled) return
        setReadError((current) => ({
          ...current,
          [requestedPath]: errorMessage(error),
        }))
      })
    return () => {
      cancelled = true
    }
  }, [activePath, loaded, program._id, readError, readFile])

  const syncDirty = useCallback(() => {
    for (const listener of draftListeners.current) listener()
    const next = [...drafts.current]
      .filter(([path, text]) => committed.current.get(path) !== text)
      .map(([path]) => path)
      .sort()
    setDirtyPaths((current) =>
      current.join("\n") === next.join("\n") ? current : next
    )
  }, [])

  async function commit(message?: string) {
    if (!syncedRef.current)
      throw new Error(
        "Wait for live changes to finish syncing before committing."
      )
    const changes = [...drafts.current]
      .filter(([path, text]) => committed.current.get(path) !== text)
      .map(([path, text]) => ({
        operation: "put" as const,
        path,
        contents: text,
      }))
    if (!changes.length) return
    if (operationBusy.current)
      throw new Error("Wait for the current file operation to finish.")
    operationBusy.current = true
    try {
      const changedPaths = changes.map(({ path }) => path).sort()
      const generatedMessage =
        changedPaths.length === 1
          ? `Update ${changedPaths[0]}`
          : `Update ${changedPaths.length} files: ${changedPaths.join(", ")}`
      await commitFiles({
        projectId: program._id,
        message: message ?? generatedMessage.slice(0, 200),
        changes,
      })
      for (const change of changes)
        committed.current.set(change.path, change.contents)
      syncDirty()
    } finally {
      operationBusy.current = false
    }
  }

  const saveFromKeyboard = useEffectEvent(
    (event: KeyboardEvent, signal: AbortSignal) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing ||
        event.key.toLowerCase() !== "s"
      )
        return
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat || savePending.current) return
      if (
        ![...drafts.current].some(
          ([path, text]) => committed.current.get(path) !== text
        )
      )
        return
      savePending.current = true
      void (async () => {
        try {
          await waitForSourceSync(() => syncedRef.current, signal)
          signal.throwIfAborted()
          await commit()
          if (!signal.aborted)
            toast.add({ type: "success", title: "Changes committed" })
        } catch (error) {
          if (!signal.aborted)
            toast.add({
              type: "error",
              title: "Could not commit",
              description: errorMessage(error),
            })
        } finally {
          savePending.current = false
        }
      })()
    }
  )

  useEffect(() => {
    const controller = new AbortController()
    const onKeyDown = (event: KeyboardEvent) =>
      saveFromKeyboard(event, controller.signal)
    window.addEventListener("keydown", onKeyDown, true)
    return () => {
      controller.abort()
      window.removeEventListener("keydown", onKeyDown, true)
    }
  }, [])

  async function restoreFile(sha: string, path: string) {
    if (operationBusy.current || dirtyPaths.length || !syncedRef.current)
      throw new Error("Commit and sync current changes before restoring.")
    operationBusy.current = true
    try {
      const result = await restoreHistoryFile({
        projectId: program._id,
        sha,
        path,
      })
      committed.current.set(path, result.contents)
      syncDirty()
      setLoaded((current) => ({
        ...current,
        [path]: {
          ...current[path],
          contents: result.contents,
          truncated: false,
        },
      }))
      setReadError((current) => ({ ...current, [path]: undefined }))
      await loadPaths()
      openFile(path)
      return result.warning
    } finally {
      operationBusy.current = false
    }
  }

  async function readBytes(
    path: string,
    saved = false,
    ref?: string
  ): Promise<ArrayBuffer> {
    const draft = !saved && !ref ? drafts.current.get(path) : undefined
    if (draft !== undefined) return new TextEncoder().encode(draft).buffer
    const chunks: Uint8Array[] = []
    let offset = 0
    let hasMore = true
    while (hasMore) {
      const { bytes, contentRange } = await readFile({
        projectId: program._id,
        path,
        offset,
        ref,
        length: MAX_READ_BYTES,
      })
      chunks.push(new Uint8Array(bytes))
      offset += bytes.byteLength
      const total = Number(contentRange?.split("/").at(-1))
      if (
        (Number.isFinite(total) && offset >= total) ||
        bytes.byteLength < MAX_READ_BYTES ||
        !contentRange
      )
        hasMore = false
    }
    const bytes = new Uint8Array(offset)
    let position = 0
    for (const chunk of chunks) {
      bytes.set(chunk, position)
      position += chunk.byteLength
    }
    return bytes.buffer
  }

  async function applyExplorerUpdate(update: ExplorerUpdate) {
    if (!syncedRef.current)
      throw new Error(
        "Wait for live changes to finish syncing before changing files."
      )
    if (operationBusy.current)
      throw new Error("Wait for the current file operation to finish.")
    if (!update.changes.length)
      throw new Error("No files to change. Refresh the Explorer.")
    if (update.changes.length > 100)
      throw new Error(
        "A repository operation can change at most 100 files. Select fewer items."
      )
    const size = update.changes.reduce(
      (total, change) =>
        total +
        (change.operation === "put"
          ? typeof change.contents === "string"
            ? new TextEncoder().encode(change.contents).byteLength
            : change.contents.byteLength
          : 0),
      0
    )
    if (size > MAX_READ_BYTES)
      throw new Error(
        "A repository operation can write at most 512 KiB. Select fewer or smaller files."
      )
    operationBusy.current = true
    try {
      await commitFiles({
        projectId: program._id,
        message: update.message,
        changes: update.changes,
        requireAbsentPaths: update.requireAbsentPaths,
        moves: update.changes.flatMap((change) => {
          if (change.operation !== "delete") return []
          const move = update.moves?.find(({ from }) =>
            containsPath(from, change.path)
          )
          return move
            ? [
                {
                  from: change.path,
                  to: `${move.to}${change.path.slice(move.from.length)}`,
                },
              ]
            : []
        }),
      })
      const removed = new Set(update.removed ?? [])
      const remap = (path: string) => {
        const move = update.moves?.find(({ from }) => containsPath(from, path))
        return move ? `${move.to}${path.slice(move.from.length)}` : path
      }
      // Keep drafts at their new path, and discard only deleted files.
      const remapMap = <T,>(map: Map<string, T>) => {
        const entries = [...map]
        map.clear()
        for (const [path, value] of entries)
          if (!removed.has(path)) map.set(remap(path), value)
      }
      remapMap(drafts.current)
      remapMap(committed.current)
      remapMap(scrollPositions.current)
      setLoaded((current) =>
        Object.fromEntries(
          Object.entries(current)
            .filter(([path]) => !removed.has(path))
            .map(([path, value]) => [
              remap(path),
              value && {
                ...value,
                contents: drafts.current.get(remap(path)) ?? value.contents,
              },
            ])
        )
      )
      setLiveSync((current) =>
        Object.fromEntries(
          Object.entries(current)
            .filter(([path]) => !removed.has(path))
            .map(([path, value]) => [remap(path), value])
        )
      )
      setReadError((current) =>
        Object.fromEntries(
          Object.entries(current)
            .filter(([path]) => !removed.has(path))
            .map(([path, value]) => [remap(path), value])
        )
      )
      setOpenPaths((current) =>
        current.filter((path) => !removed.has(path)).map(remap)
      )
      setActivePath((current) =>
        current && !removed.has(current)
          ? remap(current)
          : (openPaths
              .filter((path) => !removed.has(path))
              .map(remap)
              .at(-1) ?? null)
      )
      setPaths((current) => {
        const next = new Set(current ?? [])
        for (const change of update.changes) {
          if (change.operation === "delete") next.delete(change.path)
          else next.add(change.path)
        }
        return [...next].sort()
      })
      syncDirty()
    } finally {
      operationBusy.current = false
    }
  }

  function selectTab(path: string) {
    openFile(path)
  }

  function closeTab(path: string) {
    if (liveSync[path] === false) {
      toast.add({
        type: "error",
        title: "This file is still syncing",
        description: "Keep it open until its live changes are saved.",
      })
      return
    }
    const index = openPaths.indexOf(path)
    const remaining = openPaths.filter((openPath) => openPath !== path)
    setOpenPaths(remaining)
    if (activePath === path) {
      const next = remaining.at(index) ?? remaining.at(-1) ?? null
      setActivePath(next)
    }
  }

  return (
    <SidebarProvider
      className="h-svh min-h-0"
      style={
        {
          "--sidebar-width": "18rem",
          // The theme's border is translucent in dark mode, so it shifts shade
          // where the sidebar and bar outlines overlap. Flatten it to one color.
          "--sidebar-border":
            "color-mix(in oklab, var(--foreground) 10%, var(--background))",
        } as React.CSSProperties
      }
    >
      <Sidebar variant="floating">
        <SidebarHeader className="flex-row items-center gap-1 p-1 text-muted-foreground">
          <Button
            variant="ghost"
            size="icon-sm"
            render={<Link to="/" aria-label="All programs" />}
            nativeButton={false}
          >
            <CaretLeftIcon />
          </Button>
          <span className="truncate text-xs font-medium">{program.name}</span>
        </SidebarHeader>
        <SidebarContent className="overflow-hidden">
          {listError ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyTitle>Could not list files</EmptyTitle>
                <EmptyDescription>{listError}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" size="sm" onClick={loadPaths}>
                  Try again
                </Button>
              </EmptyContent>
            </Empty>
          ) : paths === null ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="text-muted-foreground" />
            </div>
          ) : (
            <RepositoryExplorer
              binaries={binaries}
              paths={paths}
              dirtyPaths={dirtyPaths}
              activePath={activePath}
              projectId={program._id}
              style={treeStyle}
              readBytes={readBytes}
              apply={applyExplorerUpdate}
              onOpen={openFile}
              onRefresh={loadPaths}
            />
          )}
        </SidebarContent>
        <SidebarFooter className="items-start p-3">
          <AvatarGroup aria-label="People in this file">
            {(activePath ? (filePeople[activePath] ?? []) : []).map(
              (person) => (
                <Avatar
                  key={person.id}
                  size="sm"
                  title={person.name}
                  aria-label={person.name}
                >
                  {person.imageUrl && (
                    <AvatarImage src={person.imageUrl} alt={person.name} />
                  )}
                  <AvatarFallback
                    style={{
                      backgroundColor: `${person.color}33`,
                      color: person.color,
                    }}
                  >
                    {person.name
                      .trim()
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((part) => part[0])
                      .join("")
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              )
            )}
          </AvatarGroup>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-h-0 min-w-0 pt-2">
        <div className="flex min-h-0 min-w-0 flex-1">
          <Tabs
            value={activePath}
            onValueChange={(value) => {
              if (typeof value === "string") selectTab(value)
            }}
            className="min-h-0 min-w-0 flex-1 gap-0"
          >
            {openPaths.length > 0 && (
              <div className="shrink-0 overflow-x-auto overflow-y-hidden">
                <DndContext
                  sensors={tabSensors}
                  collisionDetection={closestCenter}
                  modifiers={[restrictToHorizontalAxis]}
                  onDragEnd={({ active, over }) => {
                    if (!over || active.id === over.id) return
                    setOpenPaths((current) => {
                      const from = current.indexOf(String(active.id))
                      const to = current.indexOf(String(over.id))
                      return from < 0 || to < 0
                        ? current
                        : arrayMove(current, from, to)
                    })
                  }}
                >
                  <SortableContext
                    items={openPaths}
                    strategy={horizontalListSortingStrategy}
                  >
                    <SortableTabsList
                      aria-label="Open files"
                      className="h-8! justify-start"
                    >
                      {openPaths.map((path) => (
                        <SortableFileTab
                          key={path}
                          path={path}
                          dirty={dirtyPaths.includes(path)}
                          onClose={() => closeTab(path)}
                        />
                      ))}
                    </SortableTabsList>
                  </SortableContext>
                </DndContext>
              </div>
            )}
            <>
              {openPaths.map((path) => (
                // Each file owns its scroll container and stays mounted while
                // inactive, retaining its selection, draft, and undo history.
                <TabsContent
                  key={loaded[path]?.editorKey ?? path}
                  value={path}
                  keepMounted
                  className="min-h-0 overflow-auto no-scrollbar"
                  onScroll={(event) => {
                    if (path === activePath) {
                      scrollPositions.current.set(
                        path,
                        event.currentTarget.scrollTop
                      )
                    }
                  }}
                >
                  {readError[path] ? (
                    <Empty className="h-full">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <WarningCircleIcon />
                        </EmptyMedia>
                        <EmptyTitle>Could not open this file</EmptyTitle>
                        <EmptyDescription>{readError[path]}</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : loaded[path] ? (
                    <FileEditor
                      projectId={program._id}
                      path={path}
                      diagnosticTarget={
                        diagnosticTarget?.path === path
                          ? diagnosticTarget
                          : undefined
                      }
                      active={path === activePath}
                      onPeopleChange={(people) =>
                        setFilePeople((current) =>
                          JSON.stringify(current[path]) ===
                          JSON.stringify(people)
                            ? current
                            : { ...current, [path]: people }
                        )
                      }
                      onSyncChange={(synced) =>
                        setLiveSync((current) =>
                          current[path] === synced
                            ? current
                            : { ...current, [path]: synced }
                        )
                      }
                      loaded={loaded[path]}
                      scrollPositions={scrollPositions.current}
                      onChange={(text) => {
                        drafts.current.set(path, text)
                        syncDirty()
                      }}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Spinner className="text-muted-foreground" />
                    </div>
                  )}
                </TabsContent>
              ))}
            </>
            {openPaths.length === 0 && (
              <Empty className="flex-1">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileDashedIcon />
                  </EmptyMedia>
                  <EmptyTitle>Pick a file</EmptyTitle>
                  <EmptyDescription>
                    Choose a file from the tree to start editing.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </Tabs>
        </div>
        <ActionsBar
          activePath={activePath}
          leftAction={
            <>
              <ProgramSearch
                projectId={program._id}
                revision={program.repositoryHeadSha}
                getDrafts={getSearchDrafts}
                subscribeDrafts={subscribeSearchDrafts}
                onSelect={(path, line, column) => {
                  setDiagnosticTarget((current) => ({
                    path,
                    line,
                    column,
                    request: (current?.request ?? 0) + 1,
                  }))
                  openFile(path)
                }}
              />
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                      dirtyPaths.length === 0
                        ? "No changes"
                        : `Commit ${dirtyPaths.length} ${dirtyPaths.length === 1 ? "file" : "files"}`
                    }
                    disabled={dirtyPaths.length === 0 || !allSynced}
                    onClick={() => setCommitOpen(true)}
                  >
                    <GitCommitIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {dirtyPaths.length === 0
                    ? "No changes"
                    : `Commit ${dirtyPaths.length} ${dirtyPaths.length === 1 ? "file" : "files"}. Ctrl/Cmd+S commits with an automatic message.`}
                </TooltipContent>
              </Tooltip>
            </>
          }
        >
          <ProgramHistory
            projectId={program._id}
            revision={program.repositoryHeadSha}
            canRestore={dirtyPaths.length === 0 && allSynced}
            onRestore={restoreFile}
          />
          <ProgramUpload
            buildAction={
              <ProgramBuild
                dirty={dirtyPaths.length > 0}
                prepareSource={prepareSource}
                paths={paths ?? []}
                currentSha={program.repositoryHeadSha}
                onDiagnostic={(path, diagnostic) => {
                  setDiagnosticTarget((current) => ({
                    path,
                    line: diagnostic.line,
                    column: diagnostic.column,
                    request: (current?.request ?? 0) + 1,
                  }))
                  openFile(path)
                }}
              />
            }
            name={program.name}
            dirty={dirtyPaths.length > 0}
            prepareProgram={(signal, onStage) =>
              prepareUploadBuild({
                commitChanges: async (signal) => {
                  await waitForSourceSync(() => syncedRef.current, signal)
                  await commit("Save changes before upload")
                },
                prepareSource,
                request: buildRequest,
                signal,
                onStage,
              })
            }
          />
        </ActionsBar>
      </SidebarInset>
      <CommitDialog
        open={commitOpen}
        onOpenChange={setCommitOpen}
        paths={dirtyPaths}
        onCommit={commit}
      />
    </SidebarProvider>
  )
}

function SortableTabsList(props: React.ComponentProps<typeof TabsList>) {
  const { active } = useDndContext()
  return (
    <TabsList
      {...props}
      onKeyDown={(event) => {
        if (active) event.preventBaseUIHandler()
      }}
    />
  )
}

function SortableFileTab({
  path,
  dirty,
  onClose,
}: {
  path: string
  dirty: boolean
  onClose: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: path })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group/tab relative flex shrink-0 items-center",
        isDragging && "z-10 rounded-md bg-background"
      )}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <TabsTrigger
        ref={setActivatorNodeRef}
        {...listeners}
        onKeyDown={(event) => {
          listeners?.onKeyDown(event)
          if (isDragging) event.preventBaseUIHandler()
        }}
        aria-describedby={attributes["aria-describedby"]}
        aria-roledescription="sortable tab"
        value={path}
        title={path}
        className="flex-none touch-pan-y px-3 pr-8"
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault()
            onClose()
          }
        }}
      >
        {path.split("/").at(-1)}
        {dirty && (
          <span
            className="size-1.5 rounded-full bg-current"
            role="img"
            aria-label="Unsaved changes"
          />
        )}
      </TabsTrigger>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Close ${path}`}
        className="absolute right-1 size-5 text-muted-foreground"
        onClick={onClose}
      >
        <XIcon />
      </Button>
    </div>
  )
}

function FileEditor({
  diagnosticTarget,
  projectId,
  path,
  loaded,
  active,
  onSyncChange,
  onPeopleChange,
  scrollPositions,
  onChange,
}: {
  projectId: Id<"projects">
  path: string
  loaded: LoadedFile
  diagnosticTarget?: DiagnosticTarget
  active: boolean
  onSyncChange: (synced: boolean) => void
  onPeopleChange: (people: LivePerson[]) => void
  scrollPositions: Map<string, number>
  onChange: (text: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const viewport = container.current?.parentElement
    if (viewport) viewport.scrollTop = scrollPositions.get(path) ?? 0
  }, [path, scrollPositions])

  const file = useMemo(
    () => ({
      name: path,
      contents: loaded.contents,
      cacheKey: `${projectId}:${path}`,
    }),
    [loaded.contents, path, projectId]
  )

  const tooLarge =
    new TextEncoder().encode(loaded.contents).byteLength > MAX_SOURCE_BYTES
  const binary =
    loaded.contents.includes("\0") || loaded.contents.includes("\ufffd")
  return (
    <div ref={container} className="min-h-full">
      {loaded.truncated || tooLarge || binary ? (
        <>
          <p className="border-b px-4 py-2 text-xs text-muted-foreground">
            {binary
              ? "This file is not UTF-8 text and is read-only."
              : "Files larger than 256 KiB are read-only. Preview limited to 512 KiB."}
          </p>
          <File file={file} options={editorThemeOptions} />
        </>
      ) : (
        <LiveFileEditor
          projectId={projectId}
          path={path}
          active={active}
          diagnosticTarget={diagnosticTarget}
          onChange={onChange}
          onSyncChange={onSyncChange}
          onPeopleChange={onPeopleChange}
        />
      )}
    </div>
  )
}

// The bar extends the floating sidebar into an L. While the sidebar is open,
// the bar tucks 8px under the sidebar so the shared edge and rounded corner
// disappear; clip-path drops the bar's left outline and the `before` cover
// hides the part of its top outline that falls inside the sidebar. The `after`
// fillet rounds the inside corner where the sidebar meets the bar.
function ActionsBar({
  leftAction,
  activePath,
  children,
}: {
  activePath: string | null
  leftAction: React.ReactNode
  children: React.ReactNode
}) {
  const { isMobile, state } = useSidebar()
  const joined = !isMobile && state === "expanded"

  return (
    <div
      className={cn(
        "relative z-20 mr-2 mb-2 flex h-11 shrink-0 items-center gap-2 bg-sidebar px-2 text-sidebar-foreground shadow-[0_0_0_1px_var(--sidebar-border)]",
        joined
          ? cn(
              "-ml-4 rounded-r-lg pl-4 [clip-path:inset(calc(var(--radius-lg)*-1)_-1px_-1px_0)]",
              "before:absolute before:-top-px before:left-0 before:h-px before:w-2 before:bg-sidebar",
              "after:pointer-events-none after:absolute after:bottom-full after:left-2 after:size-(--radius-lg) after:bg-[radial-gradient(circle_at_100%_0,transparent_calc(var(--radius-lg)-1.5px),var(--sidebar-border)_calc(var(--radius-lg)-1px),var(--sidebar-border)_calc(var(--radius-lg)-0.5px),var(--sidebar)_var(--radius-lg))]"
            )
          : "ml-2 rounded-lg"
      )}
    >
      {leftAction}
      {/* On mobile the sidebar is a sheet, so the bar carries its toggle and
          the open file's path. */}
      {isMobile ? (
        <>
          <SidebarTrigger />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {activePath}
          </span>
        </>
      ) : (
        <div className="flex-1" />
      )}
      {children}
    </div>
  )
}

// Open on the program's entry point rather than whatever sorts first.
function pickEntryFile(paths: string[]) {
  return (
    paths.find((path) => /(^|\/)main\.(cpp|cc|c)$/.test(path)) ??
    paths.find((path) => path.endsWith(".cpp")) ??
    paths.at(0)
  )
}

function CommitDialog({
  open,
  onOpenChange,
  paths,
  onCommit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  paths: string[]
  onCommit: (message: string) => Promise<void>
}) {
  const [message, setMessage] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    try {
      await onCommit(message.trim())
      setMessage("")
      onOpenChange(false)
      toast.add({ type: "success", title: "Changes committed" })
    } catch (error) {
      toast.add({
        type: "error",
        title: "Could not commit",
        description: errorMessage(error),
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>Commit changes</DialogTitle>
            <DialogDescription>
              Saves to the program&apos;s <code>main</code> branch.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex max-h-40 flex-col gap-1 overflow-auto text-xs text-muted-foreground">
            {paths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
          <Field>
            <FieldLabel htmlFor="commit-message">Message</FieldLabel>
            <Input
              id="commit-message"
              required
              maxLength={200}
              value={message}
              placeholder="Tune autonomous turn speed"
              onChange={(event) => setMessage(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending || !message.trim()}>
              {pending && <Spinner data-icon="inline-start" />}
              Commit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
