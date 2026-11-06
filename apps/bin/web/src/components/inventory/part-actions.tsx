import { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
import { Button } from "@v5x/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@v5x/ui/components/dialog"
import { Input } from "@v5x/ui/components/input"
import { Label } from "@v5x/ui/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@v5x/ui/components/native-select"
import { useNavigate } from "@tanstack/react-router"
import { useMutation } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { useState, type FormEvent, type ReactNode } from "react"
import { FormError } from "@/components/form-error"
import { Stepper } from "@/components/inventory/stepper"
import { errorMessage, parseWhole } from "@/lib/format"

type Detail = FunctionReturnType<typeof api.bin.partDetail>
type Dialogs = "borrow" | "stock" | "level" | "delete" | null

// Everything you can do to a part is one button here and one small dialog, so
// the page itself stays a calm summary.
export function PartActions({
  workspaceId,
  partId,
  partName,
  isAdmin,
  stock,
  locations,
  minQuantity,
}: {
  workspaceId: Id<"workspaces">
  partId: Id<"binParts">
  partName: string
  isAdmin: boolean
  stock: Detail["stock"]
  locations: Detail["locations"]
  minQuantity: number | null
}) {
  const [open, setOpen] = useState<Dialogs>(null)
  const close = () => setOpen(null)
  const navigate = useNavigate()
  const onHand = stock.reduce((sum, row) => sum + row.quantity, 0)

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => setOpen("borrow")}
          disabled={onHand === 0}
          title={onHand === 0 ? "Nothing is on hand to borrow" : undefined}
        >
          Borrow
        </Button>
        {isAdmin ? (
          <>
            <Button variant="outline" onClick={() => setOpen("stock")}>
              Change stock
            </Button>
            <Button variant="ghost" onClick={() => setOpen("level")}>
              Low-stock level
            </Button>
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => setOpen("delete")}
            >
              Delete part
            </Button>
          </>
        ) : null}
      </div>

      <Dialog
        open={open === "borrow"}
        onOpenChange={(next) => !next && close()}
      >
        <DialogContent>
          <BorrowForm
            workspaceId={workspaceId}
            partId={partId}
            partName={partName}
            stock={stock}
            onDone={close}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={open === "stock"} onOpenChange={(next) => !next && close()}>
        <DialogContent>
          <StockForm
            workspaceId={workspaceId}
            partId={partId}
            partName={partName}
            locations={locations}
            stock={stock}
            onDone={close}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={open === "delete"}
        onOpenChange={(next) => !next && close()}
      >
        <DialogContent>
          <DeleteForm
            workspaceId={workspaceId}
            partId={partId}
            partName={partName}
            onDone={() => {
              close()
              void navigate({
                to: "/workspaces/$workspaceId",
                params: { workspaceId },
              })
            }}
            onCancel={close}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={open === "level"} onOpenChange={(next) => !next && close()}>
        <DialogContent>
          <LevelForm
            workspaceId={workspaceId}
            partId={partId}
            minQuantity={minQuantity}
            onDone={close}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col items-start gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

// Cancel and the main action share a row with the error, which reads best next
// to the button that caused it and never moves the fields above.
function Footer({
  error,
  onCancel,
  disabled,
  children,
}: {
  error: string | null
  onCancel: () => void
  disabled: boolean
  children: ReactNode
}) {
  return (
    <DialogFooter className="items-center">
      <FormError message={error} />
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={disabled}>
        {children}
      </Button>
    </DialogFooter>
  )
}

