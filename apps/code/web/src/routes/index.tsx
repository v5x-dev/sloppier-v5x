import { DuplicateProgramDialog } from "@/components/program/duplicate-program-dialog"
import {
  ArchiveBoxIcon,
  CaretUpDownIcon,
  MagnifyingGlassIcon,
  DotsThreeIcon,
  BuildingsIcon,
  CodeIcon,
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@v5x/ui/components/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@v5x/ui/components/empty"
import { Field, FieldGroup, FieldLabel } from "@v5x/ui/components/field"
import { Input } from "@v5x/ui/components/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@v5x/ui/components/item"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v5x/ui/components/select"
import { Skeleton } from "@v5x/ui/components/skeleton"
import { Spinner } from "@v5x/ui/components/spinner"
import { toast } from "@v5x/ui/components/toast"
import { useAction, useMutation, useQuery } from "convex/react"
import { formatDistanceToNow, startOfDay, startOfWeek, subDays } from "date-fns"
import { Toggle } from "@v5x/ui/components/toggle"
import { ActionTooltip } from "@/components/shared/action-tooltip"
import { useEffect, useRef, useState } from "react"
import {
  StarterTile,
  starterTileClassName,
  starterTileStyle,
} from "@/components/program/starter-tile"
import {
  NewWorkspace,
  WorkspaceTeam,
  WorkspaceInvitations,
} from "@/components/workspace/workspace-team"
import { ImportFolder } from "@/components/repository/import-folder"
import { AuthGate } from "@/components/app/auth-gate"
import { RepositoryStatusBadge } from "@/components/repository/repository-status-badge"
import { errorMessage } from "@/lib/errors"

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

const templateIcons: Record<Template, string> = {
  vexcode: "/template-icons/vexcode.png",
  jar: "/template-icons/jar.svg",
  pros: "/template-icons/pros.png",
  "ez-template": "/template-icons/ez.png",
}

const templateLabels: Record<Template, string> = {
  vexcode: "VEXCode",
  jar: "JAR",
  pros: "PROS",
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

  const available = (workspaces ?? []).flatMap(({ workspace }) =>
    workspace ? [workspace] : []
  )
  const workspace =
    available.find(({ _id }) => _id === selectedId) ?? available.at(0)

  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader
        workspaces={available}
        workspace={workspace}
        isAdmin={
          workspaces?.find((entry) => entry.workspace?._id === workspace?._id)
            ?.role === "admin"
        }
        onSelect={setSelectedId}
      />
      <main className="mx-auto flex w-[52rem] max-w-full flex-1 flex-col gap-10 px-4 pt-8 pb-16 sm:px-6">
        <section
          aria-labelledby="starters-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="starters-heading" className="text-base font-semibold">
            Create program
          </h2>
          <div className="grid grid-cols-2 gap-3 pb-1 sm:grid-cols-5">
            {(["vexcode", "jar", "pros", "ez-template"] as const).map(
              (template) =>
                workspace ? (
                  <NewProgramDialog
                    key={`${workspace._id}-${template}`}
                    workspaceId={workspace._id}
                    initialTemplate={template}
                    tile
                  />
                ) : (
                  <Skeleton key={template} className="h-[6.75rem] rounded-xl" />
                )
            )}
            {workspace ? (
              <ImportFolder
                key={workspace._id}
                workspaceId={workspace._id}
                tile
              />
            ) : (
              <Skeleton className="h-[6.75rem] rounded-xl" />
            )}
          </div>
        </section>
        <section
          aria-labelledby="programs-heading"
          className="flex flex-col gap-4"
        >
          <div className="flex flex-wrap items-center gap-3">
            <h2
              id="programs-heading"
              className="mr-auto text-base font-semibold"
            >
              Programs
            </h2>
            <div className="flex max-w-full items-center gap-1.5">
              <div className="relative w-56 max-w-full">
                <MagnifyingGlassIcon
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  aria-label="Search programs"
                  placeholder="Search programs…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setQuery("")
                  }}
                  className="h-8 pl-8 [&::-webkit-search-cancel-button]:appearance-none"
                />
              </div>
              <ActionTooltip
                label={
                  archived ? "Show active programs" : "Show archived programs"
                }
              >
                <Toggle
                  variant="outline"
                  className="h-8 w-8 shrink-0 px-0"
                  aria-label="Show archived programs"
                  pressed={archived}
                  onPressedChange={setArchived}
                >
                  <ArchiveBoxIcon />
                </Toggle>
              </ActionTooltip>
            </div>
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
        </section>
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
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
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
              <DialogDescription>
                Join a workspace using an invitation sent to your account email.
              </DialogDescription>
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

  if (programs === undefined) {
    return <ProgramListSkeleton />
  }

  if (programs.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CodeIcon />
          </EmptyMedia>
          <EmptyTitle>No programs yet</EmptyTitle>
          <EmptyDescription>
            Start from a VEXCode, JAR, PROS, or EZ starter.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <NewProgramDialog workspaceId={workspaceId} />
        </EmptyContent>
      </Empty>
    )
  }

  const now = new Date()
  const today = startOfDay(now).getTime()
  const yesterday = startOfDay(subDays(now, 1)).getTime()
  const week = startOfWeek(now, { weekStartsOn: 1 }).getTime()
  const groups = ["Today", "Yesterday", "This week", "Older"]
  const visible = [...programs]
    .filter(
      (program) =>
        Boolean(program.archivedAt) === archived &&
        program.name.toLowerCase().includes(query.toLowerCase())
    )
    .sort((a, b) => b.createdAt - a.createdAt)
  return (
    <div className="flex flex-col gap-6">
      {visible.length === 0 && (
        <p className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
          No matching {archived ? "archived" : "active"} programs.
        </p>
      )}
      {groups.map((label, index) => {
        const entries = visible.filter(
          ({ createdAt }) =>
            (createdAt >= today
              ? 0
              : createdAt >= yesterday
                ? 1
                : createdAt >= week
                  ? 2
                  : 3) === index
        )
        if (!entries.length) return null
        return (
          <section
            key={label}
            aria-label={label}
            className="flex flex-col gap-2"
          >
            <h3 className="px-1 text-xs font-medium text-muted-foreground">
              {label}
            </h3>
            <ItemGroup className="gap-0 overflow-hidden rounded-xl surface-raised">
              {entries.map((program) => (
                <Item
                  key={program._id}
                  className="group relative min-h-14 gap-x-4 rounded-none border-0 px-4 py-2 transition-colors not-last:shadow-[0_1px_0_0_var(--border)] hover:bg-accent/60"
                >
                  <ItemMedia className="translate-y-0! self-center!">
                    <img
                      src={templateIcons[program.template]}
                      alt=""
                      className="size-6 object-contain"
                    />
                  </ItemMedia>
                  <ItemContent className="gap-0">
                    <ItemTitle className="text-[13px] leading-5 font-medium">
                      <Link
                        to="/programs/$programId"
                        params={{ programId: program._id }}
                        className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                      >
                        {program.name}
                      </Link>
                    </ItemTitle>
                    <ItemDescription className="font-documentation text-xs">
                      Created{" "}
                      {formatDistanceToNow(program.createdAt, {
                        addSuffix: true,
                      })}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className="relative z-10">
                    <RepositoryStatusBadge status={program.repositoryStatus} />
                    <ProgramActions program={program} />
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </section>
        )
      })}
    </div>
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
            className="flex flex-col gap-6"
            onSubmit={(event) => {
              event.preventDefault()
              void save(() => rename({ programId: program._id, name }))
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename program</DialogTitle>
              <DialogDescription>
                Choose a name for this program.
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor={`program-name-${program._id}`}>
                Name
              </FieldLabel>
              <Input
                id={`program-name-${program._id}`}
                autoFocus
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={pending}
              />
            </Field>
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
  initialTemplate = "pros",
  tile = false,
}: {
  workspaceId: Id<"workspaces">
  initialTemplate?: Template
  tile?: boolean
}) {
  const templates = useQuery(api.programs.listTemplates)
  const createProgram = useMutation(api.programs.create)
  const generateName = useMutation(api.programs.generateName)
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
            aria-label={`New ${initialTemplate} program`}
            title={`New ${initialTemplate} program`}
            className={tile ? starterTileClassName : undefined}
            style={
              tile
                ? starterTileStyle(`var(--template-${initialTemplate})`)
                : undefined
            }
            variant={tile ? "outline" : "default"}
            size={tile ? "default" : "icon"}
          />
        }
      >
        {tile ? (
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
        ) : (
          <PlusIcon />
        )}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>New program</DialogTitle>
            <DialogDescription>
              Pick a starter. Leave the name blank to use the suggested name.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel>Template</FieldLabel>
              <Select
                value={template}
                onValueChange={(value) => setTemplate(value as Template)}
                items={(templates ?? []).map(({ id, label }) => ({
                  value: id,
                  label,
                }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(templates ?? []).map(({ id, label }) => (
                    <SelectItem key={id} value={id}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="program-name">Name</FieldLabel>
              <Input
                id="program-name"
                value={name}
                maxLength={80}
                placeholder={generatedName || "Program name"}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              Cancel
            </DialogClose>
            <Button
              type="submit"
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
        <Skeleton key={index} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  )
}
