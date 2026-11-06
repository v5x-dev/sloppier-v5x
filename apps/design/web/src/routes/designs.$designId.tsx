import {
  ArrowLeftIcon,
  CheckIcon,
  CloudSlashIcon,
  DownloadSimpleIcon,
  KeyboardIcon,
  ListBulletsIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useAuth } from "@v5x/auth"
import { AuthGate, SigningIn } from "@v5x/auth/gate"
import { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
import { errorMessage } from "@v5x/backend/errors"
import { Button } from "@v5x/ui/components/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@v5x/ui/components/context-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@v5x/ui/components/empty"
import { Kbd } from "@v5x/ui/components/kbd"
import { Spinner } from "@v5x/ui/components/spinner"
import { useQuery } from "convex/react"
import { lazy, Suspense, useEffect, useMemo, useReducer, useState } from "react"
import type * as Y from "yjs"
import {
  PartsPanel,
  defaultDraft,
  type LengthDraft,
} from "@/panels/parts-panel"
import { partById } from "@/catalog/catalog"
import type { CatalogPart, Vec3 } from "@/catalog/types"
import { catalogPartName } from "@/design/catalog-view"
import { lengthFromInput } from "@/design/cut-length"
import { readConnections, readPlacedParts } from "@/design/document"
import type { PartRef, PlacedPart } from "@/design/model"
import { readModelsBase } from "@/design/models-base"
import { createHistory, type History } from "@/design/history"
import {
  connectSelection,
  deleteSelection,
  disconnectSelection,
  duplicateSelection,
  moveBy,
  recolorSelection,
  turnBy,
} from "@/design/actions"
import { fastenerOf } from "@/design/connect"
import { keyStore } from "@/design/key-store"
import {
  DESIGN_FILE_EXTENSION,
  designFileOf,
  designFileText,
} from "@/design/design-file"
import { downloadText, safeFileName } from "@/lib/download"
import { actionForEvent, primaryLabel, type Bindings } from "@/design/keys"
import { useKeyBindings } from "@/lib/use-key-bindings"
import { pivotsFor } from "@/design/connections"
import { useDesignSync, type DesignSyncState } from "@/lib/use-design-sync"
import { webglAvailable } from "@/viewport/webgl"
import type { GizmoMode } from "@/viewport/gizmo"
import {
  INITIAL_STATUS,
  type Projection,
  type ViewportStatus,
} from "@/viewport/status"
import { EditorToolbar } from "@/components/editor-chrome"
import { PartsListDialog } from "@/components/parts-list-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@v5x/ui/components/dropdown-menu"
import { KeyboardSettingsDialog } from "@/components/keyboard-settings"
import {
  PALETTE,
  SelectionPanel,
  type SelectionFacts,
} from "@/components/selection-panel"

// The 3D code is loaded only when a Design opens, so the rest of the app stays small.
const DesignViewport = lazy(() => import("@/viewport/DesignViewport"))

export const Route = createFileRoute("/designs/$designId")({
  component: () => (
    <AuthGate>
      <DesignPage />
    </AuthGate>
  ),
  errorComponent: ({ error }) => (
    <Empty className="min-h-svh">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WarningCircleIcon />
        </EmptyMedia>
        <EmptyTitle>This Design could not be opened</EmptyTitle>
        <EmptyDescription>{errorMessage(error)}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/" />} nativeButton={false}>
          Back to Designs
        </Button>
      </EmptyContent>
    </Empty>
  ),
})

function DesignPage() {
  const { designId } = Route.useParams()
  const { user } = useAuth()
  if (!user) return <SigningIn />
  return <DesignEditor designId={designId as Id<"designs">} userId={user.id} />
}

function DesignEditor({
  designId,
  userId,
}: {
  designId: Id<"designs">
  userId: string
}) {
  const { doc, state } = useDesignSync(designId, userId)
  if (!doc) {
    return (
      <div className="flex h-svh items-center justify-center gap-3">
        <Spinner className="size-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Opening the Design…</p>
      </div>
    )
  }
  return <DesignWorkspace designId={designId} doc={doc} state={state} />
}

/** The editor once the Design's document has loaded. Every hook runs on every render. */
function DesignWorkspace({
  designId,
  doc,
  state,
}: {
  designId: Id<"designs">
  doc: Y.Doc
  state: DesignSyncState
}) {
  const design = useQuery(api.designs.get, { designId })
  const modelsBase = useMemo(
    () => readModelsBase(import.meta.env.VITE_DESIGN_MODELS_URL),
    []
  )

  const [webgl, setWebgl] = useState<"checking" | "yes" | "no">("checking")
  useEffect(() => setWebgl(webglAvailable() ? "yes" : "no"), [])

  const [query, setQuery] = useState("")
  const [pickedId, setPickedId] = useState<string>()
  const [draft, setDraft] = useState<LengthDraft>()
  const [selection, setSelection] = useState<Set<string>>(() => new Set())
  const [mode, setMode] = useState<GizmoMode>("move")
  const [local, setLocal] = useState(false)
  const [pivot, setPivot] = useState<string>()
  const [angleStepDeg, setAngleStepDeg] = useState(15)
  const [notice, setNotice] = useState<string>()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [partsOpen, setPartsOpen] = useState(false)

  const [projection, setProjection] = useState<Projection>("perspective")
  const [status, setStatus] = useState<ViewportStatus>(INITIAL_STATUS)
  const [history, setHistory] = useState<History>()
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const { parts, connections } = useDocSnapshot(doc)

  // Memoized so the viewport only resets its ghost when the choice actually changes.
  const tool = useMemo<PartRef | undefined>(() => {
    if (!pickedId) return undefined
    const part = partById(pickedId)
    if (part.kind !== "cut") return { catalogId: pickedId }
    if (!draft) return undefined
    const length = lengthFromInput(part, Number(draft.text))
    return length.ok
      ? { catalogId: pickedId, lengthMm: length.lengthMm }
      : undefined
  }, [pickedId, draft])

  useEffect(() => {
    const next = createHistory(doc)
    setHistory(next)
    const off = next.subscribe(rerender)
    return () => {
      off()
      next.destroy()
    }
  }, [doc])

  // A turn centre that someone else deleted is no longer offered.
  useEffect(() => {
    if (pivot && !parts.some((p) => p.id === pivot)) setPivot(undefined)
  }, [parts, pivot])

  const selected = useMemo(
    () => parts.filter((p) => selection.has(p.id)),
    [parts, selection]
  )
  const facts = useMemo(
    () => selectionFacts(selected, selection, connections),
    [selected, selection, connections]
  )
  const pivots = useMemo(
    () => pivotChoices(parts, connections, selection),
    [parts, connections, selection]
  )

  const pick = (id: string | undefined) => {
    setSelection(new Set())
    setPickedId(id)
    const part = id ? partById(id) : undefined
    setDraft(part?.kind === "cut" ? defaultDraft(part) : undefined)
  }

  const undo = () => history?.undo()
  const redo = () => history?.redo()
  const duplicate = () => {
    if (selection.size === 0) return
    setSelection(new Set(duplicateSelection(doc, selection)))
  }
  const remove = () => {
    if (selection.size === 0) return
    deleteSelection(doc, selection)
    setSelection(new Set())
  }
  const recolor = (color: string) => {
    if (selection.size === 0) return
    recolorSelection(doc, selection, color)
  }
  const connect = () => {
    const made = connectSelection(doc, selection)
    setNotice(
      made === 0
        ? "Nothing to connect. A screw or shaft joins the Parts it passes through once their holes line up."
        : undefined
    )
  }
  const disconnect = () => {
    disconnectSelection(doc, selection)
    setNotice(undefined)
  }
  const turn = (degrees: number, axis: number) => {
    const unit: [number, number, number] = [0, 0, 0]
    unit[axis] = 1
    turnBy(doc, selection, {
      angle: (degrees * Math.PI) / 180,
      axis: unit,
      pivotFastener: pivot,
    })
    setNotice(undefined)
  }
  const moveTo = (target: Vec3) => {
    if (selected.length !== 1) return
    const [single] = selected
    const [x, y, z] = single.position
    moveBy(doc, selection, [target[0] - x, target[1] - y, target[2] - z])
  }

  // Keys for the editor. Typing in a field never triggers them.
  const keys = {
    doc,
    history,
    selection,
    tool,
    parts,
    undo,
    redo,
    duplicate,
    remove,
    recolor,
  }
  const bindings = useKeyBindings()
  useKeys(keys, setSelection, setMode, setLocal, setShortcutsOpen, pick)

  return (
    <div className="flex h-svh flex-col">
      <header className="flex items-center gap-2 border-b border-border px-2 py-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to Designs"
          render={<Link to="/" />}
          nativeButton={false}
        >
          <ArrowLeftIcon />
        </Button>
        <h1 className="min-w-0 flex-1 truncate font-serif text-lg">
          {design?.name}
        </h1>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="sm" aria-label="Design menu" />
            }
          >
            Design
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => setPartsOpen(true)}>
              <ListBulletsIcon />
              Parts list
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const file = designFileOf(doc, design?.name ?? "Design")
                try {
                  downloadText(
                    `${safeFileName(file.name)}${DESIGN_FILE_EXTENSION}`,
                    designFileText(file),
                    "application/json"
                  )
                } catch {
                  setNotice("This browser could not start the download.")
                }
              }}
            >
              <DownloadSimpleIcon />
              Export Design file
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShortcutsOpen(true)}>
              <KeyboardIcon />
              Keyboard shortcuts
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <SaveStatus state={state} />
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="flex h-64 shrink-0 flex-col border-b border-border bg-sidebar md:h-auto md:w-72 md:border-r md:border-b-0">
          <PartsPanel
            query={query}
            onQuery={setQuery}
            pickedId={pickedId}
            onPick={pick}
            draft={draft}
            onDraft={setDraft}
          />
        </aside>

        <ContextMenu>
          <ContextMenuTrigger className="relative min-h-0 min-w-0 flex-1">
            {webgl === "no" ? (
              <WebglUnavailable />
            ) : webgl === "yes" ? (
              <Suspense fallback={<LoadingView label="Loading the 3D view…" />}>
                <DesignViewport
                  doc={doc}
                  modelsBase={modelsBase.ok ? modelsBase.url : undefined}
                  tool={tool}
                  selection={selection}
                  onSelection={setSelection}
                  mode={mode}
                  local={local}
                  pivot={pivot}
                  angleStep={(angleStepDeg * Math.PI) / 180}
                  projection={projection}
                  onCancelTool={() => pick(undefined)}
                  onToggleProjection={() =>
                    setProjection((p) =>
                      p === "perspective" ? "orthographic" : "perspective"
                    )
                  }
                  onStatus={setStatus}
                  onNotice={setNotice}
                />
              </Suspense>
            ) : null}

            <ViewNotices
              modelsBase={modelsBase}
              status={status}
              notice={notice}
            />

            <div className="absolute top-3 left-1/2 -translate-x-1/2">
              <EditorToolbar
                mode={mode}
                onMode={setMode}
                local={local}
                onLocal={() => setLocal((v) => !v)}
                canUndo={history?.canUndo() ?? false}
                canRedo={history?.canRedo() ?? false}
                onUndo={undo}
                onRedo={redo}
                onShortcuts={() => setShortcutsOpen(true)}
                bindings={bindings}
              />
            </div>

            <div className="absolute top-3 right-3 flex gap-1 rounded-lg border border-border bg-background/85 p-1 backdrop-blur-sm">
              <Button
                size="sm"
                variant={projection === "perspective" ? "secondary" : "ghost"}
                aria-pressed={projection === "perspective"}
                onClick={() => setProjection("perspective")}
              >
                Perspective
              </Button>
              <Button
                size="sm"
                variant={projection === "orthographic" ? "secondary" : "ghost"}
                aria-pressed={projection === "orthographic"}
                onClick={() => setProjection("orthographic")}
              >
                Orthographic
              </Button>
            </div>

            {selection.size > 0 && !tool && (
              <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center">
                <div className="pointer-events-auto w-full max-w-3xl">
                  <SelectionPanel
                    facts={facts}
                    pivots={pivots}
                    pivot={pivot}
                    onPivot={setPivot}
                    angleStepDeg={angleStepDeg}
                    onAngleStep={setAngleStepDeg}
                    onMoveBy={(delta) => moveBy(doc, selection, delta)}
                    onMoveTo={moveTo}
                    onTurn={turn}
                    onDuplicate={duplicate}
                    onDelete={remove}
                    onRecolor={recolor}
                    onConnect={connect}
                    onDisconnect={disconnect}
                  />
                </div>
              </div>
            )}
          </ContextMenuTrigger>
          <ContextMenuContent>
            {selection.size > 0 ? (
              <>
                <ContextMenuItem onClick={duplicate}>
                  Duplicate{" "}
                  <span className="ml-auto pl-6 text-muted-foreground">
                    <Kbd>{primaryLabel(bindings, "duplicate")}</Kbd>
                  </span>
                </ContextMenuItem>
                <ContextMenuItem onClick={remove}>
                  Delete{" "}
                  <span className="ml-auto pl-6 text-muted-foreground">
                    <Kbd>{primaryLabel(bindings, "delete")}</Kbd>
                  </span>
                </ContextMenuItem>
                <ContextMenuSeparator />
                {facts.fastener && (
                  <ContextMenuItem onClick={connect}>Connect</ContextMenuItem>
                )}
                {facts.connections > 0 && (
                  <ContextMenuItem onClick={disconnect}>
                    Disconnect
                  </ContextMenuItem>
                )}
                <ContextMenuItem onClick={() => turn(90, 1)}>
                  Turn 90° about Y
                </ContextMenuItem>
                <ContextMenuSub>
                  <ContextMenuSubTrigger>Colour</ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    {PALETTE.map((swatch) => (
                      <ContextMenuItem
                        key={swatch.color}
                        onClick={() => recolor(swatch.color)}
                      >
                        <span
                          className="mr-2 inline-block size-3 rounded-full border border-border"
                          style={{ backgroundColor: swatch.color }}
                        />
                        {swatch.name}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              </>
            ) : (
              <ContextMenuItem
                onClick={() => setSelection(new Set(parts.map((p) => p.id)))}
              >
                Select all{" "}
                <span className="ml-auto pl-6 text-muted-foreground">
                  <Kbd>{primaryLabel(bindings, "selectAll")}</Kbd>
                </span>
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>
      </div>

      <Footer
        tool={pickedId ? partById(pickedId) : undefined}
        selectionCount={selection.size}
        onDelete={remove}
        status={status}
        placing={Boolean(pickedId)}
        bindings={bindings}
      />

      <KeyboardSettingsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
      <PartsListDialog
        open={partsOpen}
        onOpenChange={setPartsOpen}
        parts={parts}
        designName={design?.name ?? "design"}
      />
    </div>
  )
}

/** The Parts and Connections of the document, re-read whenever either changes. */
function useDocSnapshot(doc: Y.Doc | undefined): {
  parts: PlacedPart[]
  connections: { fastener: string; host: string }[]
} {
  const [version, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!doc) return
    const parts = doc.getMap("parts")
    const links = doc.getMap("connections")
    parts.observeDeep(bump)
    links.observeDeep(bump)
    return () => {
      parts.unobserveDeep(bump)
      links.unobserveDeep(bump)
    }
  }, [doc])
  return useMemo(() => {
    if (!doc) return { parts: [], connections: [] }
    return {
      parts: readPlacedParts(doc).parts,
      connections: readConnections(doc),
    }
    // `version` changes when the document does; reading it here keeps the memo honest.
  }, [doc, version])
}

function selectionFacts(
  selected: PlacedPart[],
  selection: ReadonlySet<string>,
  connections: { fastener: string; host: string }[]
): SelectionFacts {
  const ids = selection
  const touching = connections.filter(
    (c) => ids.has(c.fastener) || ids.has(c.host)
  )
  const single = selected.length === 1 ? selected[0] : undefined
  return {
    count: selection.size,
    connections: touching.length,
    fastener: selected.some((p) => fastenerOf(p) !== undefined),
    position: single?.position,
    title:
      single !== undefined
        ? catalogPartName(single.catalogId)
        : `${selection.size} Parts`,
  }
}

/** Fasteners that join the selection to Parts outside it, labelled for the turn choice. */
function pivotChoices(
  parts: PlacedPart[],
  connections: { fastener: string; host: string }[],
  selection: ReadonlySet<string>
): { id: string; label: string }[] {
  if (selection.size === 0) return []
  const ids = pivotsFor(selection, connections)
  return ids.map((id) => {
    const part = parts.find((p) => p.id === id)
    const name = part ? catalogPartName(part.catalogId) : id
    return { id, label: `${name} (${id.slice(0, 4)})` }
  })
}

/**
 * Keyboard shortcuts for the editor. Each key is looked up in the registry, so a rebound key
 * works here without a change. The viewport handles the keys for placing and framing.
 */
function useKeys(
  keys: {
    doc: Y.Doc
    history: History | undefined
    selection: ReadonlySet<string>
    tool: PartRef | undefined
    parts: PlacedPart[]
    undo: () => void
    redo: () => void
    duplicate: () => void
    remove: () => void
    recolor: (color: string) => void
  },
  setSelection: (next: Set<string>) => void,
  setMode: (mode: GizmoMode) => void,
  setLocal: (update: (v: boolean) => boolean) => void,
  setShortcutsOpen: (open: boolean) => void,
  pick: (id: string | undefined) => void
) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return
      const action = actionForEvent(event, keyStore.get())
      if (action === undefined) return
      const editing = keys.selection.size > 0 && !keys.tool
      switch (action) {
        case "undo":
          event.preventDefault()
          keys.undo()
          break
        case "redo":
          event.preventDefault()
          keys.redo()
          break
        case "duplicate":
          event.preventDefault()
          keys.duplicate()
          break
        case "selectAll":
          event.preventDefault()
          setSelection(new Set(keys.parts.map((p) => p.id)))
          break
        case "delete":
          if (editing) {
            event.preventDefault()
            keys.remove()
          }
          break
        case "cancel":
          if (keys.tool) pick(undefined)
          else setSelection(new Set())
          break
        case "moveMode":
          setMode("move")
          break
        case "turnMode":
          setMode("rotate")
          break
        case "localAxes":
          setLocal((v) => !v)
          break
        case "shortcuts":
          setShortcutsOpen(true)
          break
        default: {
          const swatch = /^recolor([1-8])$/.exec(action)
          if (swatch && editing)
            keys.recolor(PALETTE[Number(swatch[1]) - 1].color)
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // The handlers read the latest values through `keys`, which is rebuilt each render.
  }, [keys, setSelection, setMode, setLocal, setShortcutsOpen, pick])
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  )
}

