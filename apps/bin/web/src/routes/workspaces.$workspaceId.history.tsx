import { Link, createFileRoute } from "@tanstack/react-router"
import type { Id } from "@v5x/backend/dataModel"
import { api } from "@v5x/backend/api"
import { ScrollArea } from "@v5x/ui/components/scroll-area"
import { Spinner } from "@v5x/ui/components/spinner"
import { cn } from "@v5x/ui/lib/utils"
import { useQuery } from "convex/react"
import { RequireSignIn } from "@/components/require-sign-in"
import { formatDate } from "@/lib/format"

export const Route = createFileRoute("/workspaces/$workspaceId/history")({
  component: () => (
    <RequireSignIn>
      <History />
    </RequireSignIn>
  ),
})

function History() {
  const { workspaceId: raw } = Route.useParams()
  const workspaceId = raw as Id<"workspaces">
  const entries = useQuery(api.bin.history, { workspaceId })

  if (entries === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-bold">History</h1>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No changes yet. Every restock, borrow, and return is recorded here.
          </p>
        ) : (
          <ul>
            {entries.map((entry) => {
              const verb =
                entry.kind === "borrow"
                  ? "borrowed"
                  : entry.kind === "return"
                    ? "returned"
                    : entry.delta > 0
                      ? "restocked"
                      : "removed"
              return (
                <li
                  key={entry._id}
                  className="flex items-start gap-3 border-b py-3 text-sm last:border-b-0"
                >
                  <span
                    className={cn(
                      "min-w-10 rounded-md bg-muted px-2 py-0.5 text-center text-xs font-bold tabular-nums",
                      entry.delta > 0 && "text-success"
                    )}
                  >
                    {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                  </span>
                  <span className="min-w-0 flex-1">
                    {entry.actorName} {verb}{" "}
                    <Link
                      to="/workspaces/$workspaceId"
                      params={{ workspaceId }}
                      search={{ part: entry.partId }}
                      className="font-semibold hover:underline"
                    >
                      {entry.partName}
                    </Link>{" "}
                    at {entry.locationName}
                    {entry.note ? (
                      <span className="block text-xs text-muted-foreground">
                        {entry.note}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(entry.createdAt)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </ScrollArea>
  )
}
