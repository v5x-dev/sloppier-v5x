import { DuplicateProgramDialog } from "@/components/program/duplicate-program-dialog"
import {
  ArchiveBoxIcon,
  CaretUpDownIcon,
  MagnifyingGlassIcon,
  DotsThreeIcon,
  BuildingsIcon,
  EnvelopeSimpleIcon,
  PlusIcon,
  SignOutIcon,
  UsersIcon,
} from "@phosphor-icons/react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useAuth } from "@/lib/auth"
import { api } from "@v5x/backend/api"
import type { Doc, Id } from "@v5x/backend/dataModel"
import { Avatar, AvatarFallback, AvatarImage } from "@v5x/ui/components/avatar"
import { Button } from "@v5x/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@v5x/ui/components/dropdown-menu"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@v5x/ui/components/dialog"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@v5x/ui/components/item"
import { Skeleton } from "@v5x/ui/components/skeleton"
import { Spinner } from "@v5x/ui/components/spinner"
import { toast } from "@v5x/ui/components/toast"
import { ToggleGroup, ToggleGroupItem } from "@v5x/ui/components/toggle-group"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@v5x/ui/components/input-group"
import { Input } from "@v5x/ui/components/input"
import { useAction, useConvex, useMutation, useQuery } from "convex/react"
import { format, isSameWeek, isSameYear, isToday, isYesterday } from "date-fns"
import { ActionTooltip } from "@/components/shared/action-tooltip"
import { useEffect, useRef, useState } from "react"
import {
  NewWorkspace,
  WorkspaceTeam,
  WorkspaceInvitations,
} from "@/components/workspace/workspace-team"
import { ImportFolder } from "@/components/repository/import-folder"
import {
  StarterTile,
  starterTileClassName,
  starterTileStyle,
} from "@/components/program/starter-tile"
import { AuthGate } from "@/components/app/auth-gate"
import { RepositoryStatusBadge } from "@/components/repository/repository-status-badge"
import { errorMessage } from "@/lib/errors"
import { prefetchProgramEditor } from "@/lib/program-editor-prefetch"

export const Route = createFileRoute("/")({
  validateSearch: (search): { workspace?: string } =>
    typeof search.workspace === "string" ? { workspace: search.workspace } : {},
  component: () => (
    <AuthGate>
      <ProgramsPage />
    </AuthGate>
  ),
})

type Template = Doc<"programs">["template"]

const templateOrder: Template[] = [
  "vexcode",
  "jar",
  "pros",
  "ez-template",
  "rw",
]

const templateIcons: Record<Template, string> = {
  vexcode: "/template-icons/vexcode.png",
  jar: "/template-icons/jar.svg",
  pros: "/template-icons/pros.png",
  rw: "/template-icons/rw.svg",
  "ez-template": "/template-icons/ez.png",
}

const templateLabels: Record<Template, string> = {
  vexcode: "VEXCode",
  jar: "JAR",
  pros: "PROS",
  rw: "RW",
  "ez-template": "EZ",
}

