import {
  ArrowLeftIcon,
  CheckIcon,
  CloudSlashIcon,
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
import { PartsPanel, defaultDraft, type LengthDraft } from "@/panels/parts-panel"
import { partById } from "@/catalog/catalog"
import type { CatalogPart } from "@/catalog/types"
import { catalogPartName } from "@/design/catalog-view"
import { lengthFromInput } from "@/design/cut-length"
import { partsMap, readPart, removePart } from "@/design/document"
import type { PartRef, PlacedPart } from "@/design/model"
import { readModelsBase } from "@/design/models-base"
import { useDesignSync, type DesignSyncState } from "@/lib/use-design-sync"
import { webglAvailable } from "@/viewport/webgl"
import { INITIAL_STATUS, type Projection, type ViewportStatus } from "@/viewport/status"

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

function DesignEditor({ designId, userId }: { designId: Id<"designs">; userId: string }) {
  const design = useQuery(api.designs.get, { designId })
  const { doc, state } = useDesignSync(designId, userId)
  const modelsBase = useMemo(() => readModelsBase(import.meta.env.VITE_DESIGN_MODELS_URL), [])

  const [webgl, setWebgl] = useState<"checking" | "yes" | "no">("checking")
  useEffect(() => setWebgl(webglAvailable() ? "yes" : "no"), [])

  const [query, setQuery] = useState("")
  const [pickedId, setPickedId] = useState<string>()
  const [draft, setDraft] = useState<LengthDraft>()
  const [selectedId, setSelectedId] = useState<string>()
  const [projection, setProjection] = useState<Projection>("perspective")
  const [status, setStatus] = useState<ViewportStatus>(INITIAL_STATUS)

  // Memoized so the viewport only resets its ghost when the choice actually changes.
  const tool = useMemo<PartRef | undefined>(() => {
    if (!pickedId) return undefined
    const part = partById(pickedId)
    if (part.kind !== "cut") return { catalogId: pickedId }
    if (!draft) return undefined
    const length = lengthFromInput(part, Number(draft.text))
    return length.ok ? { catalogId: pickedId, lengthMm: length.lengthMm } : undefined
  }, [pickedId, draft])

  const selected = useDocEntry(doc, selectedId)

  if (!doc) {
    return (
      <div className="flex h-svh items-center justify-center gap-3">
        <Spinner className="size-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Opening the Design…</p>
      </div>
    )
  }

  const pick = (id: string | undefined) => {
    setSelectedId(undefined)
    setPickedId(id)
    const part = id ? partById(id) : undefined
    setDraft(part?.kind === "cut" ? defaultDraft(part) : undefined)
  }

  const onDelete = (id: string) => {
    removePart(doc, id)
    setSelectedId(undefined)
  }

  return (
    <div className="flex h-svh flex-col">
      <header className="flex items-center gap-2 border-b border-border px-2 py-2">
        <Button variant="ghost" size="icon" aria-label="Back to Designs" render={<Link to="/" />} nativeButton={false}>
          <ArrowLeftIcon />
        </Button>
        <h1 className="min-w-0 flex-1 truncate font-serif text-lg">{design?.name}</h1>
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

        <section className="relative min-h-0 min-w-0 flex-1">
          {webgl === "no" ? (
            <WebglUnavailable />
          ) : webgl === "yes" ? (
            <Suspense fallback={<LoadingView label="Loading the 3D view…" />}>
              <DesignViewport
                doc={doc}
                modelsBase={modelsBase.ok ? modelsBase.url : undefined}
                tool={tool}
                selectedId={selectedId}
                projection={projection}
                onSelect={setSelectedId}
                onCancelTool={() => pick(undefined)}
                onDelete={onDelete}
                onToggleProjection={() => setProjection((p) => (p === "perspective" ? "orthographic" : "perspective"))}
                onStatus={setStatus}
              />
            </Suspense>
          ) : null}

          <ViewNotices modelsBase={modelsBase} status={status} />

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
        </section>
      </div>

      <Footer
        tool={pickedId ? partById(pickedId) : undefined}
        selected={selected}
        onDelete={() => selected && onDelete(selected.id)}
        status={status}
        placing={Boolean(pickedId)}
      />
    </div>
  )
}

/** One Part from the document, re-read whenever the document changes. */
function useDocEntry(doc: Y.Doc | undefined, id: string | undefined): PlacedPart | undefined {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!doc) return
    const map = partsMap(doc)
    map.observeDeep(rerender)
    return () => map.unobserveDeep(rerender)
  }, [doc])
  if (!doc || !id) return undefined
  return readPart(id, partsMap(doc).get(id))
}

