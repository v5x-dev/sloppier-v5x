import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useAction } from "convex/react"
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
import { Field, FieldLabel } from "@v5x/ui/components/field"
import { Input } from "@v5x/ui/components/input"
import { errorMessage } from "@/lib/errors"

export function DuplicateProgramDialog({
  programId,
  programName,
  sha,
  open,
  onOpenChange,
}: {
  programId: Id<"programs">
  programName: string
  sha?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const duplicate = useAction(api.codeStorage.duplicateProgram)
  const navigate = useNavigate()
  const [name, setName] = useState(`${programName.slice(0, 75)} copy`)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const id = await duplicate({ programId, name, ...(sha ? { sha } : {}) })
      onOpenChange(false)
      await navigate({ to: "/programs/$programId", params: { programId: id } })
    } catch (err) {
      setError(errorMessage(err))
      setPending(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) onOpenChange(value)
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
            <DialogTitle>Duplicate program</DialogTitle>
            <DialogDescription>
              {sha
                ? `Create a new program from commit ${sha.slice(0, 7)}.`
                : "Create a new program from the latest source commit."}{" "}
              Uncommitted edits are not included. The copy stays in this
              workspace.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="duplicate-program-name">Name</FieldLabel>
            <Input
              id="duplicate-program-name"
              autoFocus
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={pending}
            />
          </Field>
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
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? "Creating…" : "Create program"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
