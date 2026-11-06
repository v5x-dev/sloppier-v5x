import {
  ArchiveBoxIcon,
  CopyIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { Link, useNavigate } from "@tanstack/react-router"
import { api } from "@v5x/backend/api"
import type { Doc } from "@v5x/backend/dataModel"
import { errorMessage } from "@v5x/backend/errors"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@v5x/ui/components/alert-dialog"
import { Button } from "@v5x/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@v5x/ui/components/dropdown-menu"
import { toast } from "@v5x/ui/components/toast"
import { useMutation } from "convex/react"
import { formatDistanceToNow } from "date-fns"
import { useState } from "react"
import { NameDialog } from "@/components/name-dialog"

export function DesignRow({ design }: { design: Doc<"designs"> }) {
  const navigate = useNavigate()
  const rename = useMutation(api.designs.rename)
  const duplicate = useMutation(api.designs.duplicate)
  const setArchived = useMutation(api.designs.setArchived)
  const remove = useMutation(api.designs.remove)
  const [dialog, setDialog] = useState<"rename" | "duplicate" | "delete">()
  const designId = design._id
  const archived = Boolean(design.archivedAt)

  function report(title: string) {
    return (error: unknown) =>
      toast.add({ type: "error", title, description: errorMessage(error) })
  }

  return (
    <li className="flex items-center gap-2 border-b border-border py-1 last:border-b-0">
      <Link
        to="/designs/$designId"
        params={{ designId }}
        className="flex min-w-0 flex-1 items-baseline justify-between gap-4 rounded-md px-3 py-2.5 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="truncate">{design.name}</span>
        <span className="shrink-0 text-sm text-muted-foreground">
          {design.copyingFrom
            ? "Copying…"
            : formatDistanceToNow(design.lastActivityAt ?? design.createdAt, {
                addSuffix: true,
              })}
        </span>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${design.name}`}
            />
          }
        >
          <DotsThreeIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => setDialog("rename")}>
            <PencilSimpleIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("duplicate")}>
            <CopyIcon />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setArchived({ designId, archived: !archived }).catch(
                report(
                  archived
                    ? "Could not restore this Design"
                    : "Could not archive this Design"
                )
              )
            }}
          >
            <ArchiveBoxIcon />
            {archived ? "Restore" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDialog("delete")}
          >
            <TrashIcon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === "rename" && (
        <NameDialog
          title="Rename Design"
          action="Rename"
          initialName={design.name}
          onSubmit={(name) => rename({ designId, name })}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog === "duplicate" && (
        <NameDialog
          title="Duplicate Design"
          action="Duplicate"
          initialName={`${design.name} copy`.slice(0, 80)}
          onSubmit={async (name) => {
            const copyId = await duplicate({ designId, name })
            await navigate({
              to: "/designs/$designId",
              params: { designId: copyId },
            })
          }}
          onClose={() => setDialog(undefined)}
        />
      )}
      <AlertDialog
        open={dialog === "delete"}
        onOpenChange={(open) => {
          if (!open) setDialog(undefined)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {design.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the Design for everyone in the workspace.
              It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setDialog(undefined)
                remove({ designId }).catch(
                  report("Could not delete this Design")
                )
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}
