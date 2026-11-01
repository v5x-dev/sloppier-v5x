import { ProgramSearch } from "@/components/program/program-search"
import { ProgramHistory } from "@/components/program/program-history"
import {
  LiveFileEditor,
  type LivePerson,
} from "@/components/editor/live-file-editor"
import {
  MIN_GROUP_SIZE,
  bodyDropTarget,
  groupsOf,
  type DropTarget,
  type EditorGroup,
  type LayoutNode,
} from "@/lib/editor-groups"
import { editorThemeOptions } from "@/lib/editor-theme"
import { MAX_SOURCE_BYTES } from "@/lib/live-document"
import { File } from "@pierre/diffs/react"
import { ActionsBar } from "@/components/program/program-actions-bar"
import type { FormatChange } from "@/components/editor/editor-formatting"
import { ActionGroup } from "@/components/shared/action-group"
import { ActionTooltip } from "@/components/shared/action-tooltip"
import type { DiagnosticTarget } from "@/lib/build-diagnostics"
import { shortcutKeys } from "@/lib/keyboard-shortcuts"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDndContext,
  useSensor,
  useSensors,
  type Active,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  CaretLeftIcon,
  FileDashedIcon,
  GitCommitIcon,
  ListMagnifyingGlassIcon,
  TextAlignLeftIcon,
  ColumnsIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import type { Doc, Id } from "@v5x/backend/dataModel"
import { Button } from "@v5x/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@v5x/ui/components/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@v5x/ui/components/empty"
import { Field, FieldLabel } from "@v5x/ui/components/field"
import { Input } from "@v5x/ui/components/input"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from "@v5x/ui/components/sidebar"
import { cn } from "@v5x/ui/lib/utils"
import { Spinner } from "@v5x/ui/components/spinner"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@v5x/ui/components/tabs"
import { toast } from "@v5x/ui/components/toast"
import { createPortal } from "react-dom"
import { FileTree, useFileTree } from "@pierre/trees/react"
import { makefileIcons } from "@/lib/makefile-icons"

