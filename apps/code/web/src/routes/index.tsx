import { CodeIcon, PlusIcon, SignOutIcon } from "@phosphor-icons/react"
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
import { useMutation, useQuery } from "convex/react"
import { formatDistanceToNow } from "date-fns"
import { useState } from "react"
import { AuthGate } from "@/components/auth-gate"
import { RepositoryStatusBadge } from "@/components/repository-status-badge"
import { errorMessage } from "@/lib/errors"

export const Route = createFileRoute("/")({
  component: () => (
    <AuthGate>
      <ProgramsPage />
    </AuthGate>
  ),
})

type Template = Doc<"projects">["template"]

const templateIcons: Record<Template, string> = {
  vexcode: "/template-icons/vexcode.png",
  jar: "/template-icons/jar.svg",
  pros: "/template-icons/pros.png",
  "ez-template": "/template-icons/ez.png",
}

function ProgramsPage() {
  const workspaces = useQuery(api.workspaces.listMine)
  const [selectedId, setSelectedId] = useState<Id<"workspaces"> | null>(null)

  const available = (workspaces ?? []).flatMap(({ workspace }) =>
    workspace ? [workspace] : []
  )
  const workspace =
    available.find(({ _id }) => _id === selectedId) ?? available.at(0)

  return (
    <div className="min-h-svh">
      <AppHeader />
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
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
                {available.length > 1 && (
                  <Select
                    value={workspace._id}
                    onValueChange={(value) =>
                      setSelectedId(value)
                    }
                    items={available.map(({ _id, name }) => ({
                      value: _id,
                      label: name,
                    }))}
                  >
                    <SelectTrigger className="min-w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {available.map(({ _id, name }) => (
                        <SelectItem key={_id} value={_id}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <NewProgramDialog workspaceId={workspace._id} />
              </div>
            </div>
            <ProgramList workspaceId={workspace._id} />
          </>
        )}
      </main>
    </div>
  )
}

function AppHeader() {
  const { user, signOut } = useAuth()
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
      <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
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
              <DropdownMenuItem onClick={() => signOut()}>
                <SignOutIcon />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

function ProgramList({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const programs = useQuery(api.projects.listByWorkspace, { workspaceId })
  const templates = useQuery(api.projects.listTemplates)

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
      {[...programs]
        .sort((left, right) => right.createdAt - left.createdAt)
        .map((program) => (
          <Item
            key={program._id}
            variant="outline"
            render={
              <Link
                to="/programs/$programId"
                params={{ programId: program._id }}
              />
            }
          >
            <ItemContent>
              <ItemTitle>{program.name}</ItemTitle>
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
            </ItemActions>
          </Item>
        ))}
    </ItemGroup>
  )
}

function NewProgramDialog({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const templates = useQuery(api.projects.listTemplates)
  const createProgram = useMutation(api.projects.create)
  const navigate = Route.useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [template, setTemplate] = useState<Template>("pros")
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    try {
      const programId = await createProgram({
        workspaceId,
        template,
        ...(name.trim() ? { name } : {}),
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
      <DialogTrigger render={<Button />}>
        <PlusIcon data-icon="inline-start" />
        New program
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>New program</DialogTitle>
            <DialogDescription>
              Pick a starter. Leave the name blank to get a generated one.
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
                placeholder="minor-shaman-1239"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending}>
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