function ViewNotices({ modelsBase, status }: { modelsBase: ReturnType<typeof readModelsBase>; status: ViewportStatus }) {
  const notes: { key: string; tone: "muted" | "error"; text: string; spin?: boolean }[] = []
  if (!modelsBase.ok) notes.push({ key: "base", tone: "error", text: modelsBase.message })
  if (status.modelsLoading > 0)
    notes.push({ key: "loading", tone: "muted", text: `Loading ${status.modelsLoading} model${status.modelsLoading === 1 ? "" : "s"}…`, spin: true })
  if (status.modelsFailed.length > 0) {
    const names = status.modelsFailed.map((id) => catalogPartName(id)).join(", ")
    notes.push({ key: "failed", tone: "error", text: `${status.modelsFailed.length} model${status.modelsFailed.length === 1 ? "" : "s"} did not load and show as boxes: ${names}.` })
  }
  if (status.invalid > 0) notes.push({ key: "invalid", tone: "error", text: `${status.invalid} saved part${status.invalid === 1 ? "" : "s"} could not be read and ${status.invalid === 1 ? "is" : "are"} hidden. A newer version of this app may have saved ${status.invalid === 1 ? "it" : "them"}.` })
  if (status.contextLost) notes.push({ key: "lost", tone: "error", text: "The 3D view stopped drawing. Reload this page to draw it again. Edits already made are kept." })
  if (notes.length === 0) return null
  return (
    <div className="pointer-events-none absolute top-3 left-3 flex max-w-md flex-col gap-2">
      {notes.map((note) => (
        <p
          key={note.key}
          role={note.tone === "error" ? "alert" : "status"}
          className={
            "flex items-center gap-2 rounded-md border border-border bg-background/90 px-3 py-2 text-sm backdrop-blur-sm " +
            (note.tone === "error" ? "text-destructive" : "text-muted-foreground")
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
  selected,
  onDelete,
  status,
  placing,
}: {
  tool: CatalogPart | undefined
  selected: PlacedPart | undefined
  onDelete: () => void
  status: ViewportStatus
  placing: boolean
}) {
  return (
    <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-3 py-2 text-sm">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {placing && tool ? (
          <p className="truncate">
            Placing {tool.name}
            {status.snap && <span className="text-muted-foreground"> · snapped, R turns it about the shared axis</span>}
          </p>
        ) : selected ? (
          <p className="flex items-center gap-3 truncate">
            <span className="truncate">{catalogPartName(selected.catalogId)}</span>
            <Button variant="ghost" size="sm" onClick={onDelete}>
              Delete
            </Button>
          </p>
        ) : (
          <p className="text-muted-foreground">Pick a Part from the list to place it.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
        {placing ? (
          <>
            <Hint keys={["Click"]} label="place" />
            <Hint keys={["R"]} label="turn" />
            <Hint keys={["Esc"]} label="stop placing" />
          </>
        ) : (
          <>
            <Hint keys={["Click"]} label="select" />
            <Hint keys={["Del"]} label="delete" />
            <Hint keys={["Esc"]} label="clear" />
          </>
        )}
        <Hint keys={["F"]} label="frame" />
        <Hint keys={["O"]} label="view" />
        <span className="tabular-nums">{status.parts} {status.parts === 1 ? "part" : "parts"}</span>
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
          WebGL is off or unavailable here. Turn on hardware acceleration in the browser settings, or open this Design in
          another browser.
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
    <p role="status" className="flex shrink-0 items-center gap-1.5 px-2 text-sm text-muted-foreground">
      {state.kind === "saved" && <CheckIcon />}
      {state.kind === "offline" && <CloudSlashIcon />}
      {state.kind === "error" && <WarningCircleIcon />}
      {label}
    </p>
  )
}