import {
  Fragment,
  lazy,
  Suspense,
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
import type { WorkbenchSource, LoadedFile } from "@/lib/workbench-source"
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from "@v5x/ui/components/avatar"
import { LanguageSession } from "@/components/editor/language-session"
import { commitFormattedSource } from "@/lib/commit-formatted-source"
import { errorMessage } from "@/lib/errors"
import { useProgramConnection } from "@/components/program/program-connection"
import { useProgramBinaries } from "@/hooks/use-program-binaries"
import { prepareUploadBuild, waitForSourceSync } from "@/lib/build-program"

const loadProgramBuild = () => import("@/components/program/program-build")
const ProgramBuild = lazy(() =>
  loadProgramBuild().then((module) => ({ default: module.ProgramBuild }))
)
const ProgramUpload = lazy(() =>
  import("@/components/program/program-upload").then((module) => ({
    default: module.ProgramUpload,
  }))
)
const ProgramSymbols = lazy(() =>
  import("@/components/program/program-symbols").then((module) => ({
    default: module.ProgramSymbols,
  }))
)
const ProgramPathPreview = lazy(() =>
  import("@/components/program/program-path-preview").then((module) => ({
    default: module.ProgramPathPreview,
  }))
)

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

export function Workbench({
  program,
  source,
}: {
  program: Doc<"programs">
  source: WorkbenchSource
}) {
  const [showSymbols, setShowSymbols] = useState(false)
  const editorArea = useRef<HTMLDivElement>(null)
  useEffect(() => {
    void loadProgramBuild().catch(() => {})
  }, [])
  // dnd-kit's move events carry no modifier keys, so the latest pointer's are kept here.
  const dragModifiers = useRef({ altKey: false, shiftKey: false })
  useEffect(() => {
    const track = (event: PointerEvent) => {
      dragModifiers.current = { altKey: event.altKey, shiftKey: event.shiftKey }
    }
    window.addEventListener("pointermove", track, true)
    return () => window.removeEventListener("pointermove", track, true)
  }, [])
  // The file being dragged and the editor group zone it would drop into.
  const [drag, setDrag] = useState<DragSource | null>(null)
  const [treeDragPosition, setTreeDragPosition] = useState<{
    x: number
    y: number
  } | null>(null)
  const [dropHighlight, setDropHighlight] = useState<DropHighlight | null>(null)
  const [cursor, setCursor] = useState<{ path: string; line: number } | null>(
    null
  )
  const binaries = useProgramBinaries()
  const { request: buildRequest, status: buildStatus } = useProgramConnection()
  const [uploadProgress, setUploadProgress] = useState<{
    label: string
    value: number | null
  } | null>(null)
  const {
    paths,
    listError,
    layout,
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
    restoreCommit,
    applyExplorerUpdate,
    placeTab,
    activateTab,
    activateGroup,
    splitGroup,
    resizeSash,
    equalizeSplit,
  } = source
  // Explorer drags use window pointer events, because the tree handles its own
  // pointer input.
  const beginFileDrag = (path: string, event: React.PointerEvent) => {
    const startX = event.clientX,
      startY = event.clientY
    let dragging = false
    const move = (e: PointerEvent) => {
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) > 6) {
        dragging = true
        setDrag({ path, groupId: null })
      }
      if (dragging) {
        setTreeDragPosition({ x: e.clientX, y: e.clientY })
        setDropHighlight(
          dropAt(
            e.clientX,
            e.clientY,
            { path, groupId: null },
            undefined,
            splitsOnDrop(e)
          )
        )
      }
    }
    const finish = (e: PointerEvent) => {
      stop()
      setDrag(null)
      setTreeDragPosition(null)
      setDropHighlight(null)
      if (!dragging) return
      const drop = dropAt(
        e.clientX,
        e.clientY,
        { path, groupId: null },
        undefined,
        splitsOnDrop(e)
      )
      if (drop) placeTab(path, null, drop.target)
    }
    const cancel = () => {
      stop()
      setDrag(null)
      setTreeDragPosition(null)
      setDropHighlight(null)
    }
    const stop = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", cancel)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", cancel)
  }
  const allSynced = source.isSynced()
  const tabSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  // Tabs reorder only within their own strip, so drags across groups are resolved
  // from the pointer instead of from sortable collisions.
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const containerId = args.active.data.current?.sortable?.containerId
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (container) =>
          container.data.current?.sortable?.containerId === containerId
      ),
    })
  }, [])
  const resolveTabDrop = (
    event: DragMoveEvent | DragEndEvent,
    dragged: DragSource
  ): DropHighlight | null => {
    const over = event.over?.data.current?.sortable
    if (!(event.activatorEvent instanceof MouseEvent)) {
      // Keyboard drags reorder within the strip of the tab they land on.
      return over
        ? {
            target: {
              kind: "tabs",
              groupId: String(over.containerId),
              index: over.index,
            },
            beforePath: null,
          }
        : null
    }
    const x = event.activatorEvent.clientX + event.delta.x
    const y = event.activatorEvent.clientY + event.delta.y
    const group = groupsOf(layout).find((entry) => entry.id === dragged.groupId)
    const sameStripIndex =
      dragged.groupId === null
        ? undefined
        : over?.containerId === dragged.groupId
          ? over.index
          : (group?.paths.length ?? 1) - 1
    return dropAt(
      x,
      y,
      dragged,
      sameStripIndex,
      splitsOnDrop(dragModifiers.current)
    )
  }
  const [diagnosticTarget, setDiagnosticTarget] = useState<
    (DiagnosticTarget & { path: string }) | null
  >(null)
  const [formatActions, setFormatActions] = useState<
    Record<string, (() => Promise<void>) | null>
  >({})
  const formatActionsRef = useRef(formatActions)
  const onFormatChange = useCallback<FormatChange>((path, action) => {
    formatActionsRef.current = { ...formatActionsRef.current, [path]: action }
    setFormatActions((current) => ({ ...current, [path]: action }))
  }, [])
  const formatManually = (path: string) => {
    void formatActionsRef.current[path]?.().catch((error) =>
      toast.add({
        type: "error",
        title: "Could not format document",
        description: errorMessage(error),
      })
    )
  }
  const commitFormatted = async (
    message: string | undefined,
    signal: AbortSignal
  ) => {
    await commitFormattedSource(
      source,
      () => formatActionsRef.current,
      message,
      signal
    )
  }
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
    if (!event.repeat && activePath) formatManually(activePath)
  })
  const [commitOpen, setCommitOpen] = useState(false)
  const commitLabel = `Commit ${dirtyPaths.length} ${dirtyPaths.length === 1 ? "file" : "files"}`
  const savePending = useRef(false)
  useEffect(() => {
    void source.refreshRepository()
  }, [source, program.repositoryHeadSha])

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
          await commitFormatted(undefined, signal)
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

  const splitFromKeyboard = useEffectEvent((event: KeyboardEvent) => {
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      event.shiftKey ||
      event.isComposing ||
      event.key !== "\\"
    )
      return
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat) splitGroup(layout.activeGroupId)
  })

  // VS Code's group focus chord: Ctrl/Cmd+K, then Ctrl/Cmd+Arrow moves focus to the
  // neighboring group. The chord expires after a short pause.
  const chordStartedAt = useRef(0)
  const focusGroupFromKeyboard = useEffectEvent((event: KeyboardEvent) => {
    // Pressing the modifier itself between the chord's keys must not cancel the chord.
    if (MODIFIER_KEYS.has(event.key)) return
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      event.shiftKey ||
      event.isComposing
    )
      return
    // Ctrl/Cmd+1 to 8 focus that group; Ctrl/Cmd+9 focuses the last tab of the active group.
    if (/^[1-9]$/.test(event.key)) {
      event.preventDefault()
      event.stopPropagation()
      const digit = Number(event.key)
      if (digit === 9) {
        const active = groupsOf(layout).find(
          (group) => group.id === layout.activeGroupId
        )
        const last = active?.paths.at(-1)
        if (active && last) activateTab(active.id, last)
        requestAnimationFrame(() => focusGroupEditor(layout.activeGroupId))
        return
      }
      const target = groupsOf(layout).at(digit - 1)
      if (!target) return
      activateGroup(target.id)
      requestAnimationFrame(() => focusGroupEditor(target.id))
      return
    }
    const chordOpen = Date.now() - chordStartedAt.current < CHORD_TIMEOUT_MS
    if (!chordOpen) {
      if (event.key.toLowerCase() !== "k") return
      event.preventDefault()
      event.stopPropagation()
      chordStartedAt.current = Date.now()
      return
    }
    chordStartedAt.current = 0
    const direction = GROUP_FOCUS_KEYS[event.key]
    if (!direction) return
    event.preventDefault()
    event.stopPropagation()
    const next = neighborGroupId(layout.activeGroupId, direction)
    if (!next) return
    activateGroup(next)
    focusGroupEditor(next)
  })

  // One capture listener serves the workbench shortcuts; each ignores keys it does not own.
  useEffect(() => {
    const controller = new AbortController()
    const onKeyDown = (event: KeyboardEvent) => {
      formatFromKeyboard(event)
      saveFromKeyboard(event, controller.signal)
      splitFromKeyboard(event)
      focusGroupFromKeyboard(event)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => {
      controller.abort()
      window.removeEventListener("keydown", onKeyDown, true)
    }
  }, [])

  function closeTab(groupId: string, path: string) {
    try {
      source.closeTab(groupId, path)
    } catch (error) {
      toast.add({
        type: "error",
        title: "This file is still syncing",
        description: errorMessage(error),
      })
    }
  }

  // A group is a tab strip over its own editor stack. A file open in two groups
  // mounts two editors, both reading the same `loaded` entry.
  function renderPane(group: EditorGroup) {
    const focused = group.id === layout.activeGroupId
    const highlight =
      dropHighlight?.target.groupId === group.id ? dropHighlight : null
    const drop = highlight?.target
    // Same-strip reorders show the sortable shift instead of an insertion bar.
    const tabDrop =
      highlight?.target.kind === "tabs" && drag?.groupId !== group.id
        ? highlight
        : null
    return (
      <Tabs
        data-editor-group={group.id}
        value={group.activePath}
        onValueChange={(value) => {
          if (typeof value === "string") activateTab(group.id, value)
        }}
        onPointerDownCapture={() => activateGroup(group.id)}
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-0"
      >
        {group.paths.length > 0 && (
          <div
            data-editor-tabs
            className="flex min-w-0 shrink-0 items-center gap-1 px-1 pb-1"
          >
            <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
              <SortableContext
                id={group.id}
                items={group.paths.map((path) => tabId(group.id, path))}
                strategy={horizontalListSortingStrategy}
              >
                <SortableTabsList
                  aria-label="Open files"
                  variant="line"
                  className="h-auto! justify-start gap-0.5 surface-inset p-0.5 data-[variant=line]:rounded-[10px]"
                >
                  {group.paths.map((path) => (
                    <SortableFileTab
                      key={path}
                      id={tabId(group.id, path)}
                      path={path}
                      dirty={dirtyPaths.includes(path)}
                      focused={focused}
                      dropBefore={tabDrop?.beforePath === path}
                      onClose={() => closeTab(group.id, path)}
                    />
                  ))}
                  {tabDrop && tabDrop.beforePath === null && (
                    <span
                      aria-hidden
                      className="h-4 w-0.5 shrink-0 rounded-full bg-primary"
                    />
                  )}
                </SortableTabsList>
              </SortableContext>
            </div>
            <ActionTooltip label="Split editor" shortcut={shortcutKeys("\\")}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Split editor"
                disabled={!group.activePath}
                onClick={() => splitGroup(group.id)}
              >
                <ColumnsIcon />
              </Button>
            </ActionTooltip>
          </div>
        )}
        <div
          data-editor-body
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {group.paths.map((path) => (
            <TabsContent
              // Each file owns its scroll container and stays mounted while
              // inactive, retaining its selection, draft, and undo history.
              key={loaded[path]?.editorKey ?? path}
              value={path}
              keepMounted
              ref={(panel) => {
                if (panel) updateScrollFade(panel)
              }}
              className="relative no-scrollbar min-h-0 min-w-0 flex-1 overflow-auto [mask-image:linear-gradient(to_bottom,transparent,black_var(--fade-top,0px),black_calc(100%_-_var(--fade-bottom,0px)),transparent)] [-webkit-mask-image:linear-gradient(to_bottom,transparent,black_var(--fade-top,0px),black_calc(100%_-_var(--fade-bottom,0px)),transparent)]"
              onScroll={(event) => {
                updateScrollFade(event.currentTarget)
                if (group.activePath === path) {
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
                  viewId={group.id}
                  onFormatChange={onFormatChange}
                  path={path}
                  diagnosticTarget={
                    diagnosticTarget?.path === path
                      ? diagnosticTarget
                      : undefined
                  }
                  active={group.activePath === path}
                  onCursorLine={(cursorPath, line) =>
                    setCursor((current) =>
                      current?.path === cursorPath && current.line === line
                        ? current
                        : { path: cursorPath, line }
                    )
                  }
                  onPeopleChange={(people) => source.setPeople(path, people)}
                  onSyncChange={(synced) => source.setSynced(path, synced)}
                  loaded={loaded[path]}
                  takeLiveOpen={source.takeLiveOpen}
                  scrollPositions={source.scrollPositions}
                  onChange={(text) => source.setDraft(path, text)}
                  onReplacementAction={source.setReplacementAction}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Spinner className="text-muted-foreground" />
                </div>
              )}
            </TabsContent>
          ))}
          {drop && drop.kind !== "tabs" && (
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute z-30 bg-primary/15",
                drop.kind === "group" ? "inset-0" : dropEdgeClass[drop.side]
              )}
            />
          )}
          {openPaths.length === 0 && paths === null && !listError && (
            <div className="flex flex-1 items-center justify-center">
              <Spinner className="text-muted-foreground" />
            </div>
          )}
          {openPaths.length === 0 && (paths !== null || listError) && (
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
        </div>
      </Tabs>
    )
  }

  // A split lays its children out in a row or a column. The sashes between
  // children resize their neighbors, and double-clicking one evens out its split.
  function renderNode(node: LayoutNode, path: number[]): React.ReactNode {
    if (node.kind === "group") return renderPane(node.group)
    return (
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1",
          node.axis === "column" && "flex-col"
        )}
      >
        {node.children.map((child, index) => (
          <Fragment key={firstGroupId(child)}>
            {index > 0 && renderSash(node, path, index - 1)}
            <div
              className="flex min-h-0 min-w-0"
              style={{ flex: `0 0 ${child.size * 100}%` }}
            >
              {renderNode(child, [...path, index])}
            </div>
          </Fragment>
        ))}
      </div>
    )
  }

  function renderSash(
    split: Extract<LayoutNode, { kind: "split" }>,
    path: number[],
    index: number
  ) {
    const column = split.axis === "column"
    const position = split.children
      .slice(0, index + 1)
      .reduce((total, child) => total + child.size, 0)
    return (
      <div
        role="separator"
        aria-label={column ? "Resize editor rows" : "Resize editor groups"}
        aria-orientation={column ? "horizontal" : "vertical"}
        aria-valuemin={Math.round(MIN_GROUP_SIZE * 100)}
        aria-valuemax={Math.round((1 - MIN_GROUP_SIZE) * 100)}
        aria-valuenow={Math.round(position * 100)}
        tabIndex={0}
        className={cn(
          "relative z-20 shrink-0 touch-none",
          column ? "h-0 w-full cursor-row-resize" : "w-0 cursor-col-resize"
        )}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          // The sash is a child of its split, so the split gives the extent.
          const rect =
            event.currentTarget.parentElement?.getBoundingClientRect()
          const extent = column ? rect?.height : rect?.width
          if (!rect || !extent) return
          const share = column
            ? (event.clientY - rect.top) / extent
            : (event.clientX - rect.left) / extent
          resizeSash(path, index, share)
        }}
        onDoubleClick={() => equalizeSplit(path)}
        onKeyDown={(event) => {
          const back = column ? "ArrowUp" : "ArrowLeft"
          const forward = column ? "ArrowDown" : "ArrowRight"
          if (event.key !== back && event.key !== forward) return
          event.preventDefault()
          resizeSash(
            path,
            index,
            position + (event.key === forward ? 0.02 : -0.02)
          )
        }}
      >
        <span
          className={cn(
            "absolute",
            column
              ? "inset-x-0 -top-1 h-2 after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-border hover:after:bg-primary focus-visible:after:bg-primary"
              : "inset-y-0 -left-1 w-2 after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-border hover:after:bg-primary focus-visible:after:bg-primary"
          )}
        />
      </div>
    )
  }

  return (
    <LanguageSession
      key={`${program._id}:${program.template}`}
      template={program.template}
      source={source}
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
            {showSymbols && (
              <Suspense
                fallback={
                  <div className="flex min-h-0 flex-1 items-center justify-center">
                    <Spinner className="text-muted-foreground" />
                  </div>
                }
              >
                <ProgramSymbols />
              </Suspense>
            )}
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col",
                showSymbols && "hidden"
              )}
            >
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
                  onFilePointerDown={beginFileDrag}
                />
              )}
            </div>
          </SidebarContent>
          <SidebarFooter className="h-11 flex-row items-center py-0 pr-3 pl-2">
            <AvatarGroup
              aria-label="People in this file"
              className="*:data-[slot=avatar]:ring-0.5"
            >
              {(activePath ? (filePeople[activePath] ?? []) : []).map(
                (person) => (
                  <Avatar
                    key={person.id}
                    className={cn("size-7", !person.active && "grayscale")}
                    title={
                      person.active ? person.name : `${person.name} (away)`
                    }
                    aria-label={person.name}
                  >
                    {person.imageUrl && (
                      <AvatarImage src={person.imageUrl} alt={person.name} />
                    )}
                    <AvatarFallback
                      className="text-[0.625rem] leading-none"
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
            <div className="ml-auto">
              <ActionTooltip
                label={showSymbols ? "Show files" : "Program symbols"}
              >
                <Button
                  variant={showSymbols ? "secondary" : "ghost"}
                  size="icon-sm"
                  aria-label="Program symbols"
                  aria-pressed={showSymbols}
                  onClick={() => setShowSymbols((value) => !value)}
                >
                  <ListMagnifyingGlassIcon />
                </Button>
              </ActionTooltip>
            </div>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="min-h-0 min-w-0 pt-2">
          <div className="flex min-h-0 min-w-0 flex-1">
            <DndContext
              sensors={tabSensors}
              collisionDetection={collisionDetection}
              onDragStart={({ active }: DragStartEvent) =>
                setDrag(dragSourceOf(active))
              }
              onDragMove={(event) =>
                setDropHighlight(
                  resolveTabDrop(event, dragSourceOf(event.active))
                )
              }
              onDragEnd={(event) => {
                const dragged = dragSourceOf(event.active)
                const drop = resolveTabDrop(event, dragged)
                setDrag(null)
                setDropHighlight(null)
                if (drop) placeTab(dragged.path, dragged.groupId, drop.target)
              }}
              onDragCancel={() => {
                setDrag(null)
                setDropHighlight(null)
              }}
            >
              <div ref={editorArea} className="flex min-h-0 min-w-0 flex-1">
                {renderNode(layout.root, [])}
              </div>
              <DragOverlay dropAnimation={null}>
                {drag?.groupId && <TabChip key={drag.path} path={drag.path} />}
              </DragOverlay>
              {drag?.groupId === null &&
                treeDragPosition &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    aria-hidden="true"
                    className="pointer-events-none fixed z-50"
                    style={{
                      left: treeDragPosition.x + 14,
                      top: treeDragPosition.y + 14,
                    }}
                  >
                    <TabChip key={drag.path} path={drag.path} />
                  </div>,
                  document.body
                )}
            </DndContext>
          </div>
          <ActionsBar
            progress={
              uploadProgress ??
              (buildStatus?.building
                ? { label: "Building Program", value: null }
                : null)
            }
            leftAction={
              <ActionGroup label="Editor tools">
                {activePath && formatActions[activePath] && (
                  <ActionTooltip
                    label="Format document"
                    shortcut={shortcutKeys("P")}
                  >
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Format document"
                      onClick={() => formatManually(activePath)}
                    >
                      <TextAlignLeftIcon />
                    </Button>
                  </ActionTooltip>
                )}
                <ProgramHistory
                  programId={program._id}
                  revision={program.repositoryHeadSha}
                  canRestore={dirtyPaths.length === 0 && allSynced}
                  onRestore={restoreCommit}
                />
                {dirtyPaths.length > 0 && (
                  <ActionTooltip
                    label={commitLabel}
                    shortcut={shortcutKeys("S")}
                  >
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={commitLabel}
                      onClick={() => setCommitOpen(true)}
                    >
                      <GitCommitIcon />
                      <span
                        aria-hidden="true"
                        className="absolute top-1 right-1 size-1.5 rounded-full bg-primary"
                      />
                    </Button>
                  </ActionTooltip>
                )}
                <ProgramSearch
                  programId={program._id}
                  revision={program.repositoryHeadSha}
                  drafts={source}
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
              </ActionGroup>
            }
          >
            <Suspense
              fallback={<Spinner className="mx-3 text-muted-foreground" />}
            >
              <ProgramUpload
                onActivityChange={setUploadProgress}
                currentSha={program.repositoryHeadSha}
                buildAction={
                  <Suspense
                    fallback={<span className="size-8" aria-hidden="true" />}
                  >
                    <ProgramBuild
                      programId={program._id}
                      dirty={dirtyPaths.length > 0}
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
                  </Suspense>
                }
                name={program.name}
                programId={program._id}
                dirty={dirtyPaths.length > 0}
                prepareProgram={(signal, onStage, isInstalled) =>
                  prepareUploadBuild({
                    commitChanges: async (commitSignal) => {
                      await waitForSourceSync(source.isSynced, commitSignal)
                      await commitFormatted(
                        "Save changes before upload",
                        commitSignal
                      )
                    },
                    prepareSource,
                    request: buildRequest,
                    signal,
                    onStage,
                    isInstalled,
                  })
                }
              />
            </Suspense>
            {(program.template === "ez-template" ||
              program.template === "jar") && (
              <Suspense
                fallback={<span className="size-8" aria-hidden="true" />}
              >
                <ProgramPathPreview
                  programId={program._id}
                  revision={program.repositoryHeadSha}
                  template={program.template}
                  paths={paths}
                  drafts={source}
                  cursor={cursor?.path === activePath ? cursor : null}
                />
              </Suspense>
            )}
          </ActionsBar>
        </SidebarInset>
        <CommitDialog
          open={commitOpen}
          onOpenChange={setCommitOpen}
          paths={dirtyPaths}
          onCommit={async (message) => {
            await waitForSourceSync(
              source.isSynced,
              new AbortController().signal
            )
            await commitFormatted(message, new AbortController().signal)
          }}
        />
      </SidebarProvider>
    </LanguageSession>
  )
}

