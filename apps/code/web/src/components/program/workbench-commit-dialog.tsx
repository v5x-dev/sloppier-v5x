import { Button } from "@v5x/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@v5x/ui/components/dialog"
import { Field, FieldLabel } from "@v5x/ui/components/field"
import { Input } from "@v5x/ui/components/input"
import { Spinner } from "@v5x/ui/components/spinner"
import { toast } from "@v5x/ui/components/toast"

import { errorMessage } from "@/lib/errors"
import { useState } from "react"

export function CommitDialog({
  open,
  onOpenChange,
  paths,
  onCommit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  paths: string[]
  onCommit: (message: string) => Promise<void>
}) {
  const [message, setMessage] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    try {
      await onCommit(message.trim())
      setMessage("")
      onOpenChange(false)
      toast.add({ type: "success", title: "Changes committed" })
    } catch (error) {
      toast.add({
        type: "error",
        title: "Could not commit",
        description: errorMessage(error),
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>Commit changes</DialogTitle>
            <DialogDescription>
              Saves to the program&apos;s <code>main</code> branch.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex max-h-40 flex-col gap-1 overflow-auto text-xs text-muted-foreground">
            {paths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
          <Field>
            <FieldLabel htmlFor="commit-message">Message</FieldLabel>
            <Input
              id="commit-message"
              required
              maxLength={200}
              value={message}
              placeholder="Tune autonomous turn speed"
              onChange={(event) => setMessage(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending || !message.trim()}>
              {pending && <Spinner data-icon="inline-start" />}
              Commit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
