import {
  DotsThreeIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { createFileRoute } from "@tanstack/react-router"
import { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@v5x/ui/components/alert-dialog"
import { Button } from "@v5x/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@v5x/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@v5x/ui/components/dropdown-menu"
import { Input } from "@v5x/ui/components/input"
import { Label } from "@v5x/ui/components/label"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@v5x/ui/components/popover"
import { ScrollArea } from "@v5x/ui/components/scroll-area"
import { Spinner } from "@v5x/ui/components/spinner"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { useState, type FormEvent } from "react"
import { FormError } from "@/components/form-error"
import { RequireSignIn } from "@/components/require-sign-in"
import { errorMessage } from "@/lib/format"

type Inventory = FunctionReturnType<typeof api.bin.inventory>

export const Route = createFileRoute("/workspaces/$workspaceId/locations")({
  component: () => (
    <RequireSignIn>
      <Locations />
    </RequireSignIn>
  ),
})

function Locations() {
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

  const isAdmin = data.role === "admin"
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Locations</h1>
          {isAdmin ? <NewLocation workspaceId={workspaceId} /> : null}
        </div>
        {data.locations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No locations yet.
            {isAdmin
              ? " Add the drawers, cabinets, and kits where parts live."
              : " An admin needs to add them."}
          </p>
        ) : (
          <ul>
            {data.locations.map((location) => (
              <LocationRow
                key={location._id}
                workspaceId={workspaceId}
                location={location}
                parts={data.parts}
                loans={data.loans}
                isAdmin={isAdmin}
              />
            ))}
          </ul>
        )}
      </div>
    </ScrollArea>
  )
}

function NewLocation({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="icon"
            variant="outline"
            aria-label="New location"
            title="New location"
          />
        }
      >
        <PlusIcon />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <NewLocationForm
          workspaceId={workspaceId}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

function NewLocationForm({
  workspaceId,
  onDone,
}: {
  workspaceId: Id<"workspaces">
  onDone: () => void
}) {
  const createLocation = useMutation(api.bin.createLocation)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createLocation({ workspaceId, name })
      onDone()
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <PopoverHeader>
        <PopoverTitle>New location</PopoverTitle>
        <PopoverDescription>
          A drawer, cabinet, or kit where parts are kept.
        </PopoverDescription>
      </PopoverHeader>
      <Label htmlFor="location-name" className="sr-only">
        Location name
      </Label>
      <Input
        id="location-name"
        placeholder="For example, Cabinet B, drawer 3"
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <div className="flex items-center gap-3">
        <FormError message={error} />
        <Button
          type="submit"
          className="ml-auto"
          disabled={busy || name.trim() === ""}
        >
          Add location
        </Button>
      </div>
    </form>
  )
}

function LocationRow({
  workspaceId,
  location,
  parts,
  loans,
  isAdmin,
}: {
  workspaceId: Id<"workspaces">
  location: Inventory["locations"][number]
  parts: Inventory["parts"]
  loans: Inventory["loans"]
  isAdmin: boolean
}) {
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null)
  const here = parts.filter((part) =>
    part.stock.some((row) => row.locationId === location._id)
  )
  const pieces = here.reduce(
    (sum, part) =>
      sum +
      part.stock
        .filter((row) => row.locationId === location._id)
        .reduce((inner, row) => inner + row.quantity, 0),
    0
  )
  const loansHere = loans.filter((loan) => loan.locationId === location._id)

  return (
    <li className="flex items-center gap-3 border-b py-3 last:border-b-0">
      <span className="min-w-0 truncate font-semibold">{location.name}</span>
      <span className="ml-auto shrink-0 text-sm text-muted-foreground">
        {here.length === 0
          ? "Empty"
          : `${here.length} ${here.length === 1 ? "part" : "parts"}, ${pieces} in total`}
      </span>
      {isAdmin ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Actions for ${location.name}`}
                />
              }
            >
              <DotsThreeIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setDialog("rename")}>
                  <PencilSimpleIcon />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDialog("delete")}
                >
                  <TrashIcon />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Dialog
            open={dialog === "rename"}
            onOpenChange={(open) => !open && setDialog(null)}
          >
            <DialogContent>
              <RenameForm
                workspaceId={workspaceId}
                location={location}
                onDone={() => setDialog(null)}
              />
            </DialogContent>
          </Dialog>

          <AlertDialog
            open={dialog === "delete"}
            onOpenChange={(open) => !open && setDialog(null)}
          >
            <AlertDialogContent>
              <DeleteBody
                workspaceId={workspaceId}
                location={location}
                pieces={pieces}
                loansHere={loansHere.length}
                onDone={() => setDialog(null)}
              />
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </li>
  )
}

function RenameForm({
  workspaceId,
  location,
  onDone,
}: {
  workspaceId: Id<"workspaces">
  location: Inventory["locations"][number]
  onDone: () => void
}) {
  const rename = useMutation(api.bin.renameLocation)
  const [name, setName] = useState(location.name)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await rename({ workspaceId, locationId: location._id, name })
      onDone()
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Rename location</DialogTitle>
        <DialogDescription>
          Parts and history stay with it. Only the name changes.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <Label htmlFor="rename-location">Name</Label>
        <Input
          id="rename-location"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.target.select()}
          autoFocus
        />
      </div>
      <DialogFooter className="items-center">
        <FormError message={error} />
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={busy || name.trim() === "" || name.trim() === location.name}
        >
          Save name
        </Button>
      </DialogFooter>
    </form>
  )
}

function DeleteBody({
  workspaceId,
  location,
  pieces,
  loansHere,
  onDone,
}: {
  workspaceId: Id<"workspaces">
  location: Inventory["locations"][number]
  pieces: number
  loansHere: number
  onDone: () => void
}) {
  const remove = useMutation(api.bin.deleteLocation)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const blocker =
    pieces > 0
      ? `${location.name} still holds ${pieces} ${pieces === 1 ? "piece" : "pieces"}. Set those counts to 0 before deleting it.`
      : loansHere > 0
        ? `${loansHere} ${loansHere === 1 ? "loan is" : "loans are"} still out from ${location.name}. Parts return to the place they came from, so wait until they are back.`
        : null

  async function onDelete() {
    setBusy(true)
    setError(null)
    try {
      await remove({ workspaceId, locationId: location._id })
      onDone()
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {blocker
            ? `Can't delete ${location.name} yet`
            : `Delete ${location.name}?`}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {error ??
            blocker ??
            "Nothing is stored here. Past changes at this location stay in History."}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <Button
          variant="destructive"
          disabled={busy || blocker !== null}
          onClick={() => void onDelete()}
        >
          Delete location
        </Button>
      </AlertDialogFooter>
    </>
  )
}