type DragSource = { path: string; groupId: string | null }
type DropHighlight = { target: DropTarget; beforePath: string | null }
const CHORD_TIMEOUT_MS = 2000
const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "Shift"])
const GROUP_FOCUS_KEYS: Partial<
  Record<string, "left" | "right" | "up" | "down">
> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
}

/**
 * The group that sits beside a group in a direction. Like VS Code, it prefers the
 * nearest group whose extent overlaps the current group on the perpendicular axis.
 */
function neighborGroupId(
  groupId: string,
  direction: "left" | "right" | "up" | "down"
): string | null {
  const panes = [
    ...document.querySelectorAll<HTMLElement>("[data-editor-group]"),
  ]
  const current = panes
    .find((pane) => pane.dataset.editorGroup === groupId)
    ?.getBoundingClientRect()
  if (!current) return null
  let best: { id: string; gap: number } | null = null
  for (const pane of panes) {
    const id = pane.dataset.editorGroup ?? ""
    if (id === groupId) continue
    const rect = pane.getBoundingClientRect()
    const overlapsX = rect.left < current.right && rect.right > current.left
    const overlapsY = rect.top < current.bottom && rect.bottom > current.top
    const gap =
      direction === "left"
        ? current.left - rect.right
        : direction === "right"
          ? rect.left - current.right
          : direction === "up"
            ? current.top - rect.bottom
            : rect.top - current.bottom
    const beside =
      direction === "left" || direction === "right" ? overlapsY : overlapsX
    if (!beside || gap < -1) continue
    if (!best || gap < best.gap) best = { id, gap }
  }
  return best?.id ?? null
}

