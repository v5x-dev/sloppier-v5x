import { createFileRoute } from "@tanstack/react-router"
import { AuthGate } from "@/components/auth-gate"
import { WorkspaceInvitations } from "@/components/workspace-team"

export const Route = createFileRoute("/invites/$invitationId")({
  component: InvitationPage,
})

function InvitationPage() {
  const { invitationId } = Route.useParams()
  const navigate = Route.useNavigate()
  return (
    <AuthGate>
      <main className="mx-auto flex min-h-svh max-w-xl items-center px-6 py-12">
        <div className="w-full">
          <WorkspaceInvitations
            invitationId={invitationId}
            onAccepted={(workspace) =>
              void navigate({ to: "/", search: { workspace } })
            }
          />
        </div>
      </main>
    </AuthGate>
  )
}
