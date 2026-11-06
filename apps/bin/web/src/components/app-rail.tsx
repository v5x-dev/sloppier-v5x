import {
  ArrowsLeftRightIcon,
  BuildingsIcon,
  ClockCounterClockwiseIcon,
  MapPinIcon,
  PackageIcon,
  PlusIcon,
  SignOutIcon,
} from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import type { Doc, Id } from "@v5x/backend/dataModel"
import { Avatar, AvatarFallback, AvatarImage } from "@v5x/ui/components/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@v5x/ui/components/dropdown-menu"
import { useAuth } from "@workos-inc/authkit-react"
import { useState } from "react"
import { NewWorkspaceDialog } from "@/components/new-workspace-dialog"
import { initials } from "@/lib/format"

const nav = [
  {
    to: "/workspaces/$workspaceId",
    label: "Inventory",
    icon: PackageIcon,
    exact: true,
  },
  {
    to: "/workspaces/$workspaceId/loans",
    label: "Loans",
    icon: ArrowsLeftRightIcon,
    exact: false,
  },
  {
    to: "/workspaces/$workspaceId/locations",
    label: "Locations",
    icon: MapPinIcon,
    exact: false,
  },
  {
    to: "/workspaces/$workspaceId/history",
    label: "History",
    icon: ClockCounterClockwiseIcon,
    exact: false,
  },
] as const

const railButton =
  "grid size-9 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"

export function AppRail({
  workspaces,
  workspace,
  role,
  onSelect,
  onCreated,
}: {
  workspaces: Doc<"workspaces">[]
  workspace: Doc<"workspaces"> | undefined
  role: "admin" | "member" | undefined
  onSelect: (id: Id<"workspaces">) => void
  onCreated: (id: Id<"workspaces">) => void
}) {
  const { user, signOut } = useAuth()
  const [creating, setCreating] = useState(false)
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ")

  return (
    <nav
      aria-label="Main"
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r py-3"
    >
      <Link
        to="/"
        aria-label="bin (by v5x) home"
        className="mb-2 flex h-9 items-center rounded-md text-chart-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span
          aria-hidden="true"
          className="block h-5 w-6 bg-current"
          style={{ mask: "url(/favicon.svg) center / contain no-repeat" }}
        />
      </Link>

      {workspace
        ? nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              params={{ workspaceId: workspace._id }}
              activeOptions={{ exact: item.exact }}
              title={item.label}
              aria-label={item.label}
              className={railButton}
              activeProps={{ className: "bg-muted text-foreground" }}
            >
              <item.icon className="size-5" />
            </Link>
          ))
        : null}

      <div className="mt-auto flex flex-col items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Switch workspace, current: ${workspace?.name ?? "none"}`}
            title={workspace?.name ?? "Workspace"}
            className="grid size-9 place-items-center overflow-hidden rounded-lg bg-muted text-foreground outline-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {workspace?.icon ? (
              <img
                src={workspace.icon}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              <BuildingsIcon className="size-5" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-64">
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
              <DropdownMenuItem onClick={() => setCreating(true)}>
                <PlusIcon />
                New workspace
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Avatar className="size-8 ring-1 ring-border">
              <AvatarImage src={user?.profilePictureUrl ?? undefined} alt="" />
              <AvatarFallback>
                {initials(name || user?.email || "")}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col gap-1 px-2 py-1.5">
                {name && <span className="text-foreground">{name}</span>}
                <span className="truncate font-normal">{user?.email}</span>
                {role ? (
                  <span className="font-normal">
                    {role === "admin" ? "Admin" : "Member"} of {workspace?.name}
                  </span>
                ) : null}
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

      <NewWorkspaceDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={onCreated}
      />
    </nav>
  )
}