/** Focuses the visible editor of a group, so keystrokes go to that group. */
function focusGroupEditor(groupId: string) {
  const panel = document.querySelector<HTMLElement>(
    `[data-editor-group="${groupId}"] [data-editor-body] [role="tabpanel"]:not([hidden])`
  )
  if (panel) findInShadowTree(panel, '[role="textbox"]')?.focus()
}

/** The first match in a tree, looking through the shadow roots of the editor's elements. */
function findInShadowTree(
  root: ParentNode,
  selector: string
): HTMLElement | null {
  const match = root.querySelector<HTMLElement>(selector)
  if (match) return match
  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    const inner =
      element.shadowRoot && findInShadowTree(element.shadowRoot, selector)
    if (inner) return inner
  }
  return null
}

const dropEdgeClass: Record<"left" | "right" | "top" | "bottom", string> = {
  left: "inset-y-0 left-0 w-1/2",
  right: "inset-y-0 right-0 w-1/2",
  top: "inset-x-0 top-0 h-1/2",
  bottom: "inset-x-0 bottom-0 h-1/2",
}

function firstGroupId(node: LayoutNode): string {
  return node.kind === "group" ? node.group.id : firstGroupId(node.children[0])
}

// Sortable ids are unique across groups, since one file can be open in several.
const tabId = (groupId: string, path: string) => `${groupId}|${path}`

