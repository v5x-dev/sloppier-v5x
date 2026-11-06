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
import type { Id } from "@v5x/backend/dataModel"
import { api } from "@v5x/backend/api"
import { useMutation } from "convex/react"
import { useState, type FormEvent } from "react"
import { FormError } from "@/components/form-error"
import { errorMessage } from "@/lib/format"

export function NewWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: Id<"workspaces">) => void
}) {
  const createWorkspace = useMutation(api.workspaces.create)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const id = await createWorkspace({ name })
      setName("")
      onOpenChange(false)
      onCreated(id)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>
              A workspace holds one team&apos;s parts, locations, and loans.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="workspace-name">Name</Label>
            <Input
              id="workspace-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <DialogFooter className="items-center">
            <FormError message={error} />
            <Button type="submit" disabled={busy || name.trim() === ""}>
              Create workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
