import { PlusIcon } from "@phosphor-icons/react"
import { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
import { Button } from "@v5x/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@v5x/ui/components/dialog"
import { Input } from "@v5x/ui/components/input"
import { Label } from "@v5x/ui/components/label"
import { ScrollArea } from "@v5x/ui/components/scroll-area"
import { useMutation, useQuery } from "convex/react"
import { useState, type FormEvent, type ReactNode } from "react"
import { FormError } from "@/components/form-error"
import { errorMessage, parseWhole } from "@/lib/format"

export function AddPartDialog({
  workspaceId,
  open,
  onOpenChange,
  addedSkus,
  onAdded,
}: {
  workspaceId: Id<"workspaces">
  open: boolean
  onOpenChange: (open: boolean) => void
  addedSkus: Set<string>
  onAdded: (partId: Id<"binParts">) => void
}) {
  const [mode, setMode] = useState<"catalog" | "custom">("catalog")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a part</DialogTitle>
          <DialogDescription>
            Pick a VEX part by name or SKU, or add one of your own.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={mode === "catalog" ? "secondary" : "ghost"}
            aria-pressed={mode === "catalog"}
            onClick={() => setMode("catalog")}
          >
            VEX catalog
          </Button>
          <Button
            size="sm"
            variant={mode === "custom" ? "secondary" : "ghost"}
            aria-pressed={mode === "custom"}
            onClick={() => setMode("custom")}
          >
            Custom part
          </Button>
        </div>
        {/* A fixed height: typing, loading, and switching tabs never resize the dialog. */}
        <div className="h-[22rem]">
          {mode === "catalog" ? (
            <CatalogSearch
              workspaceId={workspaceId}
              addedSkus={addedSkus}
              onAdded={onAdded}
            />
          ) : (
            <CustomPart
              workspaceId={workspaceId}
              onAdded={(id) => {
                onAdded(id)
                onOpenChange(false)
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Message({ children }: { children: ReactNode }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>
}

function CatalogSearch({
  workspaceId,
  addedSkus,
  onAdded,
}: {
  workspaceId: Id<"workspaces">
  addedSkus: Set<string>
  onAdded: (partId: Id<"binParts">) => void
}) {
  const [text, setText] = useState("")
  const query = text.trim()
  const results = useQuery(
    api.bin.catalogSearch,
    query.length >= 2 ? { query } : "skip"
  )
  const createPart = useMutation(api.bin.createPart)
  const [error, setError] = useState<string | null>(null)

  async function add(catalogPartId: Id<"binCatalogParts">) {
    setError(null)
    try {
      onAdded(await createPart({ workspaceId, catalogPartId }))
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <Input
        aria-label="Search the VEX catalog"
        placeholder="Name or SKU, for example 276-1926"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <div className="flex min-h-0 flex-1 flex-col rounded-lg border">
        {error ? (
          <p
            role="alert"
            className="shrink-0 border-b p-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        {query.length < 2 ? (
          <Message>Type at least two characters to search.</Message>
        ) : results === undefined ? (
          <Message>Searching…</Message>
        ) : results.length === 0 ? (
          <Message>
            No VEX parts match that. Try the SKU, or add a custom part.
          </Message>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <ul className="divide-y">
              {results.map((part) => {
                const added = addedSkus.has(part.sku)
                return (
                  <li
                    key={part._id}
                    className="flex items-center justify-between gap-3 p-2.5 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold">{part.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {part.sku}, {part.partType}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={added}
                      onClick={() => void add(part._id)}
                    >
                      {added ? "Added" : "Add"}
                    </Button>
                  </li>
                )
              })}
            </ul>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}

function CustomPart({
  workspaceId,
  onAdded,
}: {
  workspaceId: Id<"workspaces">
  onAdded: (partId: Id<"binParts">) => void
}) {
  const createPart = useMutation(api.bin.createPart)
  const [name, setName] = useState("")
  const [partType, setPartType] = useState("Other")
  const [minText, setMinText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const id = await createPart({
        workspaceId,
        name,
        partType,
        minQuantity: minText.trim() === "" ? undefined : parseWhole(minText),
      })
      onAdded(id)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex h-full flex-col gap-3">
      <Label htmlFor="custom-name">Name</Label>
      <Input
        id="custom-name"
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
        required
        autoFocus
      />
      <Label htmlFor="custom-type">Type</Label>
      <Input
        id="custom-type"
        value={partType}
        maxLength={40}
        onChange={(e) => setPartType(e.target.value)}
      />
      <Label htmlFor="custom-min">Warn me below (optional)</Label>
      <Input
        id="custom-min"
        inputMode="numeric"
        value={minText}
        onChange={(e) => setMinText(e.target.value)}
      />
      <div className="mt-auto flex items-center gap-3">
        <Button type="submit" disabled={busy || name.trim() === ""}>
          <PlusIcon data-icon="inline-start" />
          Add part
        </Button>
        <FormError message={error} />
      </div>
    </form>
  )
}
