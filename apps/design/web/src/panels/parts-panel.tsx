// The Part catalog as a parts bin: grouped by family, searchable, one line per Part with
// its SKU. Picking a Part starts placing it. A Cut Part also takes a length first.

import { MagnifyingGlassIcon } from "@phosphor-icons/react"
import { catalog, partById } from "@/catalog/catalog"
import type { CutPart } from "@/catalog/types"
import { CATEGORY_LABELS, groupCatalog } from "@/design/catalog-view"
import { lengthFromInput, lengthUnit, stockLength } from "@/design/cut-length"
import { Button } from "@v5x/ui/components/button"
import { Input } from "@v5x/ui/components/input"
import { cn } from "@v5x/ui/lib/utils"

export type LengthDraft = { text: string }

export function defaultDraft(part: CutPart): LengthDraft {
  return { text: String(stockLength(part).value) }
}

type Props = {
  query: string
  onQuery: (query: string) => void
  pickedId: string | undefined
  onPick: (id: string | undefined) => void
  /** The length the team typed for the picked Cut Part. */
  draft: LengthDraft | undefined
  onDraft: (draft: LengthDraft) => void
}

export function PartsPanel({
  query,
  onQuery,
  pickedId,
  onPick,
  draft,
  onDraft,
}: Props) {
  const groups = groupCatalog(catalog.parts, query)
  const picked = pickedId ? partById(pickedId) : undefined
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search parts"
            placeholder="Search by name or SKU"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto"
        role="list"
        aria-label="Parts"
      >
        {groups.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">
            No Part matches “{query.trim()}”.
          </p>
        )}
        {groups.map((group, index) => (
          <section
            key={`${group.category}/${group.family}`}
            className="pb-2"
            aria-label={`${CATEGORY_LABELS[group.category]}: ${group.label}`}
          >
            {group.category !== groups[index - 1]?.category && (
              <h2 className="sticky top-0 z-20 border-b border-border bg-sidebar px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-foreground uppercase">
                {CATEGORY_LABELS[group.category]}
              </h2>
            )}
            <h3 className="sticky top-7 z-10 bg-sidebar px-3 pt-2 pb-1 text-sm font-medium text-muted-foreground">
              {group.label}
              <span className="ml-2 text-xs tabular-nums">
                {group.parts.length}
              </span>
            </h3>
            <ul>
              {group.parts.map((part) => {
                const active = part.id === pickedId
                return (
                  <li key={part.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => onPick(active ? undefined : part.id)}
                      className={cn(
                        "flex w-full items-baseline gap-3 px-3 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                        active &&
                          "bg-accent shadow-[inset_2px_0_0_var(--primary)]"
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {part.name}
                      </span>
                      {part.sku && (
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {part.sku.value}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      {picked && picked.kind === "cut" && draft && (
        <LengthControl part={picked} draft={draft} onDraft={onDraft} />
      )}
    </div>
  )
}

function LengthControl({
  part,
  draft,
  onDraft,
}: {
  part: CutPart
  draft: LengthDraft
  onDraft: (d: LengthDraft) => void
}) {
  const unit = lengthUnit(part)
  const stock = stockLength(part)
  const parsed = lengthFromInput(part, Number(draft.text))
  return (
    <div className="flex flex-col gap-2 border-t border-border p-3">
      <div className="flex items-center gap-2">
        <label htmlFor="cut-length" className="text-sm text-muted-foreground">
          Length
        </label>
        <Input
          id="cut-length"
          type="number"
          inputMode="decimal"
          step={unit === "holes" ? 1 : 0.1}
          value={draft.text}
          onChange={(event) => onDraft({ text: event.target.value })}
          aria-invalid={!parsed.ok}
          className="h-8 w-24 tabular-nums"
        />
        <span className="text-sm text-muted-foreground">{unit}</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => onDraft({ text: String(stock.value) })}
        >
          Stock {stock.value} {stock.unit}
        </Button>
      </div>
      {parsed.ok ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          = {parsed.lengthMm} mm
        </p>
      ) : (
        <p role="alert" className="text-xs text-destructive">
          {parsed.message}
        </p>
      )}
    </div>
  )
}
