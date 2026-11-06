import { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
import { Avatar, AvatarFallback } from "@v5x/ui/components/avatar"
import { Button } from "@v5x/ui/components/button"
import { useMutation } from "convex/react"
import { useState } from "react"
import { daysAgo, errorMessage, initials } from "@/lib/format"

export function LoanRow({
  workspaceId,
  loan,
  canReturn,
}: {
  workspaceId: Id<"workspaces">
  loan: {
    _id: Id<"binLoans">
    quantity: number
    borrowerName: string
    locationName: string
    borrowedAt: number
    partName?: string
  }
  canReturn: boolean
}) {
  const returnLoan = useMutation(api.bin.returnLoan)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onReturn() {
    setBusy(true)
    setError(null)
    try {
      await returnLoan({ workspaceId, loanId: loan._id })
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-col gap-1 border-b py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        <Avatar className="size-7">
          <AvatarFallback className="text-[0.65rem]">
            {initials(loan.borrowerName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">
            {loan.borrowerName} has {loan.quantity}
            {loan.partName ? ` × ${loan.partName}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            From {loan.locationName}, {daysAgo(loan.borrowedAt)}
          </p>
        </div>
        {canReturn ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onReturn}
            disabled={busy}
          >
            Return
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  )
}
