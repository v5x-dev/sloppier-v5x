import { useAuth } from "@/lib/auth"
import { SigningIn } from "@/components/app/signing-in"
import { api } from "@v5x/backend/api"
import { toast } from "@v5x/ui/components/toast"
import { useConvexAuth, useMutation } from "convex/react"
import { useEffect, useState, type ReactNode } from "react"
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
  // The sign-in redirect starts once. The page leaves for the sign-in service, so it is never started again.
  const [redirect, setRedirect] = useState<"pending" | "started">("pending")
  const ensurePersonalWorkspace = useMutation(api.workspaces.ensurePersonal)

  useEffect(() => {
    if (isLoading || isAuthenticated || redirect === "started") return
    setRedirect("started")
    void signIn({ state: { returnTo: window.location.pathname } })
  }, [isLoading, isAuthenticated, redirect, signIn])

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
