import {
  BuildingsIcon,
  CaretUpDownIcon,
  CubeIcon,
  PlusIcon,
  SignOutIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useAuth } from "@v5x/auth"
import { AuthGate } from "@v5x/auth/gate"
import { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
import { errorMessage } from "@v5x/backend/errors"
import { Avatar, AvatarFallback, AvatarImage } from "@v5x/ui/components/avatar"
import { Button } from "@v5x/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@v5x/ui/components/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@v5x/ui/components/empty"
import { Skeleton } from "@v5x/ui/components/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@v5x/ui/components/toggle-group"
import { useMutation, useQuery } from "convex/react"
import { useRef, useState } from "react"
import { DesignRow } from "@/components/design-row"
import { BuildImportDialog } from "@/components/build-import-dialog"
import { NameDialog } from "@/components/name-dialog"
import {
  BUILD_FILE_EXTENSION,
  designFromPlan,
  parseBuildFile,
  planBuildImport,
  summarizeBuildPlan,
  type BuildSummary,
} from "@/design/build-file"
import {
  DESIGN_FILE_EXTENSION,
  designUpdates,
  parseDesignFile,
  type ParsedDesign,
} from "@/design/design-file"

/** Most problems listed in an import message, so a big file cannot fill the page. */
const MAX_IMPORT_PROBLEMS = 20

/** A Protobot file waiting for the user to decide what to import. */
type BuildReview = {
  fileName: string
  summary: BuildSummary
  unverified: boolean
  design: ParsedDesign
}

export const Route = createFileRoute("/")({
  component: () => (
    <AuthGate>
      <DesignHome />
    </AuthGate>
  ),
})

const WORKSPACE_KEY = "v5x:design-workspace"

function rememberedWorkspace() {
  try {
    return localStorage.getItem(WORKSPACE_KEY)
  } catch {
    return null
  }
}

function DesignHome() {
  const memberships = useQuery(api.workspaces.listMine)
  const workspaces = memberships?.flatMap((entry) =>
    entry.workspace ? [entry.workspace] : []
  )
  const [selectedId, setSelectedId] = useState(rememberedWorkspace)
  const workspace =
    workspaces?.find((entry) => entry._id === selectedId) ?? workspaces?.[0]

  function select(id: string) {
    setSelectedId(id)
    try {
      localStorage.setItem(WORKSPACE_KEY, id)
    } catch {
      // The choice still applies for this visit.
    }
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-3xl flex-col px-4 pb-16">
      <header className="flex items-center justify-between gap-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="font-serif text-lg">design</span>
          {workspaces && workspace && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    className="max-w-56"
                    aria-label="Switch workspace"
                  />
                }
              >
                <BuildingsIcon data-icon="inline-start" />
                <span className="truncate">{workspace.name}</span>
                <CaretUpDownIcon
                  data-icon="inline-end"
                  className="text-muted-foreground"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuRadioGroup
                  value={workspace._id}
                  onValueChange={select}
                >
                  {workspaces.map((entry) => (
                    <DropdownMenuRadioItem key={entry._id} value={entry._id}>
                      <span className="truncate">{entry.name}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <AccountMenu />
      </header>
      {workspace ? (
        <Designs key={workspace._id} workspaceId={workspace._id} />
      ) : (
        <ListSkeleton />
      )}
    </div>
  )
}

function AccountMenu() {
  const { user, signOut } = useAuth()
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ")
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Account menu" />
        }
      >
        <Avatar className="size-7">
          {user?.profilePictureUrl && (
            <AvatarImage src={user.profilePictureUrl} alt="" />
          )}
          <AvatarFallback>{(name || "?").slice(0, 1)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => signOut()}>
          <SignOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2 pt-8">
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  )
}

function Designs({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const navigate = useNavigate()
  const designs = useQuery(api.designs.listByWorkspace, { workspaceId })
  const create = useMutation(api.designs.create)
  const removeDesign = useMutation(api.designs.remove)
  const appendUpdate = useMutation(api.designSync.appendUpdate)
  const generateName = useMutation(api.designs.generateName)
  const [suggestedName, setSuggestedName] = useState<string>()
  const [view, setView] = useState<"active" | "archived">("active")
  const fileInput = useRef<HTMLInputElement>(null)
  const [importProblems, setImportProblems] = useState<string[]>()
  const [buildReview, setBuildReview] = useState<BuildReview>()

  // The file is checked before anything is created. Its contents are stored on the server
  // before the editor opens, so no Design is ever left empty by an import. If storing fails,
  // the new Design is removed again.
  async function importFile(file: File) {
    setImportProblems(undefined)
    let text: string
    try {
      text = await file.text()
    } catch {
      setImportProblems(["The file could not be read."])
      return
    }
    if (file.name.toLowerCase().endsWith(BUILD_FILE_EXTENSION.toLowerCase())) {
      reviewBuild(file.name, text)
      return
    }
    const parsed = parseDesignFile(text)
    if (!parsed.ok) {
      setImportProblems(parsed.problems)
      return
    }
    await createImported(parsed.design)
  }

  // A Protobot file is shown for review first, because part of it may not import. Nothing is
  // created until the user confirms.
  function reviewBuild(fileName: string, text: string) {
    const parsed = parseBuildFile(text)
    if (!parsed.ok) {
      setImportProblems(parsed.problems)
      return
    }
    const plan = planBuildImport(parsed)
    const summary = summarizeBuildPlan(plan)
    if (plan.parts.length === 0) {
      setImportProblems(
        [
          `None of the ${summary.total} parts in this file can be imported yet.`,
          ...summary.skipped.map(
            (group) =>
              `${group.count} × part "${group.partId}": ${group.reason}`
          ),
          ...summary.rejected.map(
            (entry) => `Part ${entry.number}: ${entry.reason}`
          ),
        ].slice(0, MAX_IMPORT_PROBLEMS)
      )
      return
    }
    const built = designFromPlan(plan)
    if (!built.ok) {
      setImportProblems(built.problems)
      return
    }
    setBuildReview({
      fileName,
      summary,
      unverified: !plan.verified,
      design: built.design,
    })
  }

  // Creates a Design from a checked file and opens it. Its contents are stored before the
  // editor opens, and a Design that fails to store is removed again.
  async function createImported(design: ParsedDesign) {
    let designId: Id<"designs"> | undefined
    try {
      designId = await create({ workspaceId, name: design.name })
      for (const update of designUpdates(design)) {
        await appendUpdate({
          designId,
          updateId: crypto.randomUUID(),
          bytes: update.slice().buffer,
        })
      }
      await navigate({ to: "/designs/$designId", params: { designId } })
    } catch (caught) {
      if (designId !== undefined)
        await removeDesign({ designId }).catch(() => undefined)
      setImportProblems([errorMessage(caught)])
    }
  }

  const shown = designs
    ?.filter((design) => Boolean(design.archivedAt) === (view === "archived"))
    .sort(
      (a, b) =>
        (b.lastActivityAt ?? b.createdAt) - (a.lastActivityAt ?? a.createdAt)
    )
  const hasArchived = designs?.some((design) => design.archivedAt)

  const newDesign = (
    <Button
      onClick={() => {
        // If no name comes back, the backend picks one when the field is empty.
        generateName({})
          .catch(() => "")
          .then(setSuggestedName)
      }}
    >
      <PlusIcon data-icon="inline-start" />
      New Design
    </Button>
  )

  return (
    <main className="flex flex-1 flex-col gap-6 pt-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-serif text-3xl">Designs</h1>
        <div className="flex items-center gap-2">
          {(hasArchived || view === "archived") && (
            <ToggleGroup
              value={[view]}
              onValueChange={(value) => {
                if (value[0]) setView(value[0] as typeof view)
              }}
            >
              <ToggleGroupItem value="active">Active</ToggleGroupItem>
              <ToggleGroupItem value="archived">Archived</ToggleGroupItem>
            </ToggleGroup>
          )}
          <Button variant="outline" onClick={() => fileInput.current?.click()}>
            <UploadSimpleIcon data-icon="inline-start" />
            Import
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept={`${DESIGN_FILE_EXTENSION},${BUILD_FILE_EXTENSION},.json,application/json`}
            className="hidden"
            aria-label="Choose a Design file to import"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ""
              if (file) void importFile(file)
            }}
          />
          {newDesign}
        </div>
      </div>

      {importProblems && (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-md border border-border px-3 py-2 text-sm text-destructive"
        >
          <p>This file could not be imported. Nothing was created.</p>
          <ul className="list-disc pl-5">
            {importProblems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {!shown ? (
        <ListSkeleton />
      ) : shown.length ? (
        <ul>
          {shown.map((design) => (
            <DesignRow key={design._id} design={design} />
          ))}
        </ul>
      ) : view === "archived" ? (
        <p className="text-muted-foreground">No archived Designs.</p>
      ) : (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CubeIcon />
            </EmptyMedia>
            <EmptyTitle>No Designs yet</EmptyTitle>
            <EmptyDescription>
              Create one to start building your robot with your team.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{newDesign}</EmptyContent>
        </Empty>
      )}

      {buildReview && (
        <BuildImportDialog
          fileName={buildReview.fileName}
          summary={buildReview.summary}
          unverified={buildReview.unverified}
          onClose={() => setBuildReview(undefined)}
          onImport={() => {
            const { design } = buildReview
            setBuildReview(undefined)
            void createImported(design)
          }}
        />
      )}

      {suggestedName !== undefined && (
        <NameDialog
          title="New Design"
          action="Create"
          initialName={suggestedName}
          allowEmpty
          onSubmit={async (name) => {
            const designId = await create({ workspaceId, name })
            await navigate({
              to: "/designs/$designId",
              params: { designId },
            })
          }}
          onClose={() => setSuggestedName(undefined)}
        />
      )}
    </main>
  )
}
