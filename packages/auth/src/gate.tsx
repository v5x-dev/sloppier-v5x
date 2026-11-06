import { WarningCircleIcon } from "@phosphor-icons/react"
import { Link, Navigate } from "@tanstack/react-router"
import { api } from "@v5x/backend/api"
import { errorMessage } from "@v5x/backend/errors"
import { Button } from "@v5x/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@v5x/ui/components/empty"
import { Spinner } from "@v5x/ui/components/spinner"
import { toast } from "@v5x/ui/components/toast"
import { useConvexAuth, useMutation } from "convex/react"
import { useEffect, useRef, type ReactNode } from "react"
import { useAuth } from "./auth"

// Shown during the WorkOS redirect. The words say what is happening, not just that something is.
export function SigningIn() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3">
      <Spinner className="size-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Signing you in…</p>
    </div>
  )
}

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

// AuthKit exchanges the `code` param on load, then `onRedirectCallback` navigates away.
export function CallbackPage() {
  const { isLoading, user } = useAuth()

  if (isLoading) {
    return <SigningIn />
  }

  if (user) {
    return <Navigate to="/" replace />
  }

  return (
    <Empty className="min-h-svh">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WarningCircleIcon />
        </EmptyMedia>
        <EmptyTitle>Sign-in didn&apos;t finish</EmptyTitle>
        <EmptyDescription>
          We couldn&apos;t finish signing you in. Try again. If it keeps
          happening, make sure you&apos;re using the account your coach invited.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/login" />} nativeButton={false}>
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  )
}

// WorkOS "Sign-in endpoint": starts AuthKit sign-in, forwarding any login hint.
export function LoginPage({ loginHint }: { loginHint?: string }) {
  const { isLoading, signIn } = useAuth()

  useEffect(() => {
    if (!isLoading) void signIn({ loginHint })
  }, [isLoading, loginHint, signIn])

  return <SigningIn />
}