function ProgramsPage() {
  const workspaces = useQuery(api.workspaces.listMine)
  const search = Route.useSearch()
  const [selectedId, setSelectedId] = useState<string | null>(
    search.workspace ?? null
  )
  const [archived, setArchived] = useState(false)
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)

  const available = (workspaces ?? []).flatMap(({ workspace }) =>
    workspace ? [workspace] : []
  )
  const workspace =
    available.find(({ _id }) => _id === selectedId) ?? available.at(0)
  const isAdmin =
    workspaces?.find((entry) => entry.workspace?._id === workspace?._id)
      ?.role === "admin"

  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader
        workspaces={available}
        workspace={workspace}
        isAdmin={isAdmin}
        onSelect={setSelectedId}
      />
      <main className="mx-auto flex w-[52rem] max-w-full flex-1 flex-col gap-4 px-4 pt-6 pb-16 sm:px-6">
        <section
          aria-label="Create program"
          className="grid grid-cols-2 gap-3 sm:grid-cols-5 [&>:last-child]:col-span-2 sm:[&>:last-child]:col-span-1"
        >
          {templateOrder.map((template) =>
            workspace ? (
              <NewProgramDialog
                key={`${workspace._id}-${template}`}
                workspaceId={workspace._id}
                initialTemplate={template}
              />
            ) : (
              <Skeleton key={template} className="h-[6.75rem] rounded-xl" />
            )
          )}
        </section>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-lg font-semibold">Programs</h1>
          {searching || query !== "" ? (
            <InputGroup className="order-last w-full border-field-border sm:order-none sm:w-56">
              <InputGroupAddon>
                <MagnifyingGlassIcon aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                aria-label="Search programs"
                placeholder="Search"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onBlur={(event) => {
                  // Focus moving to another control keeps the field open, so
                  // the click that moved it still lands on that control.
                  if (query === "" && event.relatedTarget === null)
                    setSearching(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setQuery("")
                    setSearching(false)
                  }
                }}
                className="h-8 [&::-webkit-search-cancel-button]:appearance-none"
              />
            </InputGroup>
          ) : (
            <ActionTooltip label="Search programs">
              <Button
                variant="outline"
                size="icon"
                aria-label="Search programs"
                onClick={() => setSearching(true)}
              >
                <MagnifyingGlassIcon />
              </Button>
            </ActionTooltip>
          )}
          <ActionTooltip
            label={archived ? "Show active programs" : "Show archived programs"}
          >
            <Button
              variant={archived ? "default" : "outline"}
              size="icon"
              data-cuelume-toggle
              aria-label="Show archived programs"
              aria-pressed={archived}
              onClick={() => setArchived((value) => !value)}
            >
              <ArchiveBoxIcon />
            </Button>
          </ActionTooltip>
          {workspace ? (
            <ImportFolder key={workspace._id} workspaceId={workspace._id} />
          ) : (
            <Skeleton className="size-8" />
          )}
        </div>
        {!workspace ? (
          <ProgramListSkeleton />
        ) : (
          <ProgramList
            workspaceId={workspace._id}
            archived={archived}
            query={query}
          />
        )}
      </main>
    </div>
  )
}

