import type { FormatChange } from "@/components/editor/editor-formatting"
import { ActionTooltip } from "@/components/shared/action-tooltip"
import type { DiagnosticTarget } from "@/lib/build-diagnostics"
import {
  MIN_GROUP_SIZE,
  type EditorGroup,
  type LayoutNode,
} from "@/lib/editor-groups"
import { shortcutKeys } from "@/lib/keyboard-shortcuts"
import {
  SortableContext,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable"
import {
  ColumnsIcon,
  FileDashedIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import type { Id } from "@v5x/backend/dataModel"
import { Button } from "@v5x/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@v5x/ui/components/empty"
import { Spinner } from "@v5x/ui/components/spinner"
import { Tabs, TabsContent } from "@v5x/ui/components/tabs"
import { toast } from "@v5x/ui/components/toast"
import { cn } from "@v5x/ui/lib/utils"

import { errorMessage } from "@/lib/errors"
import type { WorkbenchSource } from "@/lib/workbench-source"
import { Fragment, useSyncExternalStore } from "react"

import type { DragSource, DropHighlight } from "./workbench-drop"
import { FileEditor } from "./workbench-file-editor"
import { SortableFileTab, SortableTabsList, tabId } from "./workbench-tabs"

export function WorkbenchEditors({
  source,
  programId,
  diagnosticTarget,
  onFormatChange,
  onCursorLine,
  dropHighlight,
  drag,
}: {
  source: WorkbenchSource
  programId: Id<"programs">
  diagnosticTarget: (DiagnosticTarget & { path: string }) | null
  onFormatChange: FormatChange
  onCursorLine: (path: string, line: number) => void
  dropHighlight: DropHighlight | null
  drag: DragSource | null
}) {
  const { paths, listError, layout, openPaths, loaded, readError, dirtyPaths } =
    useSyncExternalStore(
      source.subscribe,
      source.getSnapshot,
      source.getSnapshot
    )
  const { activateTab, activateGroup, splitGroup, resizeSash, equalizeSplit } =
    source
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
                  programId={programId}
                  viewId={group.id}
                  onFormatChange={onFormatChange}
                  path={path}
                  diagnosticTarget={
                    diagnosticTarget?.path === path
                      ? diagnosticTarget
                      : undefined
                  }
                  active={group.activePath === path}
                  onCursorLine={onCursorLine}
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

  return renderNode(layout.root, [])
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
