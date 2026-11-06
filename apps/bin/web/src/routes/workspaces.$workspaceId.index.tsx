import { PackageIcon } from "@phosphor-icons/react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import type { Id } from "@v5x/backend/dataModel"
import { api } from "@v5x/backend/api"
import { Button } from "@v5x/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@v5x/ui/components/empty"
import { ScrollArea } from "@v5x/ui/components/scroll-area"
import { Spinner } from "@v5x/ui/components/spinner"
import { cn } from "@v5x/ui/lib/utils"
import { useQuery } from "convex/react"
import { useState } from "react"
import { AddPartDialog } from "@/components/inventory/add-part-dialog"
import { PartDetail } from "@/components/inventory/part-detail"
import { PartList } from "@/components/inventory/part-list"
import { RequireSignIn } from "@/components/require-sign-in"

// The inventory is a master-detail screen: the list stays put and the part
// chosen in it fills the pane beside it. The choice lives in the URL (`?part=`).
export const Route = createFileRoute("/workspaces/$workspaceId/")({
  validateSearch: (search): { part?: string } =>
    typeof search.part === "string" ? { part: search.part } : {},
  component: InventoryPage,
})

function InventoryPage() {
  return (
    <RequireSignIn>
      <Inventory />
    </RequireSignIn>
  )
}

function Inventory() {
  const { workspaceId: raw } = Route.useParams()
  const workspaceId = raw as Id<"workspaces">
  const { part } = Route.useSearch()
  const navigate = useNavigate()
  const data = useQuery(api.bin.inventory, { workspaceId })
  const [adding, setAdding] = useState(false)

  if (data === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  const isAdmin = data.role === "admin"
  const selected = data.parts.find((p) => p._id === part)
  const addedSkus = new Set(
    data.parts.flatMap((p) => (p.sku === null ? [] : [p.sku]))
  )

  return (
    <div className="grid h-full grid-rows-[minmax(0,1fr)] md:grid-cols-[minmax(15rem,19rem)_1fr]">
      <PartList
        workspaceId={workspaceId}
        parts={data.parts}
        selectedId={selected?._id}
        isAdmin={isAdmin}
        onAdd={() => setAdding(true)}
        className={selected ? "hidden md:flex" : "flex"}
      />
      <ScrollArea
        aria-label="Part"
        className={cn("min-h-0", selected ? "block" : "hidden md:block")}
      >
        {selected ? (
          <PartDetail
            key={selected._id}
            workspaceId={workspaceId}
            partId={selected._id}
          />
        ) : (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PackageIcon />
              </EmptyMedia>
              <EmptyTitle>
                {data.parts.length === 0 ? "No parts yet" : "Pick a part"}
              </EmptyTitle>
              <EmptyDescription>
                {data.parts.length === 0
                  ? isAdmin
                    ? "Add parts from the VEX catalog to start counting what is in your shop."
                    : "An admin needs to add parts before anything can be borrowed."
                  : "Choose a part on the left to see where it is and borrow it."}
              </EmptyDescription>
            </EmptyHeader>
            {data.parts.length === 0 && isAdmin ? (
              <EmptyContent>
                <Button onClick={() => setAdding(true)}>Add a part</Button>
              </EmptyContent>
            ) : null}
          </Empty>
        )}
      </ScrollArea>
      {isAdmin ? (
        <AddPartDialog
          workspaceId={workspaceId}
          open={adding}
          onOpenChange={setAdding}
          addedSkus={addedSkus}
          onAdded={(id) => {
            void navigate({
              to: "/workspaces/$workspaceId",
              params: { workspaceId },
              search: { part: id },
            })
          }}
        />
      ) : null}
    </div>
  )
}
