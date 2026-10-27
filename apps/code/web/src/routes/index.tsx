import {
  ArchiveBoxIcon,
  MagnifyingGlassIcon,
  XIcon,
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
import { api } from "@workspace/backend/api"
import type { Doc, Id } from "@workspace/backend/dataModel"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
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
} from "@workspace/ui/components/dropdown-menu"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"
import { useAction, useMutation, useQuery } from "convex/react"
import { startOfDay, startOfWeek, subDays } from "date-fns"
import { useEffect, useRef, useState } from "react"
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
        searching={searching}
        query={query}
        onQueryChange={setQuery}
        archived={archived}
        onToggleArchived={() => setArchived((value) => !value)}
        onSearch={() => {
          if (searching) setQuery("")
          setSearching((value) => !value)
        }}
      />
      <section aria-label="Create a program" className="border-b bg-card">
        <div className="mx-auto grid w-[58rem] max-w-full grid-cols-[repeat(5,minmax(96px,1fr))] gap-4 overflow-x-auto px-4 py-4">
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
                <Skeleton
                  key={template}
                  className="aspect-[4/3] min-w-24 rounded-2xl"
                />
              )
          )}
          {workspace ? (
            <ImportFolder
              key={workspace._id}
              workspaceId={workspace._id}
              tile
            />
          ) : (
            <Skeleton className="aspect-[4/3] min-w-24 rounded-2xl" />
          )}
        </div>
      </section>
      <main className="mx-auto flex w-3xl max-w-full flex-1 flex-col gap-4 px-4 py-4">
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
  onSearch,
  searching,
  query,
  onQueryChange,
  archived,
  onToggleArchived,
}: {
  workspaces: Doc<"workspaces">[]
  workspace: Doc<"workspaces"> | undefined
  isAdmin: boolean
  onSelect: (id: Id<"workspaces">) => void
  onSearch: () => void
  searching: boolean
  query: string
  onQueryChange: (query: string) => void
  archived: boolean
  onToggleArchived: () => void
}) {
  const { user, signOut } = useAuth()
  const searchButton = useRef<HTMLButtonElement>(null)
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
    <header className="border-b">
      <div className="mx-auto flex min-h-12 w-[50rem] max-w-full items-center justify-between gap-3 px-4 py-2">
        <Link to="/" aria-label="code (by v5x) home" className="text-primary">
          <span
            aria-hidden="true"
            className="block h-5 w-6 bg-current"
            style={{ mask: "url(/favicon.svg) center / contain no-repeat" }}
          />
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <div
            className={`relative h-8 shrink-0 transition-[width] duration-200 ease-out motion-reduce:transition-none ${searching ? "w-64 max-w-[calc(100vw-8rem)]" : "w-8"}`}
          >
            {searching && (
              <Input
                autoFocus
                id="dashboard-search"
                type="search"
                aria-label="Search programs"
                placeholder="Search programs…"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault()
                    onSearch()
                    searchButton.current?.focus()
                  }
                }}
                className="pr-9 [&::-webkit-search-cancel-button]:appearance-none"
              />
            )}
            <Button
              ref={searchButton}
              variant="ghost"
              size="icon"
              aria-label={searching ? "Close search" : "Search programs"}
              aria-expanded={searching}
              aria-controls={searching ? "dashboard-search" : undefined}
              onClick={onSearch}
              className={
                searching
                  ? "absolute top-0 right-0 aria-expanded:bg-transparent aria-expanded:hover:bg-muted dark:aria-expanded:hover:bg-muted/50"
                  : undefined
              }
            >
              {searching ? (
                <XIcon className="size-4" />
              ) : (
                <MagnifyingGlassIcon />
              )}
            </Button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Account menu"
              className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Avatar className="size-7">
                <AvatarImage
                  src={user?.profilePictureUrl ?? undefined}
                  alt=""
                />
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
                <DropdownMenuLabel>Workspace</DropdownMenuLabel>
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
                      <BuildingsIcon />
                      <span className="truncate">{entry.name}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuItem onClick={() => setCreatingWorkspace(true)}>
                  <PlusIcon />
                  New workspace
                </DropdownMenuItem>
                {workspace && isAdmin && (
                  <DropdownMenuItem onClick={() => setManagingTeam(true)}>
                    <UsersIcon />
                    Manage team
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setViewingInvitations(true)}>
                  <EnvelopeSimpleIcon />
                  Invitations
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onToggleArchived}>
                  <ArchiveBoxIcon />
                  {archived ? "Show active programs" : "Show archived programs"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => signOut()}>
                  <SignOutIcon />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
    <div className="flex flex-col gap-2">
      {visible.length === 0 && (
        <p className="py-8 text-center text-muted-foreground">
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
            <h2
              className={`font-heading text-sm leading-5 ${index === 0 ? "text-foreground" : "text-muted-foreground"}`}
            >
              {label}
            </h2>
            <ItemGroup className="gap-2">
              {entries.map((program) => (
                <Item
                  key={program._id}
                  className="group relative min-h-11 rounded-xl border-0 bg-card px-4 py-2 hover:bg-muted"
                >
                  <ItemContent>
                    <ItemTitle className="text-base leading-7 font-normal">
                      <Link
                        to="/programs/$programId"
                        params={{ programId: program._id }}
                        className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                      >
                        {program.name}
                      </Link>
                    </ItemTitle>
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
            className={
              tile
                ? "aspect-[4/3] h-auto w-full min-w-24 rounded-xl bg-(--template-tile)/25 p-4 hover:bg-(--template-tile)/25 hover:brightness-110"
                : undefined
            }
            style={
              tile
                ? ({
                    "--template-tile": `var(--template-${initialTemplate})`,
                  } as React.CSSProperties)
                : undefined
            }
            size={tile ? "default" : "icon"}
          />
        }
      >
        {tile ? (
          <img
            src={templateIcons[initialTemplate]}
            alt={initialTemplate}
            className="size-8 object-contain"
          />
        ) : (
          <PlusIcon data-icon="inline-start" />
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
        <Skeleton key={index} className="h-11 w-full" />
      ))}
    </div>
  )
}
