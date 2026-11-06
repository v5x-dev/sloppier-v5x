import { WarningCircleIcon } from "@phosphor-icons/react"
import { Link, Navigate, createFileRoute } from "@tanstack/react-router"
import { useAuth } from "@workos-inc/authkit-react"
import { Button } from "@v5x/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@v5x/ui/components/empty"
import { SigningIn } from "@/components/signing-in"

// AuthKit exchanges the `code` param on load, then `onRedirectCallback` navigates away.
export const Route = createFileRoute("/callback")({
  component: Callback,
})

function Callback() {
  const { isLoading, user } = useAuth()

  if (isLoading) return <SigningIn />
  if (user) return <Navigate to="/" replace />

  return (
    <Empty className="min-h-svh">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WarningCircleIcon />
        </EmptyMedia>
        <EmptyTitle>Sign-in didn&apos;t finish</EmptyTitle>
        <EmptyDescription>
          We couldn&apos;t finish signing you in. Try again.
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
