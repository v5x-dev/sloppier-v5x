import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router"
import { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
import { Button } from "@v5x/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@v5x/ui/components/empty"
import { Spinner } from "@v5x/ui/components/spinner"
import { useQuery } from "convex/react"
import { useState } from "react"
import { NewWorkspaceDialog } from "@/components/new-workspace-dialog"
import { RequireSignIn } from "@/components/require-sign-in"
import { readLastWorkspace, writeLastWorkspace } from "@/lib/last-workspace"

// `/` has no screen of its own: it opens the workspace used last, or the first
// one the signed-in person belongs to.
export const Route = createFileRoute("/")({
  component: HomePage,
})

function HomePage() {
  return (
    <RequireSignIn>
      <OpenWorkspace />
    </RequireSignIn>
  )
}

function OpenWorkspace() {
  const memberships = useQuery(api.workspaces.listMine)
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)

  if (memberships === undefined) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  const workspaces = memberships.flatMap((m) =>
    m.workspace ? [m.workspace] : []
  )
  if (workspaces.length === 0) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No workspace yet</EmptyTitle>
            <EmptyDescription>
              Create one for your team to start tracking parts.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setCreating(true)}>New workspace</Button>
          </EmptyContent>
        </Empty>
        <NewWorkspaceDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={(id: Id<"workspaces">) => {
            writeLastWorkspace(id)
            void navigate({
              to: "/workspaces/$workspaceId",
              params: { workspaceId: id },
            })
          }}
        />
      </div>
    )
  }

  const last = readLastWorkspace()
  const target = workspaces.find((w) => w._id === last) ?? workspaces[0]
  return (
    <Navigate
      to="/workspaces/$workspaceId"
      params={{ workspaceId: target._id }}
      replace
    />
  )
}