function ViewNotices({
  modelsBase,
  status,
  notice,
}: {
  modelsBase: ReturnType<typeof readModelsBase>
  status: ViewportStatus
  notice?: string
}) {
  const notes: {
    key: string
    tone: "muted" | "error"
    text: string
    spin?: boolean
  }[] = []
  if (!modelsBase.ok)
    notes.push({ key: "base", tone: "error", text: modelsBase.message })
  if (status.modelsLoading > 0)
    notes.push({
      key: "loading",
      tone: "muted",
      text: `Loading ${status.modelsLoading} model${status.modelsLoading === 1 ? "" : "s"}…`,
      spin: true,
    })
  if (status.modelsFailed.length > 0) {
    const names = status.modelsFailed
      .map((id) => catalogPartName(id))
      .join(", ")
    notes.push({
      key: "failed",
      tone: "error",
      text:
        status.modelsFailed.length === 1
          ? `1 model did not load and shows as a box: ${names}.`
          : `${status.modelsFailed.length} models did not load and show as boxes: ${names}.`,
    })
  }
  if (status.invalid > 0)
    notes.push({
      key: "invalid",
      tone: "error",
      text: `${status.invalid} saved part${status.invalid === 1 ? "" : "s"} could not be read and ${status.invalid === 1 ? "is" : "are"} hidden. A newer version of this app may have saved ${status.invalid === 1 ? "it" : "them"}.`,
    })
  if (notice) notes.push({ key: "notice", tone: "error", text: notice })
  if (status.contextLost)
    notes.push({
      key: "lost",
      tone: "error",
      text: "The 3D view stopped drawing. Reload this page to draw it again. Edits already made are kept.",
    })
  if (notes.length === 0) return null
  return (
    <div className="pointer-events-none absolute top-16 left-3 flex max-w-md flex-col gap-2">
      {notes.map((note) => (
        <p
          key={note.key}
          role={note.tone === "error" ? "alert" : "status"}
          className={
            "flex items-center gap-2 rounded-md border border-border bg-background/90 px-3 py-2 text-sm backdrop-blur-sm " +
            (note.tone === "error"
              ? "text-destructive"
              : "text-muted-foreground")
          }
        >
          {note.spin && <Spinner className="size-3.5" />}
          {note.text}
        </p>
      ))}
    </div>
  )
}

