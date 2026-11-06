// The parts list, on screen, with the same numbers the CSV holds.

import { DownloadSimpleIcon } from "@phosphor-icons/react"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@v5x/ui/components/table"
import { useMemo, useState } from "react"
import { downloadText, safeFileName } from "@/lib/download"
import {
  buildPartsList,
  formatMass,
  formatMm,
  partsListCsv,
} from "@/design/parts-list"
import type { PlacedPart } from "@/design/model"

export function PartsListDialog({
  open,
  onOpenChange,
  parts,
  designName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  parts: PlacedPart[]
  designName: string
}) {
  const list = useMemo(() => buildPartsList(parts), [parts])
  const { totals, rows } = list
  const [error, setError] = useState<string>()

  const download = () => {
    try {
      downloadText(
        `${safeFileName(designName)}-parts.csv`,
        partsListCsv(list),
        "text/csv;charset=utf-8"
      )
      setError(undefined)
    } catch {
      setError("This browser could not start the download.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Parts list</DialogTitle>
          <DialogDescription>
            Cut lengths are the total to cut for each length. They do not say
            how many full sticks to buy.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This Design has no Parts yet.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label="Parts" value={String(totals.partCount)} />
              <Stat
                label="Cut length to cut"
                value={
                  totals.cutLengthMm > 0 ? formatMm(totals.cutLengthMm) : "None"
                }
              />
              <Stat
                label="Estimated weight"
                value={formatMass(totals.estimatedMassG)}
                note="estimate"
              />
              <Stat
                label="Left out of the weight"
                value={String(totals.unknownMassParts)}
                note={
                  totals.unknownMassParts === 1
                    ? "part has no mass"
                    : "parts have no mass"
                }
              />
            </dl>
            {totals.unknownMassParts > 0 && (
              <p className="text-sm text-muted-foreground">
                The weight counts only Parts with a known mass. The catalog has
                no mass for{" "}
                {totals.unknownMassParts === 1
                  ? "one Part"
                  : `${totals.unknownMassParts} Parts`}{" "}
                yet, so the total leaves{" "}
                {totals.unknownMassParts === 1 ? "it" : "them"} out rather than
                counting {totals.unknownMassParts === 1 ? "it" : "them"} as
                zero.
              </p>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Part</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Each</TableHead>
                  <TableHead className="text-right">Total to cut</TableHead>
                  <TableHead className="text-right">Weight (est.)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      <span className="block">{row.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {row.sku || row.familyLabel}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.quantity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.lengthMm === undefined
                        ? "—"
                        : row.lengthHoles !== undefined
                          ? `${row.lengthHoles} holes (${formatMm(row.lengthMm)})`
                          : formatMm(row.lengthMm)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.totalLengthMm === undefined
                        ? "—"
                        : formatMm(row.totalLengthMm)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.totalMassG === null ? (
                        <span className="text-muted-foreground">unknown</span>
                      ) : (
                        formatMass(row.totalMassG)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={rows.length === 0}
            onClick={download}
          >
            <DownloadSimpleIcon data-icon="inline-start" />
            Download CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Stat({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note?: string
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-medium tabular-nums">
        {value}
        {note && (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {note}
          </span>
        )}
      </dd>
    </div>
  )
}