function dragSourceOf(active: Active): DragSource {
  const data = active.data.current
  return {
    path: String(data?.path),
    groupId: data?.sortable ? String(data.sortable.containerId) : null,
  }
}

/**
 * Splitting is on by default. Like VS Code, holding Alt (Shift on macOS) drops
 * into the group instead.
 */
function splitsOnDrop(event: { altKey: boolean; shiftKey: boolean }) {
  const apple = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
  return !(apple ? event.shiftKey : event.altKey)
}

/**
 * The drop zone under the pointer, as VS Code offers it: a tab strip inserts at a
 * position, the outer band of a group's body splits it on the nearest side, and
 * the middle moves the file into that group. `sameStripIndex` sets the position inside the dragged
 * tab's own strip, where the sortable tracks the pointer instead.
 */
function dropAt(
  x: number,
  y: number,
  drag: DragSource,
  sameStripIndex?: number,
  splitting = true
): DropHighlight | null {
  for (const pane of document.querySelectorAll<HTMLElement>(
    "[data-editor-group]"
  )) {
    const rect = pane.getBoundingClientRect()
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)
      continue
    const groupId = pane.dataset.editorGroup ?? ""
    const strip = pane.querySelector<HTMLElement>("[data-editor-tabs]")
    if (strip && y <= strip.getBoundingClientRect().bottom) {
      if (groupId === drag.groupId)
        return sameStripIndex === undefined
          ? null
          : {
              target: { kind: "tabs", groupId, index: sameStripIndex },
              beforePath: null,
            }
      const others = [
        ...strip.querySelectorAll<HTMLElement>("[data-tab-path]"),
      ].filter((tab) => tab.dataset.tabPath !== drag.path)
      const after = others.find((tab) => {
        const tabRect = tab.getBoundingClientRect()
        return x < tabRect.left + tabRect.width / 2
      })
      return {
        target: {
          kind: "tabs",
          groupId,
          index: after ? others.indexOf(after) : others.length,
        },
        beforePath: after?.dataset.tabPath ?? null,
      }
    }
    const body =
      pane
        .querySelector<HTMLElement>("[data-editor-body]")
        ?.getBoundingClientRect() ?? rect
    const target = bodyDropTarget(
      groupId,
      (x - body.left) / body.width,
      (y - body.top) / body.height,
      splitting
    )
    return { target, beforePath: null }
  }
  return null
}