function BorrowForm({
  workspaceId,
  partId,
  partName,
  stock,
  onDone,
}: {
  workspaceId: Id<"workspaces">
  partId: Id<"binParts">
  partName: string
  stock: Detail["stock"]
  onDone: () => void
}) {
  const borrow = useMutation(api.bin.borrow)
  const [locationId, setLocationId] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selected =
    stock.find((row) => row.locationId === locationId) ?? stock.at(0)
  const count = Math.min(quantity, selected?.quantity ?? 1)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      await borrow({
        workspaceId,
        partId,
        locationId: selected.locationId,
        quantity: count,
      })
      onDone()
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Borrow {partName}</DialogTitle>
        <DialogDescription>
          Take what you need now. You can return it from the Loans page.
        </DialogDescription>
      </DialogHeader>
      <Field label="Take from" htmlFor="borrow-location">
        <NativeSelect
          id="borrow-location"
          className="w-full"
          value={selected?.locationId ?? ""}
          onChange={(e) => setLocationId(e.target.value)}
        >
          {stock.map((row) => (
            <NativeSelectOption key={row.locationId} value={row.locationId}>
              {row.locationName}, {row.quantity} on hand
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field label="How many">
        <Stepper
          label="Quantity to borrow"
          value={count}
          max={selected?.quantity}
          onChange={setQuantity}
        />
      </Field>
      <Footer error={error} onCancel={onDone} disabled={busy || !selected}>
        Borrow {count}
      </Footer>
    </form>
  )
}

type StockMode = "set" | "add" | "remove"

function StockForm({
  workspaceId,
  partId,
  partName,
  locations,
  stock,
  onDone,
}: {
  workspaceId: Id<"workspaces">
  partId: Id<"binParts">
  partName: string
  locations: Detail["locations"]
  stock: Detail["stock"]
  onDone: () => void
}) {
  const adjust = useMutation(api.bin.adjustStock)
  const setStock = useMutation(api.bin.setStock)
  const createLocation = useMutation(api.bin.createLocation)
  const [mode, setMode] = useState<StockMode>("set")
  const [locationId, setLocationId] = useState("")
  // null means the default for this mode and location: the current count when
  // setting, 1 when adding or removing.
  const [typed, setTyped] = useState<number | null>(null)
  const [note, setNote] = useState("")
  const [locationName, setLocationName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const location =
    locations.find((l) => l._id === locationId) ?? locations.at(0)
  const current = location
    ? (stock.find((row) => row.locationId === location._id)?.quantity ?? 0)
    : 0
  const max = mode === "remove" ? Math.max(current, 1) : undefined
  const quantity = Math.min(
    typed ?? (mode === "set" ? current : 1),
    max ?? Infinity
  )
  const blocked =
    (mode === "set" && quantity === current) ||
    (mode === "remove" && current === 0)
  const action =
    mode === "set"
      ? `Set count to ${quantity}`
      : mode === "add"
        ? `Add ${quantity}`
        : `Remove ${quantity}`

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!location) return
    setBusy(true)
    setError(null)
    try {
      const reason = note.trim() === "" ? undefined : note
      if (mode === "set") {
        await setStock({
          workspaceId,
          partId,
          locationId: location._id,
          quantity,
          note: reason,
        })
      } else {
        await adjust({
          workspaceId,
          partId,
          locationId: location._id,
          delta: mode === "add" ? quantity : -quantity,
          note: reason,
        })
      }
      onDone()
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  async function onAddLocation(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createLocation({ workspaceId, name: locationName })
      setLocationName("")
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  if (location === undefined) {
    return (
      <form onSubmit={onAddLocation} className="flex flex-col gap-5">
        <DialogHeader>
          <DialogTitle>Where is {partName} kept?</DialogTitle>
          <DialogDescription>
            Add its first location, for example Cabinet A, drawer 2. Then you
            can count what is there.
          </DialogDescription>
        </DialogHeader>
        <Field label="Location name" htmlFor="first-location">
          <Input
            id="first-location"
            maxLength={80}
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            autoFocus
          />
        </Field>
        <Footer
          error={error}
          onCancel={onDone}
          disabled={busy || locationName.trim() === ""}
        >
          Add location
        </Footer>
      </form>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Change stock</DialogTitle>
        <DialogDescription>
          {partName}. {current} {current === 1 ? "piece is" : "pieces are"} in{" "}
          {location.name} now.
        </DialogDescription>
      </DialogHeader>
      <div
        role="group"
        aria-label="How to change it"
        className="inline-flex w-fit rounded-lg border border-input p-0.5"
      >
        {(
          [
            ["set", "Set count"],
            ["add", "Add"],
            ["remove", "Remove"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={mode === value ? "secondary" : "ghost"}
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value)
              setTyped(null)
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <Field label="Location" htmlFor="stock-location">
          <NativeSelect
            id="stock-location"
            className="w-full"
            value={location._id}
            onChange={(e) => {
              setLocationId(e.target.value)
              setTyped(null)
            }}
          >
            {locations.map((entry) => (
              <NativeSelectOption key={entry._id} value={entry._id}>
                {entry.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field label={mode === "set" ? "Counted" : "How many"}>
          <Stepper
            label="Quantity"
            value={quantity}
            min={mode === "set" ? 0 : 1}
            max={max}
            onChange={setTyped}
          />
        </Field>
      </div>
      <Field label="Note (optional)" htmlFor="stock-note">
        <Input
          id="stock-note"
          placeholder="Why is it changing?"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <Footer error={error} onCancel={onDone} disabled={busy || blocked}>
        {action}
      </Footer>
    </form>
  )
}

function LevelForm({
  workspaceId,
  partId,
  minQuantity,
  onDone,
}: {
  workspaceId: Id<"workspaces">
  partId: Id<"binParts">
  minQuantity: number | null
  onDone: () => void
}) {
  const setMin = useMutation(api.bin.setMinQuantity)
  const [text, setText] = useState(
    minQuantity === null ? "" : String(minQuantity)
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await setMin({
        workspaceId,
        partId,
        minQuantity: text.trim() === "" ? null : parseWhole(text),
      })
      onDone()
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Low-stock level</DialogTitle>
        <DialogDescription>
          Bin flags this part when the total drops below this number. Leave it
          empty to turn the warning off.
        </DialogDescription>
      </DialogHeader>
      <Field label="Warn me below" htmlFor="min-quantity">
        <Input
          id="min-quantity"
          inputMode="numeric"
          className="w-28"
          placeholder="Off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
      </Field>
      <Footer error={error} onCancel={onDone} disabled={busy}>
        Save level
      </Footer>
    </form>
  )
}

function DeleteForm({
  workspaceId,
  partId,
  partName,
  onDone,
  onCancel,
}: {
  workspaceId: Id<"workspaces">
  partId: Id<"binParts">
  partName: string
  onDone: () => void
  onCancel: () => void
}) {
  const remove = useMutation(api.bin.deletePart)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onDelete() {
    setBusy(true)
    setError(null)
    try {
      await remove({ workspaceId, partId })
      onDone()
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Delete {partName}?</DialogTitle>
        <DialogDescription>
          The part leaves this workspace. Its history stays, marked as a deleted
          part. The VEX catalog keeps the part, so you can add it again later.
          You can only delete a part with nothing on hand and nothing on loan.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="items-center">
        <FormError message={error} />
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={busy}
          onClick={() => void onDelete()}
        >
          Delete part
        </Button>
      </DialogFooter>
    </div>
  )
}
