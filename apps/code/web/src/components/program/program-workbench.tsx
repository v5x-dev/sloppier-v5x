import { ActionsBar } from "@/components/program/program-actions-bar"
import { ProgramHistory } from "@/components/program/program-history"
import { ProgramSearch } from "@/components/program/program-search"
import { ActionGroup } from "@/components/shared/action-group"
import { ActionTooltip } from "@/components/shared/action-tooltip"
import type { DiagnosticTarget } from "@/lib/build-diagnostics"
import { shortcutKeys } from "@/lib/keyboard-shortcuts"
import { DndContext, DragOverlay } from "@dnd-kit/core"
import {
  CaretLeftIcon,
  GitCommitIcon,
  ListMagnifyingGlassIcon,
  TextAlignLeftIcon,
} from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import type { Doc } from "@v5x/backend/dataModel"
import { Button } from "@v5x/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@v5x/ui/components/empty"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from "@v5x/ui/components/sidebar"
import { Spinner } from "@v5x/ui/components/spinner"
import { cn } from "@v5x/ui/lib/utils"
import { createPortal } from "react-dom"
import { useWorkbenchCommands } from "./use-workbench-commands"
import { useWorkbenchDrag } from "./use-workbench-drag"
import { CommitDialog } from "./workbench-commit-dialog"
import { WorkbenchEditors } from "./workbench-editors"
import { TabChip } from "./workbench-tabs"
import { treeStyle } from "./workbench-tree"

import { LanguageSession } from "@/components/editor/language-session"
import { useProgramConnection } from "@/components/program/program-connection"
import { RepositoryExplorer } from "@/components/repository/repository-explorer"
import { useProgramBinaries } from "@/hooks/use-program-binaries"
import { prepareUploadBuild, waitForSourceSync } from "@/lib/build-program"
import type { WorkbenchSource } from "@/lib/workbench-source"
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from "@v5x/ui/components/avatar"
import {
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

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
  const [cursor, setCursor] = useState<{ path: string; line: number } | null>(
    null
  )
  const binaries = useProgramBinaries()
  const { request: buildRequest, status: buildStatus } = useProgramConnection()
  const [uploadProgress, setUploadProgress] = useState<{
    label: string
    value: number | null
  } | null>(null)
  const { paths, listError, layout, activePath, dirtyPaths, filePeople } =
    useSyncExternalStore(
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
  } = source
  const [diagnosticTarget, setDiagnosticTarget] = useState<
    (DiagnosticTarget & { path: string }) | null
  >(null)
  const { drag, treeDragPosition, dropHighlight, beginFileDrag, dragEvents } =
    useWorkbenchDrag(source, layout)
  const {
    formatActions,
    onFormatChange,
    formatManually,
    commitFormatted,
    commitOpen,
    setCommitOpen,
    commitLabel,
  } = useWorkbenchCommands({
    source,
    activePath,
    layout,
    dirtyPaths,
    headSha: program.repositoryHeadSha,
  })
  const allSynced = source.isSynced()

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
            <DndContext {...dragEvents}>
              <div ref={editorArea} className="flex min-h-0 min-w-0 flex-1">
                <WorkbenchEditors
                  source={source}
                  programId={program._id}
                  diagnosticTarget={diagnosticTarget}
                  onFormatChange={onFormatChange}
                  dropHighlight={dropHighlight}
                  drag={drag}
                  onCursorLine={(path, line) =>
                    setCursor((current) =>
                      current?.path === path && current.line === line
                        ? current
                        : { path, line }
                    )
                  }
                />
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
                  programName={program.name}
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
