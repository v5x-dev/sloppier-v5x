import type { Doc } from "@workspace/backend/dataModel"
import { Badge } from "@workspace/ui/components/badge"
import { Spinner } from "@workspace/ui/components/spinner"

export function RepositoryStatusBadge({
  status,
}: {
  status: Doc<"projects">["repositoryStatus"]
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
