import { useAuth } from "@/lib/auth"
import { SigningIn } from "@/components/app/signing-in"
import { api } from "@v5x/backend/api"
import { toast } from "@v5x/ui/components/toast"
import { useConvexAuth, useMutation } from "convex/react"
import { useEffect, useRef, type ReactNode } from "react"
import { errorMessage } from "@/lib/errors"

export function AuthGate({
  children,
  renderWhileLoading = false,
}: {
  children: ReactNode
  renderWhileLoading?: boolean
}) {
  const { isLoading, isAuthenticated } = useConvexAuth()
  const { signIn } = useAuth()
  const redirectStarted = useRef(false)
  const ensurePersonalWorkspace = useMutation(api.workspaces.ensurePersonal)

  useEffect(() => {
    if (isLoading || isAuthenticated || redirectStarted.current) return
    redirectStarted.current = true
    void signIn({ state: { returnTo: window.location.pathname } })
  }, [isLoading, isAuthenticated, signIn])

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

  if ((!renderWhileLoading && isLoading) || (!isLoading && !isAuthenticated)) {
    return <SigningIn />
  }

  return children
}