function TabChip({ path }: { path: string }) {
  const name = path.split("/").at(-1) ?? path
  const { model } = useFileTree({
    paths: [name],
    initialSelectedPaths: [name],
    density: "compact",
    icons: makefileIcons,
    unsafeCSS: `[data-type="item"][data-item-selected="true"]:before {
      content: ""; position: absolute; inset: 0; pointer-events: none;
      border-radius: var(--trees-border-radius);
      outline: var(--trees-focus-ring-width) solid var(--trees-selected-focused-border-color);
      outline-offset: var(--trees-focus-ring-offset);
    }`,
  })
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none w-48 overflow-hidden rounded-md shadow-overlay"
    >
      <FileTree
        model={model}
        style={
          {
            ...treeStyle,
            height: "24px",
            "--trees-bg-override": "transparent",
          } as React.CSSProperties
        }
      />
    </div>
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
  id,
  path,
  dirty,
  focused,
  dropBefore,
  onClose,
}: {
  id: string
  path: string
  dirty: boolean
  /** False in a group that is not the active one, so its selected tab reads quieter. */
  focused: boolean
  dropBefore: boolean
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
  } = useSortable({ id, data: { path } })

  return (
    <div
      ref={setNodeRef}
      data-tab-path={path}
      className={cn(
        "group/tab relative flex shrink-0 items-center",
        isDragging && "z-10",
        dropBefore &&
          "before:absolute before:inset-y-1 before:-left-px before:w-0.5 before:rounded-full before:bg-primary"
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
          "h-7 flex-none touch-pan-y rounded-lg border-0 px-3 pr-8 font-normal text-muted-foreground transition-[translate,box-shadow,color] duration-100 after:hidden active:translate-y-px",
          "data-active:bg-secondary! data-active:text-foreground data-active:shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(0_0_0/0.3),0_0_0_1px_color-mix(in_oklab,var(--secondary),white_7%)]!",
          !focused && "data-active:bg-secondary/50! data-active:shadow-none!",
          isDragging && "opacity-50"
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
  viewId,
  path,
  loaded,
  active,
  onSyncChange,
  onPeopleChange,
  scrollPositions,
  onChange,
  onReplacementAction,
  onCursorLine,
  takeLiveOpen,
}: {
  programId: Id<"programs">
  viewId: string
  path: string
  loaded: LoadedFile
  onFormatChange: FormatChange
  diagnosticTarget?: DiagnosticTarget
  active: boolean
  onSyncChange: (synced: boolean) => void
  onPeopleChange: (people: LivePerson[]) => void
  scrollPositions: Map<string, number>
  onChange: (text: string) => void
  onReplacementAction: WorkbenchSource["setReplacementAction"]
  onCursorLine: (path: string, line: number) => void
  takeLiveOpen: WorkbenchSource["takeLiveOpen"]
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
          takeLiveOpen={takeLiveOpen}
          programId={programId}
          viewId={viewId}
          path={path}
          active={active}
          diagnosticTarget={diagnosticTarget}
          onChange={onChange}
          onSyncChange={onSyncChange}
          onPeopleChange={onPeopleChange}
          onReplacementAction={onReplacementAction}
          onCursorLine={onCursorLine}
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
// Fades only the edges with code beyond them, so a file's first and last lines
// stay solid. The mask on each editor panel reads these two variables.
const SCROLL_FADE = "2rem"
function updateScrollFade(panel: HTMLElement) {
  const { scrollTop, scrollHeight, clientHeight } = panel
  panel.style.setProperty("--fade-top", scrollTop > 0 ? SCROLL_FADE : "0px")
  panel.style.setProperty(
    "--fade-bottom",
    scrollTop + clientHeight < scrollHeight - 1 ? SCROLL_FADE : "0px"
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