function Footer({
  tool,
  selectionCount,
  onDelete,
  status,
  placing,
  bindings,
}: {
  tool: CatalogPart | undefined
  selectionCount: number
  onDelete: () => void
  status: ViewportStatus
  placing: boolean
  bindings: Bindings
}) {
  return (
    <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-3 py-2 text-sm">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {placing && tool ? (
          <p className="truncate">
            Placing {tool.name}
            {status.snap && (
              <span className="text-muted-foreground">
                . Snapped: {primaryLabel(bindings, "turnPlacing")} turns it
                about the shared axis.
              </span>
            )}
          </p>
        ) : selectionCount > 0 ? (
          <p className="flex items-center gap-3 truncate text-muted-foreground">
            {selectionCount} selected
            <Button variant="ghost" size="sm" onClick={onDelete}>
              Delete
            </Button>
          </p>
        ) : (
          <p className="text-muted-foreground">
            Pick a Part from the list to place it.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
        {placing ? (
          <>
            <Hint keys={["Click"]} label="place" />
            <Hint keys={[primaryLabel(bindings, "turnPlacing")]} label="turn" />
            <Hint
              keys={[primaryLabel(bindings, "cancel")]}
              label="stop placing"
            />
          </>
        ) : (
          <>
            <Hint keys={["Click"]} label="select" />
            <Hint
              keys={[primaryLabel(bindings, "shortcuts")]}
              label="all shortcuts"
            />
          </>
        )}
        <Hint keys={[primaryLabel(bindings, "frame")]} label="frame" />
        <Hint keys={[primaryLabel(bindings, "projection")]} label="view" />
        <span className="tabular-nums">
          {status.parts} {status.parts === 1 ? "part" : "parts"}
        </span>
      </div>
    </footer>
  )
}

function Hint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
      {label}
    </span>
  )
}

function LoadingView({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-3">
      <Spinner className="size-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}

function WebglUnavailable() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WarningCircleIcon />
        </EmptyMedia>
        <EmptyTitle>This browser cannot draw the 3D view</EmptyTitle>
        <EmptyDescription>
          WebGL is off or unavailable here. Turn on hardware acceleration in the
          browser settings, or open this Design in another browser.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function SaveStatus({ state }: { state: DesignSyncState }) {
  const label = {
    loading: "Loading…",
    saving: "Saving…",
    saved: "Saved",
    offline: "Offline. Changes are kept on this device.",
    error: state.kind === "error" ? `Not saved: ${state.message}` : "",
  }[state.kind]
  return (
    <p
      role="status"
      className="flex shrink-0 items-center gap-1.5 px-2 text-sm text-muted-foreground"
    >
      {state.kind === "saved" && <CheckIcon />}
      {state.kind === "offline" && <CloudSlashIcon />}
      {state.kind === "error" && <WarningCircleIcon />}
      {label}
    </p>
  )
}
