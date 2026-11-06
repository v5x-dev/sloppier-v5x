import { Button } from "@v5x/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@v5x/ui/components/dialog"
import type { BuildSummary } from "@/design/build-file"

const MAX_LISTED = 20

/**
 * Shows what a Protobot file will import before anything is created: how many parts come in,
 * each group that does not, and why. The user chooses whether to import what can be imported.
 */
export function BuildImportDialog({
  fileName,
  summary,
  unverified,
  onImport,
  onClose,
}: {
  fileName: string
  summary: BuildSummary
  unverified: boolean
  onImport: () => void
  onClose: () => void
}) {
  const { importable, total, skipped, rejected } = summary
  const label = importable === 1 ? "part" : "parts"
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[85svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Protobot robot</DialogTitle>
          <DialogDescription>
            {fileName}: {importable} of {total} parts can be imported.
          </DialogDescription>
        </DialogHeader>

        {unverified && (
          <p
            role="note"
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            Unverified. The mapping from Protobot parts to Catalog Parts has not
            been checked against a real saved file. Check the imported robot
            before you rely on it.
          </p>
        )}

        {skipped.length > 0 && (
          <section className="flex flex-col gap-1 text-sm">
            <h3 className="font-medium">Not imported</h3>
            <ul className="list-disc pl-5">
              {skipped.slice(0, MAX_LISTED).map((group) => (
                <li key={`${group.partId}|${group.reason}`}>
                  {group.count} × part “{group.partId}”: {group.reason}
                </li>
              ))}
            </ul>
            {skipped.length > MAX_LISTED && (
              <p className="text-muted-foreground">
                and {skipped.length - MAX_LISTED} more kinds of part
              </p>
            )}
          </section>
        )}

        {rejected.length > 0 && (
          <section className="flex flex-col gap-1 text-sm">
            <h3 className="font-medium">Could not be read</h3>
            <ul className="list-disc pl-5">
              {rejected.slice(0, MAX_LISTED).map((entry) => (
                <li key={entry.number}>
                  Part {entry.number}
                  {entry.partId ? ` (${entry.partId})` : ""}: {entry.reason}
                </li>
              ))}
            </ul>
            {rejected.length > MAX_LISTED && (
              <p className="text-muted-foreground">
                and {rejected.length - MAX_LISTED} more
              </p>
            )}
          </section>
        )}

        <p className="text-sm text-muted-foreground">
          Connections are made only where a screw or shaft lines up with a hole.
          The camera view and file times are not imported.
        </p>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={onImport}>
            Import {importable} {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
