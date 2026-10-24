import { SignInIcon } from "@phosphor-icons/react"
import { useAuth } from "@workos-inc/authkit-react"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Spinner } from "@workspace/ui/components/spinner"
import { api } from "@workspace/backend/api"
import { toast } from "@workspace/ui/components/toast"
import { useConvexAuth, useMutation } from "convex/react"
import { useEffect, type ReactNode } from "react"
import { errorMessage } from "@/lib/errors"

export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth()
  const { signIn } = useAuth()
  const ensurePersonalWorkspace = useMutation(api.workspaces.ensurePersonal)

  // First sign-in gets a "Personal" workspace; later calls are no-ops.
  useEffect(() => {
    if (!isAuthenticated) return
    ensurePersonalWorkspace().catch((error) =>
      toast.add({
        type: "error",
        title: "Could not set up your workspace",
        description: errorMessage(error),
      })
    )
  }, [ensurePersonalWorkspace, isAuthenticated])

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <Empty className="min-h-svh">
        <EmptyHeader>
          <EmptyTitle className="font-heading text-2xl">code (by v5x)</EmptyTitle>
          <EmptyDescription>
            Sign in to open your programs and edit them with your team.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            size="lg"
            onClick={() =>
              signIn({ state: { returnTo: window.location.pathname } })
            }
          >
            <SignInIcon data-icon="inline-start" />
            Sign in
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return children
}
