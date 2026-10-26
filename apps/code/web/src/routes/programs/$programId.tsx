import type { FormatChange } from "@/components/editor/editor-formatting"
import { MachineStatus } from "@/components/program/machine-status"
import { ProgramPathPreview } from "@/components/program/program-path-preview"
import { ActionTooltip } from "@/components/shared/action-tooltip"
import { ProgramSearch } from "@/components/program/program-search"
import { ProgramHistory } from "@/components/program/program-history"
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
import {
  restrictToHorizontalAxis,
  restrictToParentElement,
} from "@dnd-kit/modifiers"
import {
  SortableContext,
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
  TextAlignLeftIcon,
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
import { Separator } from "@workspace/ui/components/separator"
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
  TooltipProvider,
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
  useSyncExternalStore,
} from "react"
import { RepositoryExplorer } from "@/components/repository/repository-explorer"
import { WorkbenchSource, type LoadedFile } from "@/lib/workbench-source"
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { LiveFileEditor, type LivePerson } from "@/components/editor/live-file-editor"
import { LanguageSession } from "@/components/editor/language-session"
import { MAX_SOURCE_BYTES } from "@/lib/live-document"
import { AuthGate } from "@/components/app/auth-gate"
import { errorMessage } from "@/lib/errors"
import {
  ProgramConnection,
  useProgramConnection,
} from "@/components/program/program-connection"
import { ProgramBuild } from "@/components/program/program-build"
import { ProgramUpload } from "@/components/program/program-upload"
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
  const { programId: rawProgramId } = Route.useParams()
  const programId = rawProgramId as Id<"programs">
  const program = useQuery(api.programs.get, { programId })

  if (program === undefined) {
    return <ProgramBootShape />
  }

  if (program.repositoryStatus === "ready") {
    return (
      <ProgramConnection key={program._id} programId={program._id}>
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

// Convex has no program result during SSR. Render the empty workbench frame so
// the page has its final shape before the program query hydrates.
function ProgramBootShape() {
  return (
    <SidebarProvider
      className="h-svh min-h-0"
      style={
        {
          "--sidebar-width": "18rem",
          "--sidebar-border":
            "color-mix(in oklab, var(--foreground) 20%, var(--background))",
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
        </SidebarHeader>
        <SidebarContent className="overflow-hidden" />
        <SidebarFooter className="items-start p-3" />
      </Sidebar>
      <SidebarInset className="min-h-0 min-w-0 pt-2">
        <div className="flex min-h-0 min-w-0 flex-1">
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
        </div>
        <ActionsBar activePath={null} leftAction={null}>
          {null}
        </ActionsBar>
      </SidebarInset>
    </SidebarProvider>
  )
}

function ProvisioningState({ program }: { program: Doc<"programs"> }) {
  const retry = useMutation(api.programs.retryProvisioning)

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
              retry({ programId: program._id }).catch((error) =>
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

function Workbench({ program }: { program: Doc<"programs"> }) {
  const binaries = useProgramBinaries()
  const { request: buildRequest } = useProgramConnection()
  const buildManifest = useAction(api.codeStorage.buildManifest)
  const listFiles = useAction(api.codeStorage.listFiles)
  const readFile = useAction(api.codeStorage.readFile)
  const commitFiles = useAction(api.codeStorage.commitFiles)
  const restoreHistoryFile = useAction(api.codeStorage.restoreHistoryFile)

  const [source] = useState(
    () =>
      new WorkbenchSource(program._id, {
        buildManifest,
        listFiles,
        readFile,
        commitFiles,
        restoreHistoryFile,
      })
  )
  const {
    paths,
    listError,
    openPaths,
    activePath,
    loaded,
    readError,
    dirtyPaths,
    filePeople,
  } = useSyncExternalStore(
    source.subscribe,
    source.getSnapshot,
    source.getSnapshot
  )
  const {
    prepareSource,
    loadPaths,
    openFile,
    readBytes,
    commit,
    restoreFile,
    applyExplorerUpdate,
    getDrafts: getSearchDrafts,
    subscribeDrafts: subscribeSearchDrafts,
  } = source
  const allSynced = source.isSynced()
  const tabSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const [diagnosticTarget, setDiagnosticTarget] = useState<
    (DiagnosticTarget & { path: string }) | null
  >(null)
  const [formatActions, setFormatActions] = useState<
    Record<string, (() => void) | null>
  >({})
  const onFormatChange = useCallback<FormatChange>((path, action) => {
    setFormatActions((current) => ({ ...current, [path]: action }))
  }, [])
  const formatFromKeyboard = useEffectEvent((event: KeyboardEvent) => {
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      event.shiftKey ||
      event.isComposing ||
      event.key.toLowerCase() !== "p"
    )
      return
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat && activePath) formatActions[activePath]?.()
  })
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => formatFromKeyboard(event)
    window.addEventListener("keydown", keydown, true)
    return () => window.removeEventListener("keydown", keydown, true)
  }, [])
  const [commitOpen, setCommitOpen] = useState(false)
  const savePending = useRef(false)
  useEffect(() => {
    void loadPaths()
  }, [loadPaths])

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
      if (source.getSnapshot().dirtyPaths.length === 0) return
      savePending.current = true
      void (async () => {
        try {
          await waitForSourceSync(source.isSynced, signal)
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

  function closeTab(path: string) {
    try {
      source.closeTab(path)
    } catch (error) {
      toast.add({
        type: "error",
        title: "This file is still syncing",
        description: errorMessage(error),
      })
    }
  }

  return (
    <LanguageSession
      template={program.template}
      prepareSource={source.prepareLanguageSource}
      onDefinition={(path, line, column) => {
        if (!paths?.includes(path)) return false
        setDiagnosticTarget((current) => ({
          path,
          line,
          column,
          request: (current?.request ?? 0) + 1,
        }))
        openFile(path)
        return true
      }}
    >
      <SidebarProvider
        className="h-svh min-h-0"
        style={
          {
            "--sidebar-width": "18rem",
            // The theme's border is translucent in dark mode, so it shifts shade
            // where the sidebar and bar outlines overlap. Use a stronger opaque
            // color so the joined shape's edge stays visible.
            "--sidebar-border":
              "color-mix(in oklab, var(--foreground) 20%, var(--background))",
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
                programId={program._id}
                style={treeStyle}
                readBytes={readBytes}
                apply={applyExplorerUpdate}
                onOpen={openFile}
              />
            )}
          </SidebarContent>
          <SidebarFooter className="h-9 flex-row items-center px-3 py-0">
            <AvatarGroup
              aria-label="People in this file"
              className="*:data-[slot=avatar]:ring-0.5"
            >
              {(activePath ? (filePeople[activePath] ?? []) : []).map(
                (person) => (
                  <Avatar
                    key={person.id}
                    className="size-5"
                    title={person.name}
                    aria-label={person.name}
                  >
                    {person.imageUrl && (
                      <AvatarImage src={person.imageUrl} alt={person.name} />
                    )}
                    <AvatarFallback
                      className="text-[0.5rem] leading-none"
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
            <MachineStatus />
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="min-h-0 min-w-0 pt-2">
          <div className="flex min-h-0 min-w-0 flex-1">
            <Tabs
              value={activePath}
              onValueChange={(value) => {
                if (typeof value === "string") openFile(value)
              }}
              className="min-h-0 min-w-0 flex-1 gap-0"
            >
              {openPaths.length > 0 && (
                <div className="shrink-0 overflow-x-auto overflow-y-hidden">
                  <DndContext
                    sensors={tabSensors}
                    collisionDetection={closestCenter}
                    modifiers={[
                      restrictToHorizontalAxis,
                      restrictToParentElement,
                    ]}
                    onDragEnd={({ active, over }) => {
                      if (!over || active.id === over.id) return
                      source.reorderTabs(String(active.id), String(over.id))
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
                    className="relative no-scrollbar min-h-0 overflow-auto"
                    onScroll={(event) => {
                      if (path === activePath) {
                        source.scrollPositions.set(
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
                        programId={program._id}
                        onFormatChange={onFormatChange}
                        path={path}
                        diagnosticTarget={
                          diagnosticTarget?.path === path
                            ? diagnosticTarget
                            : undefined
                        }
                        active={path === activePath}
                        onPeopleChange={(people) =>
                          source.setPeople(path, people)
                        }
                        onSyncChange={(synced) =>
                          source.setSynced(path, synced)
                        }
                        loaded={loaded[path]}
                        scrollPositions={source.scrollPositions}
                        onChange={(text) => source.setDraft(path, text)}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
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
                <ActionTooltip label="Format document">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Format document"
                    disabled={!activePath || !formatActions[activePath]}
                    onClick={() => {
                      if (activePath) formatActions[activePath]?.()
                    }}
                  >
                    <TextAlignLeftIcon />
                  </Button>
                </ActionTooltip>
                <ProgramHistory
                  programId={program._id}
                  revision={program.repositoryHeadSha}
                  canRestore={dirtyPaths.length === 0 && allSynced}
                  onRestore={restoreFile}
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
                      : `Commit ${dirtyPaths.length} ${dirtyPaths.length === 1 ? "file" : "files"}`}
                  </TooltipContent>
                </Tooltip>
                <ProgramSearch
                  programId={program._id}
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
              </>
            }
          >
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
                  commitChanges: async (commitSignal) => {
                    await waitForSourceSync(source.isSynced, commitSignal)
                    await commit("Save changes before upload")
                  },
                  prepareSource,
                  request: buildRequest,
                  signal,
                  onStage,
                })
              }
            />
            {(program.template === "ez-template" ||
              program.template === "jar") && (
              <>
                <Separator
                  orientation="vertical"
                  className="mx-1 h-5 self-center bg-sidebar-border"
                />
                <ProgramPathPreview
                  programId={program._id}
                  revision={program.repositoryHeadSha}
                  template={program.template}
                  paths={paths}
                  getDrafts={getSearchDrafts}
                  subscribeDrafts={subscribeSearchDrafts}
                />
              </>
            )}
          </ActionsBar>
        </SidebarInset>
        <CommitDialog
          open={commitOpen}
          onOpenChange={setCommitOpen}
          paths={dirtyPaths}
          onCommit={commit}
        />
      </SidebarProvider>
    </LanguageSession>
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
        isDragging && "z-10"
      )}
      style={{
        transform: CSS.Transform.toString(
          transform ? { ...transform, y: 0 } : null
        ),
        transition,
      }}
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
        className={cn(
          "flex-none touch-pan-y px-3 pr-8",
          isDragging &&
            "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30 dark:text-foreground"
        )}
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
  onFormatChange,
  diagnosticTarget,
  programId,
  path,
  loaded,
  active,
  onSyncChange,
  onPeopleChange,
  scrollPositions,
  onChange,
}: {
  programId: Id<"programs">
  path: string
  loaded: LoadedFile
  onFormatChange: FormatChange
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
      cacheKey: `${programId}:${path}`,
    }),
    [loaded.contents, path, programId]
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
          onFormatChange={onFormatChange}
          programId={programId}
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
    <TooltipProvider>
      <div
        className={cn(
          "relative z-20 mr-2 mb-2 flex h-9 shrink-0 items-center gap-0.5 bg-sidebar px-2 text-sidebar-foreground shadow-[0_0_0_1px_var(--sidebar-border)]",
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
            <ActionTooltip label="Toggle sidebar">
              <SidebarTrigger />
            </ActionTooltip>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {activePath}
            </span>
          </>
        ) : (
          <div className="flex-1" />
        )}
        {children}
      </div>
    </TooltipProvider>
  )
}

// Open on the program's entry point rather than whatever sorts first.
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
