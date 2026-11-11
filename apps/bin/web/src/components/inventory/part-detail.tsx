import { ArrowLeftIcon } from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
import {
  defaultCChannel,
  displayName,
  encodeCChannel,
} from "@v5x/backend/cChannel"
import { cn } from "@v5x/ui/lib/utils"
import { useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { useState, type ReactNode } from "react"
import { CChannelPicker } from "@/components/inventory/c-channel-picker"
import { LoanRow } from "@/components/inventory/loan-row"
import { PartActions } from "@/components/inventory/part-actions"
import { ScrewSwatch } from "@/components/inventory/screw-swatch"
import { PartViewer } from "@/components/inventory/part-viewer"
import { formatDate } from "@/lib/format"

type Detail = FunctionReturnType<typeof api.bin.partDetail>
type Borrower = { id: string; name: string; quantity: number }

const segmentColors = [
  "bg-chart-2",
  "bg-chart-1",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
]

// Stock on a shelf is solid. Stock out on loan is striped, one segment per
// person, so the bar always adds up to every piece of this part.
const stripeTones = [
  "color-mix(in oklab, var(--foreground) 90%, transparent)",
  "color-mix(in oklab, var(--foreground) 60%, transparent)",
  "color-mix(in oklab, var(--foreground) 38%, transparent)",
]
const stripes = (index: number) => ({
  backgroundImage: `repeating-linear-gradient(135deg, ${stripeTones[index % stripeTones.length]} 0 2px, transparent 2px 5px)`,
})

function StockBar({
  stock,
  borrowers,
}: {
  stock: Detail["stock"]
  borrowers: Borrower[]
}) {
  const total =
    stock.reduce((sum, row) => sum + row.quantity, 0) +
    borrowers.reduce((sum, person) => sum + person.quantity, 0)
  if (total === 0) return null
  const share = (quantity: number) => `${(quantity / total) * 100}%`

  return (
    <>
      <div className="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted">
        {stock.map((row, index) => (
          <div
            key={row.locationId}
            title={`${row.locationName}: ${row.quantity} on hand`}
            className={segmentColors[index % segmentColors.length]}
            style={{ width: share(row.quantity) }}
          />
        ))}
        {borrowers.map((person, index) => (
          <div
            key={person.id}
            title={`${person.name} has ${person.quantity}`}
            style={{ width: share(person.quantity), ...stripes(index) }}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {stock.map((row, index) => (
          <li key={row.locationId} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn(
                "h-2.5 w-4 rounded-[3px]",
                segmentColors[index % segmentColors.length]
              )}
            />
            {row.locationName}
            <b className="tabular-nums">{row.quantity}</b>
          </li>
        ))}
        {borrowers.map((person, index) => (
          <li key={person.id} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2.5 w-4 rounded-[3px] ring-1 ring-border"
              style={stripes(index)}
            />
            {person.name}
            <b className="tabular-nums">{person.quantity}</b>
            <span className="text-muted-foreground">out</span>
          </li>
        ))}
      </ul>
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-bold">{title}</h3>
      {children}
    </section>
  )
}

export function PartDetail({
  workspaceId,
  partId,
}: {
  workspaceId: Id<"workspaces">
  partId: Id<"binParts">
}) {
  // The size a C-Channel shows. Other parts ignore it.
  const [size, setSize] = useState(encodeCChannel(defaultCChannel))
  const data = useQuery(api.bin.partDetail, {
    workspaceId,
    partId,
    variant: size,
  })

  if (data === undefined) {
    return <p className="p-6 text-sm text-muted-foreground">Loading part…</p>
  }

  const isAdmin = data.role === "admin"
  const variant = data.variant ?? undefined
  const onHand = data.stock.reduce((sum, row) => sum + row.quantity, 0)
  // One entry per person, even if they borrowed in several goes.
  const borrowers = [
    ...data.loans
      .reduce((people, loan) => {
        const person = people.get(loan.borrowerId)
        people.set(loan.borrowerId, {
          id: loan.borrowerId,
          name: loan.borrowerName,
          quantity: (person?.quantity ?? 0) + loan.quantity,
        })
        return people
      }, new Map<string, Borrower>())
      .values(),
  ]
  const outOnLoan = borrowers.reduce((sum, person) => sum + person.quantity, 0)
  // A C-Channel's low-stock level covers every size together.
  const countedOnHand = data.part.options ? data.totalOnHand : onHand
  const low =
    data.part.minQuantity !== null && countedOnHand < data.part.minQuantity

  return (
    <article className="@container flex flex-col gap-4 p-6">
      <Link
        to="/workspaces/$workspaceId"
        params={{ workspaceId }}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline md:hidden"
      >
        <ArrowLeftIcon /> All parts
      </Link>
      <div className="grid gap-8 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
        <aside className="@3xl:sticky @3xl:top-6 @3xl:col-start-2 @3xl:row-start-1 @3xl:self-start">
          {/* Keyed by model, so a new size never keeps the last size's model. */}
          <PartViewer
            key={data.modelSku ?? "none"}
            sku={data.modelSku}
            name={displayName(data.part.name, variant)}
          />
        </aside>
        <div className="flex max-w-2xl min-w-0 flex-col gap-8 @3xl:col-start-1 @3xl:row-start-1">
          <header className="flex flex-col gap-1">
            <h2 className="text-2xl leading-tight font-bold">
              {data.part.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {data.part.sku && !data.part.options ? `${data.part.sku}, ` : ""}
              {data.part.partType}
            </p>
            {data.part.options ? (
              <div className="mt-3">
                <CChannelPicker value={size} onChange={setSize} />
              </div>
            ) : null}
            {data.part.screwColor ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <ScrewSwatch color={data.part.screwColor} className="size-3" />
                <span className="capitalize">{data.part.screwColor.name}</span>
                {data.part.screwColor.length} long
              </p>
            ) : null}
          </header>

          <div>
            <p className="flex items-baseline gap-3">
              <span
                className={cn(
                  "text-6xl leading-none font-light tabular-nums",
                  low && "text-destructive"
                )}
              >
                {onHand}
              </span>
              <span className="text-muted-foreground">on hand</span>
              {data.part.options ? (
                <span className="text-sm text-muted-foreground">
                  {data.totalOnHand} across all sizes
                </span>
              ) : null}
              {outOnLoan > 0 ? (
                <span className="text-sm text-muted-foreground">
                  {outOnLoan} out on loan
                </span>
              ) : null}
              {data.part.minQuantity !== null ? (
                <span
                  className={cn(
                    "text-sm",
                    low ? "text-destructive" : "text-muted-foreground"
                  )}
                >
                  {low ? "Restock at" : "Low at"} {data.part.minQuantity}
                </span>
              ) : null}
            </p>
            <StockBar stock={data.stock} borrowers={borrowers} />
            <div className="mt-6">
              <PartActions
                workspaceId={workspaceId}
                partId={partId}
                partName={displayName(data.part.name, variant)}
                variant={variant}
                isAdmin={isAdmin}
                stock={data.stock}
                locations={data.locations}
                minQuantity={data.part.minQuantity}
              />
            </div>
          </div>

          <Section title="Out on loan">
            {data.loans.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                None of these are out.
              </p>
            ) : (
              <ul>
                {data.loans.map((loan) => (
                  <LoanRow
                    key={loan._id}
                    workspaceId={workspaceId}
                    loan={loan}
                    canReturn={
                      isAdmin || loan.borrowerId === data.currentUserId
                    }
                  />
                ))}
              </ul>
            )}
          </Section>

          <Section title="History">
            {data.movements.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes yet.</p>
            ) : (
              <ul>
                {data.movements.map((movement) => (
                  <MovementLine key={movement._id} movement={movement} />
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </article>
  )
}

function MovementLine({ movement }: { movement: Detail["movements"][number] }) {
  const verb =
    movement.kind === "borrow"
      ? "borrowed"
      : movement.kind === "return"
        ? "returned"
        : movement.delta > 0
          ? "restocked"
          : "removed"
  return (
    <li className="flex items-start gap-3 border-b py-2 text-sm last:border-b-0">
      <span
        className={cn(
          "min-w-10 rounded-md bg-muted px-2 py-0.5 text-center text-xs font-bold tabular-nums",
          movement.delta > 0 && "text-success"
        )}
      >
        {movement.delta > 0 ? `+${movement.delta}` : movement.delta}
      </span>
      <span className="min-w-0 flex-1">
        {movement.actorName} {verb} at {movement.locationName}
        {movement.note ? (
          <span className="block text-xs text-muted-foreground">
            {movement.note}
          </span>
        ) : null}
      </span>
      <span className="text-xs text-muted-foreground">
        {formatDate(movement.createdAt)}
      </span>
    </li>
  )
}
