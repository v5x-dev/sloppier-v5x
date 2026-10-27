import {
  ArchiveBoxIcon,
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
  ItemDescription,
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
import { formatDistanceToNow } from "date-fns"
import { useEffect, useState } from "react"
import { prefetchLanguageAssets } from "@/lib/language/prefetch"
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
  useEffect(() => prefetchLanguageAssets(), [])
  const workspaces = useQuery(api.workspaces.listMine)
  const search = Route.useSearch()
  const [selectedId, setSelectedId] = useState<string | null>(
    search.workspace ?? null
  )
  const [archived, setArchived] = useState(false)

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
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
        {/* AuthGate creates the first workspace; show loading until it lands. */}
        {!workspace ? (
          <ProgramListSkeleton />
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h1 className="font-heading text-2xl font-semibold">
                Your programs
              </h1>
              <div className="flex items-center gap-2">
                <Button
                  variant={archived ? "secondary" : "outline"}
                  size="icon"
                  aria-label="Toggle archived programs"
                  aria-pressed={archived}
                  title={
                    archived ? "Show active programs" : "Show archived programs"
                  }
                  onClick={() => setArchived((current) => !current)}
                >
                  <ArchiveBoxIcon />
                </Button>
                <ImportFolder key={workspace._id} workspaceId={workspace._id} />
                <NewProgramDialog workspaceId={workspace._id} />
              </div>
            </div>
            <ProgramList workspaceId={workspace._id} archived={archived} />
          </>
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
    <header className="border-b">
      <div className="mx-auto flex min-h-14 max-w-4xl items-center justify-between gap-4 px-6 py-2">
        <Link to="/" aria-label="code (by v5x) home" className="text-primary">
          <span
            aria-hidden="true"
            className="block size-6 bg-current"
            style={{ mask: "url(/favicon.svg) center / contain no-repeat" }}
          />
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Avatar size="sm">
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
}: {
  workspaceId: Id<"workspaces">
  archived: boolean
}) {
  const programs = useQuery(api.programs.listByWorkspace, { workspaceId })
  const templates = useQuery(api.programs.listTemplates)

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

  const templateLabel = (id: Template) =>
    templates?.find((template) => template.id === id)?.label ?? id

  return (
    <ItemGroup className="gap-2">
      {!programs.some(
        (program) => Boolean(program.archivedAt) === archived
      ) && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No {archived ? "archived" : "active"} programs.
        </p>
      )}
      {[...programs]
        .filter((program) => Boolean(program.archivedAt) === archived)
        .sort((left, right) => right.createdAt - left.createdAt)
        .map((program) => (
          <Item key={program._id} variant="outline">
            <ItemContent>
              <ItemTitle>
                <Link
                  to="/programs/$programId"
                  params={{ programId: program._id }}
                  className="hover:underline"
                >
                  {program.name}
                </Link>
              </ItemTitle>
              <ItemDescription className="text-xs">
                Created{" "}
                {formatDistanceToNow(program.createdAt, { addSuffix: true })}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <img
                src={templateIcons[program.template]}
                alt={templateLabel(program.template)}
                className="mr-2 size-5 shrink-0 object-contain"
              />
              <RepositoryStatusBadge status={program.repositoryStatus} />
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
              size="icon"
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

function NewProgramDialog({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const templates = useQuery(api.programs.listTemplates)
  const createProgram = useMutation(api.programs.create)
  const generateName = useMutation(api.programs.generateName)
  const navigate = Route.useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [generatedName, setGeneratedName] = useState("")
  const [template, setTemplate] = useState<Template>("pros")
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setGeneratedName("")
    void generateName({})
      .then((suggestion) => {
        if (!cancelled) setGeneratedName(suggestion)
      })
      .catch((error) => {
        if (!cancelled)
          toast.add({
            type: "error",
            title: "Could not suggest a name",
            description: errorMessage(error),
          })
      })
    return () => {
      cancelled = true
    }
  }, [open, generateName])

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="icon" />}>
        <PlusIcon data-icon="inline-start" />
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
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  )
}