function AppHeader({
  workspaces,
  workspace,
  isAdmin,
  onSelect,
}: {
  workspaces: Doc<"workspaces">[]
  workspace: Doc<"workspaces"> | undefined
  isAdmin: boolean
  onSelect: (id: Id<"workspaces">) => void
}) {
  const { user, signOut } = useAuth()
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [managingTeam, setManagingTeam] = useState(false)
  const [viewingInvitations, setViewingInvitations] = useState(false)
  const syncProfile = useAction(api.workspaces.syncProfile)
  useEffect(() => {
    // Profile refresh is optional for browsing. The invitation dialog shows
    // verification errors and offers a retry before accepting any invitation.
    void syncProfile({}).catch(() => undefined)
  }, [syncProfile])
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ")
  const initials =
    [user?.firstName, user?.lastName]
      .map((part) => part?.charAt(0) ?? "")
      .join("")
      .toUpperCase() ||
    user?.email.charAt(0).toUpperCase() ||
    "?"

  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-[52rem] max-w-full items-center gap-2 px-4 sm:px-6">
        <Link
          to="/"
          aria-label="code (by v5x) home"
          className="flex items-center gap-2 rounded-md text-primary outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span
            aria-hidden="true"
            className="block h-5 w-6 bg-current"
            style={{ mask: "url(/favicon.svg) center / contain no-repeat" }}
          />
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                className="max-w-56 text-foreground"
                aria-label="Switch workspace"
              />
            }
          >
            {workspace?.icon ? (
              <img
                src={workspace.icon}
                alt=""
                className="size-4 rounded-sm object-cover"
              />
            ) : (
              <BuildingsIcon data-icon="inline-start" />
            )}
            <span className="truncate">{workspace?.name ?? "Workspace"}</span>
            <CaretUpDownIcon
              data-icon="inline-end"
              className="text-muted-foreground"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuRadioGroup
                value={workspace?._id ?? ""}
                onValueChange={(value) => {
                  const selected = workspaces.find(
                    (entry) => entry._id === value
                  )
                  if (selected) onSelect(selected._id)
                }}
              >
                {workspaces.map((entry) => (
                  <DropdownMenuRadioItem key={entry._id} value={entry._id}>
                    {entry.icon && (
                      <img
                        src={entry.icon}
                        alt=""
                        className="size-4 shrink-0 rounded-sm object-cover"
                      />
                    )}
                    <span className="truncate">{entry.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              {workspace && isAdmin && (
                <DropdownMenuItem onClick={() => setManagingTeam(true)}>
                  <UsersIcon />
                  Manage team
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setCreatingWorkspace(true)}>
                <PlusIcon />
                New workspace
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="ml-auto rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Avatar className="size-8 ring-1 ring-border">
              <AvatarImage src={user?.profilePictureUrl ?? undefined} alt="" />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col gap-1 px-2 py-1.5">
                {name && <span className="text-foreground">{name}</span>}
                <span className="truncate font-normal">{user?.email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setViewingInvitations(true)}>
                <EnvelopeSimpleIcon />
                Invitations
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => signOut()}>
                <SignOutIcon />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <NewWorkspace
          open={creatingWorkspace}
          onOpenChange={setCreatingWorkspace}
          onCreated={onSelect}
        />
        {workspace && isAdmin && (
          <WorkspaceTeam
            key={workspace._id}
            workspace={workspace}
            open={managingTeam}
            onOpenChange={setManagingTeam}
          />
        )}
        <Dialog open={viewingInvitations} onOpenChange={setViewingInvitations}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invitations</DialogTitle>
            </DialogHeader>
            {viewingInvitations && (
              <WorkspaceInvitations
                showEmpty
                onAccepted={(workspaceId) => {
                  onSelect(workspaceId)
                  setViewingInvitations(false)
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </header>
  )
}

// Time for today, the weekday for this week, and the date otherwise.
function listedDate(timestamp: number, now: Date) {
  const date = new Date(timestamp)
  if (isToday(date)) return format(date, "p")
  if (isYesterday(date)) return "Yesterday"
  if (isSameWeek(date, now, { weekStartsOn: 1 })) return format(date, "EEE")
  if (isSameYear(date, now)) return format(date, "MMM d")
  return format(date, "MMM d, yyyy")
}

function ProgramList({
  workspaceId,
  archived,
  query,
}: {
  workspaceId: Id<"workspaces">
  archived: boolean
  query: string
}) {
  const programs = useQuery(api.programs.listByWorkspace, { workspaceId })
  const client = useConvex()

  if (programs === undefined) {
    return <ProgramListSkeleton />
  }

  if (programs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
        No programs yet
      </p>
    )
  }

  const needle = query.trim().toLowerCase()
  const visible = [...programs]
    .filter(
      (program) =>
        Boolean(program.archivedAt) === archived &&
        program.name.toLowerCase().includes(needle)
    )
    .sort((a, b) => b.createdAt - a.createdAt)

  if (visible.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {needle
          ? "No matches"
          : archived
            ? "No archived programs"
            : "No active programs"}
      </p>
    )
  }

  const now = new Date()
  return (
    <ItemGroup className="gap-0 overflow-hidden rounded-xl surface-raised">
      {visible.map((program) => (
        <Item
          key={program._id}
          className="group relative min-h-12 gap-3 rounded-none border-0 px-3 py-2 transition-colors not-last:shadow-[0_1px_0_0_var(--border)] hover:bg-accent/60"
        >
          <ItemMedia className="translate-y-0! self-center!">
            <img
              src={templateIcons[program.template]}
              alt=""
              className="size-6 object-contain"
            />
          </ItemMedia>
          <ItemContent className="min-w-0 gap-0">
            <ItemTitle className="w-full min-w-0 text-[13px] leading-5 font-medium">
              <Link
                to="/programs/$programId"
                params={{ programId: program._id }}
                data-cuelume-navigate
                onPointerEnter={() => {
                  // Start the editor's listing and open tabs before the click.
                  if (program.repositoryStatus === "ready")
                    prefetchProgramEditor(client, program._id)
                }}
                className="min-w-0 truncate after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
              >
                {program.name}
              </Link>
            </ItemTitle>
          </ItemContent>
          <ItemActions className="relative z-10">
            <RepositoryStatusBadge status={program.repositoryStatus} />
            <time
              dateTime={new Date(program.createdAt).toISOString()}
              title={format(program.createdAt, "PPPp")}
              className="pointer-events-none text-xs text-muted-foreground tabular-nums"
            >
              {listedDate(program.createdAt, now)}
            </time>
            <ProgramActions program={program} />
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  )
}

function ProgramActions({ program }: { program: Doc<"programs"> }) {
  const rename = useMutation(api.programs.rename)
  const setArchived = useMutation(api.programs.setArchived)
  const [open, setOpen] = useState(false)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [name, setName] = useState(program.name)
  const [pending, setPending] = useState(false)
  async function save(action: () => Promise<unknown>) {
    if (pending) return
    setPending(true)
    try {
      await action()
      setOpen(false)
    } catch (error) {
      toast.add({
        type: "error",
        title: "Could not update program",
        description: errorMessage(error),
      })
    } finally {
      setPending(false)
    }
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${program.name}`}
              data-cuelume-open
              disabled={pending}
            />
          }
        >
          <DotsThreeIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            disabled={program.repositoryStatus !== "ready"}
            onClick={() => setDuplicateOpen(true)}
          >
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setName(program.name)
              setOpen(true)
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              void save(() =>
                setArchived({
                  programId: program._id,
                  archived: !program.archivedAt,
                })
              )
            }
          >
            {program.archivedAt ? "Restore program" : "Archive"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {duplicateOpen && (
        <DuplicateProgramDialog
          programId={program._id}
          programName={program.name}
          open={duplicateOpen}
          onOpenChange={setDuplicateOpen}
        />
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value)
        }}
      >
        <DialogContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void save(() => rename({ programId: program._id, name }))
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename program</DialogTitle>
            </DialogHeader>
            <Input
              aria-label="Name"
              autoFocus
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={pending}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function NewProgramDialog({
  workspaceId,
  initialTemplate,
}: {
  workspaceId: Id<"workspaces">
  initialTemplate: Template
}) {
  const generateName = useMutation(api.programs.generateName)
  const createProgram = useMutation(api.programs.create)
  const navigate = Route.useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [generatedName, setGeneratedName] = useState("")
  const [template, setTemplate] = useState<Template>(initialTemplate)
  const [pending, setPending] = useState(false)
  // Numbers each suggestion request so a reply that arrives after close is ignored.
  const suggestion = useRef(0)

  function suggestName() {
    const request = ++suggestion.current
    setGeneratedName("")
    void generateName({})
      .then((next) => {
        if (request === suggestion.current) setGeneratedName(next)
      })
      .catch((error) => {
        if (request === suggestion.current)
          toast.add({
            type: "error",
            title: "Could not suggest a name",
            description: errorMessage(error),
          })
      })
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() && !generatedName) return
    setPending(true)
    try {
      const programId = await createProgram({
        workspaceId,
        template,
        name: name.trim() || generatedName,
      })
      setOpen(false)
      setName("")
      await navigate({ to: "/programs/$programId", params: { programId } })
    } catch (error) {
      toast.add({
        type: "error",
        title: "Could not create the program",
        description: errorMessage(error),
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setTemplate(initialTemplate)
          suggestName()
        } else suggestion.current++
        setOpen(next)
      }}
    >
      <DialogTrigger
        render={
          <Button
            aria-label={`New ${templateLabels[initialTemplate]} program`}
            variant="outline"
            className={starterTileClassName}
            style={starterTileStyle(`var(--template-${initialTemplate})`)}
            data-cuelume-open
          />
        }
      >
        <StarterTile
          icon={
            <img
              src={templateIcons[initialTemplate]}
              alt=""
              className="size-6 object-contain"
            />
          }
          label={templateLabels[initialTemplate]}
        />
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New program</DialogTitle>
          </DialogHeader>
          <ToggleGroup
            aria-label="Template"
            multiple={false}
            value={[template]}
            onValueChange={(value) => {
              const next = templateOrder.find((item) => item === value.at(-1))
              if (next) setTemplate(next)
            }}
            className="grid w-full grid-cols-5"
          >
            {templateOrder.map((item) => (
              <ToggleGroupItem
                key={item}
                value={item}
                className="h-auto flex-col gap-1.5 px-1 py-2 text-xs"
              >
                <img
                  src={templateIcons[item]}
                  alt=""
                  className="size-6 object-contain"
                />
                {templateLabels[item]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Input
            aria-label="Name"
            value={name}
            maxLength={80}
            placeholder={generatedName || "Name"}
            onChange={(event) => setName(event.target.value)}
          />
          <DialogFooter>
            <DialogClose
              render={
                <Button variant="outline" type="button" data-cuelume-close />
              }
            >
              Cancel
            </DialogClose>
            <Button
              type="submit"
              data-cuelume-tap
              disabled={pending || (!name.trim() && !generatedName)}
            >
              {pending && <Spinner data-icon="inline-start" />}
              Create program
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProgramListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-12 w-full rounded-xl" />
      ))}
    </div>
  )
}
