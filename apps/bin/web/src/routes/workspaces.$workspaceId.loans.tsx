import { createFileRoute } from "@tanstack/react-router"
import type { Id } from "@v5x/backend/dataModel"
import { api } from "@v5x/backend/api"
import { ScrollArea } from "@v5x/ui/components/scroll-area"
import { Spinner } from "@v5x/ui/components/spinner"
import { useQuery } from "convex/react"
import { LoanRow } from "@/components/inventory/loan-row"
import { RequireSignIn } from "@/components/require-sign-in"

export const Route = createFileRoute("/workspaces/$workspaceId/loans")({
  component: () => (
    <RequireSignIn>
      <Loans />
    </RequireSignIn>
  ),
})

function Loans() {
  const { workspaceId: raw } = Route.useParams()
  const workspaceId = raw as Id<"workspaces">
  const data = useQuery(api.bin.inventory, { workspaceId })

  if (data === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-bold">Loans</h1>
        {data.loans.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing is out. Parts people borrow show up here until they are
            returned.
          </p>
        ) : (
          <ul>
            {data.loans.map((loan) => (
              <LoanRow
                key={loan._id}
                workspaceId={workspaceId}
                loan={loan}
                canReturn={
                  data.role === "admin" ||
                  loan.borrowerId === data.currentUserId
                }
              />
            ))}
          </ul>
        )}
      </div>
    </ScrollArea>
  )
}
