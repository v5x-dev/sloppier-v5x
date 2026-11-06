import { errorMessage } from "@v5x/backend/errors"
import { Button } from "@v5x/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@v5x/ui/components/dialog"
import { Input } from "@v5x/ui/components/input"
import { useState } from "react"

/** Asks for a Design's name, for creating, renaming, or duplicating one. */
export function NameDialog({
  title,
  action,
  initialName,
  onSubmit,
  onClose,
}: {
  title: string
  action: string
  initialName: string
  onSubmit: (name: string) => Promise<unknown>
  onClose: () => void
}) {
  const [name, setName] = useState(initialName)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function submit() {
    setPending(true)
    setError(undefined)
    try {
      await onSubmit(name)
      onClose()
    } catch (caught) {
      setError(errorMessage(caught))
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Input
            aria-label="Name"
            autoFocus
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
