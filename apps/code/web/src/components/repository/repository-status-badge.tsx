import type { Doc } from "@v5x/backend/dataModel"
import { Badge } from "@v5x/ui/components/badge"
import { Spinner } from "@v5x/ui/components/spinner"

export function RepositoryStatusBadge({
  status,
}: {
  status: Doc<"programs">["repositoryStatus"]
}) {
  if (status === "ready") return null
  if (status === "failed") {
    return <Badge variant="destructive">Setup failed</Badge>
  }
  return (
    <Badge variant="secondary">
      <Spinner data-icon="inline-start" />
      Setting up
    </Badge>
  )
}
