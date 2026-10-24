import { WarningCircleIcon } from "@phosphor-icons/react"
import { Link, Navigate, createFileRoute } from "@tanstack/react-router"
import { useAuth } from "@workos-inc/authkit-react"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Spinner } from "@workspace/ui/components/spinner"

// AuthKit exchanges the `code` param on load, then `onRedirectCallback` navigates away.
export const Route = createFileRoute("/callback")({
  component: Callback,
})

function Callback() {
  const { isLoading, user } = useAuth()

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
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
          WorkOS couldn&apos;t complete the sign-in. Check the browser console
          for details, then try again.
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
