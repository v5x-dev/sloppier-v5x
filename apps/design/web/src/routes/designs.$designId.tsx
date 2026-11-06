import {
  ArrowLeftIcon,
  CheckIcon,
  CloudSlashIcon,
  CubeIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useAuth } from "@v5x/auth"
import { AuthGate, SigningIn } from "@v5x/auth/gate"
import { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
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
import { useQuery } from "convex/react"
import { useDesignSync, type DesignSyncState } from "@/lib/use-design-sync"

export const Route = createFileRoute("/designs/$designId")({
  component: () => (
    <AuthGate>
      <DesignPage />
    </AuthGate>
  ),
  errorComponent: ({ error }) => (
    <Empty className="min-h-svh">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WarningCircleIcon />
        </EmptyMedia>
        <EmptyTitle>This Design could not be opened</EmptyTitle>
        <EmptyDescription>{errorMessage(error)}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/" />} nativeButton={false}>
          Back to Designs
        </Button>
      </EmptyContent>
    </Empty>
  ),
})

function DesignPage() {
  const { designId } = Route.useParams()
  const { user } = useAuth()
  if (!user) return <SigningIn />
  return <DesignEditor designId={designId as Id<"designs">} userId={user.id} />
}

function DesignEditor({
  designId,
  userId,
}: {
  designId: Id<"designs">
  userId: string
}) {
  const design = useQuery(api.designs.get, { designId })
  const { state } = useDesignSync(designId, userId)

  return (
    <div className="flex h-svh flex-col">
      <header className="flex items-center gap-2 border-b border-border px-2 py-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to Designs"
          render={<Link to="/" />}
          nativeButton={false}
        >
          <ArrowLeftIcon />
        </Button>
        <h1 className="min-w-0 flex-1 truncate font-serif text-lg">
          {design?.name}
        </h1>
        <SaveStatus state={state} />
      </header>
      <main className="flex flex-1 items-center justify-center">
        {design?.copyingFrom ? (
          <div className="flex flex-col items-center gap-3">
            <Spinner className="size-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Copying this Design…
            </p>
          </div>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CubeIcon />
              </EmptyMedia>
              <EmptyTitle>This Design is empty</EmptyTitle>
              <EmptyDescription>
                Placing parts is on the way. This Design is saved and ready for
                them.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </main>
    </div>
  )
}

function SaveStatus({ state }: { state: DesignSyncState }) {
  const label = {
    loading: "Loading…",
    saving: "Saving…",
    saved: "Saved",
    offline: "Offline. Changes are kept on this device.",
    error: state.kind === "error" ? `Not saved: ${state.message}` : "",
  }[state.kind]
  return (
    <p
      role="status"
      className="flex shrink-0 items-center gap-1.5 px-2 text-sm text-muted-foreground"
    >
      {state.kind === "saved" && <CheckIcon />}
      {state.kind === "offline" && <CloudSlashIcon />}
      {state.kind === "error" && <WarningCircleIcon />}
      {label}
    </p>
  )
}
