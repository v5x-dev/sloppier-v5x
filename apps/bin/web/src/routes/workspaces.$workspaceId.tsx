import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router"
import type { Id } from "@v5x/backend/dataModel"
import { api } from "@v5x/backend/api"
import { Spinner } from "@v5x/ui/components/spinner"
import { useQuery } from "convex/react"
import { useEffect } from "react"
import { AppRail } from "@/components/app-rail"
import { RequireSignIn } from "@/components/require-sign-in"
import { writeLastWorkspace } from "@/lib/last-workspace"

// Every page under a workspace renders inside the app shell: the rail with the
// workspace switcher and navigation, and the page beside it.
export const Route = createFileRoute("/workspaces/$workspaceId")({
  component: WorkspaceLayout,
})

function WorkspaceLayout() {
  return (
    <RequireSignIn>
      <Shell />
    </RequireSignIn>
  )
}

function Shell() {
  const { workspaceId: raw } = Route.useParams()
  const workspaceId = raw as Id<"workspaces">
  const memberships = useQuery(api.workspaces.listMine)
  const navigate = useNavigate()

  useEffect(() => {
    writeLastWorkspace(workspaceId)
  }, [workspaceId])

  if (memberships === undefined) {
    return (
      <div className="flex h-svh items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  const workspaces = memberships.flatMap((m) =>
    m.workspace ? [m.workspace] : []
  )
  const current = memberships.find((m) => m.workspace?._id === workspaceId)
  const open = (id: Id<"workspaces">) => {
    void navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId: id },
    })
  }

  return (
    <div className="flex h-svh">
      <AppRail
        workspaces={workspaces}
        workspace={current?.workspace ?? undefined}
        role={current?.role}
        onSelect={open}
        onCreated={open}
      />
      <main className="h-svh min-w-0 flex-1 overflow-hidden">
        {current?.workspace ? (
          <Outlet />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">
            This workspace is not available to you. Pick another from the
            workspace menu.
          </p>
        )}
      </main>
    </div>
  )
}
