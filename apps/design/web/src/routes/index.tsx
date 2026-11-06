import {
  BuildingsIcon,
  CaretUpDownIcon,
  CubeIcon,
  PlusIcon,
  SignOutIcon,
} from "@phosphor-icons/react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useAuth } from "@v5x/auth"
import { AuthGate } from "@v5x/auth/gate"
import { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
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
import { useState } from "react"
import { DesignRow } from "@/components/design-row"
import { NameDialog } from "@/components/name-dialog"

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
  const [creating, setCreating] = useState(false)
  const [view, setView] = useState<"active" | "archived">("active")

  const shown = designs
    ?.filter((design) => Boolean(design.archivedAt) === (view === "archived"))
    .sort(
      (a, b) =>
        (b.lastActivityAt ?? b.createdAt) - (a.lastActivityAt ?? a.createdAt)
    )
  const hasArchived = designs?.some((design) => design.archivedAt)

  const newDesign = (
    <Button onClick={() => setCreating(true)}>
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
          {newDesign}
        </div>
      </div>

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

      {creating && (
        <NameDialog
          title="New Design"
          action="Create"
          initialName=""
          onSubmit={async (name) => {
            const designId = await create({ workspaceId, name })
            await navigate({
              to: "/designs/$designId",
              params: { designId },
            })
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </main>
  )
}
