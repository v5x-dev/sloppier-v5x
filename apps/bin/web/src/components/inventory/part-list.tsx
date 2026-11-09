import {
  CubeIcon,
  LightningIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import type { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
import { Button } from "@v5x/ui/components/button"
import { Input } from "@v5x/ui/components/input"
import { ScrollArea } from "@v5x/ui/components/scroll-area"
import { cn } from "@v5x/ui/lib/utils"
import type { FunctionReturnType } from "convex/server"
import { useState } from "react"
import { ScrewSwatch } from "@/components/inventory/screw-swatch"
import {
  iconUrl,
  usePartIcons,
  useManifest,
  type ModelEntry,
} from "@/components/inventory/model-manifest"

export type PartRow = FunctionReturnType<
  typeof api.bin.inventory
>["parts"][number]

const isLow = (part: PartRow) =>
  part.minQuantity !== null && part.onHand < part.minQuantity

export function PartList({
  workspaceId,
  parts,
  selectedId,
  isAdmin,
  onAdd,
  className,
}: {
  workspaceId: Id<"workspaces">
  parts: PartRow[]
  selectedId: string | undefined
  isAdmin: boolean
  onAdd: () => void
  className?: string
}) {
  const [search, setSearch] = useState("")
  const [lowOnly, setLowOnly] = useState(false)
  const manifest = useManifest()
  const partIcons = usePartIcons()
  const needle = search.trim().toLowerCase()
  const lowCount = parts.filter(isLow).length
  const visible = parts.filter(
    (part) =>
      (!lowOnly || isLow(part)) &&
      (needle === "" ||
        part.name.toLowerCase().includes(needle) ||
        (part.sku ?? "").toLowerCase().includes(needle) ||
        part.partType.toLowerCase().includes(needle))
  )

  return (
    <div className={cn("min-h-0 flex-col border-r", className)}>
      <div className="flex items-center gap-2 border-b p-3">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search parts"
            placeholder="Search parts"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {isAdmin ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Add part"
            title="Add part"
            onClick={onAdd}
          >
            <PlusIcon />
          </Button>
        ) : null}
      </div>
      <div className="flex gap-1 border-b px-3 py-2">
        <Button
          size="xs"
          variant={lowOnly ? "ghost" : "secondary"}
          aria-pressed={!lowOnly}
          onClick={() => setLowOnly(false)}
        >
          All {parts.length}
        </Button>
        <Button
          size="xs"
          variant={lowOnly ? "secondary" : "ghost"}
          aria-pressed={lowOnly}
          onClick={() => setLowOnly(true)}
        >
          Low stock {lowCount}
        </Button>
      </div>
      {visible.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          {parts.length === 0
            ? "No parts yet."
            : lowOnly && needle === ""
              ? "Nothing is below its low-stock level."
              : "No parts match that search."}
        </p>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ul>
            {visible.map((part) => {
              const selected = part._id === selectedId
              return (
                <li key={part._id}>
                  <Link
                    to="/workspaces/$workspaceId"
                    params={{ workspaceId }}
                    search={{ part: part._id }}
                    aria-current={selected ? "true" : undefined}
                    className={cn(
                      "flex items-center gap-3 border-b py-2 pr-5 pl-3 outline-none hover:bg-muted/50 focus-visible:bg-muted/50",
                      selected &&
                        "bg-muted shadow-[inset_2px_0_0_var(--chart-2)]"
                    )}
                  >
                    <PartThumb
                      protobot={part.sku ? partIcons?.[part.sku] : undefined}
                      entry={part.sku ? manifest?.[part.sku] : undefined}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.8rem] leading-snug font-bold">
                        {part.name}
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {part.screwColor ? (
                          <ScrewSwatch color={part.screwColor} />
                        ) : null}
                        {part.sku ?? part.partType}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-sm font-bold tabular-nums",
                        isLow(part) && "text-destructive"
                      )}
                    >
                      {part.onHand}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </ScrollArea>
      )}
    </div>
  )
}

// The part's picture from its 3D model, or a cube where there is no model.
function PartThumb({
  protobot,
  entry,
}: {
  protobot?: string
  entry?: ModelEntry
}) {
  const icon = protobot ?? (entry ? iconUrl(entry) : null)
  // Some parts use a Phosphor icon instead of a traced picture.
  const Phosphor = protobot?.startsWith("phosphor:")
    ? PHOSPHOR_ICONS[protobot.slice("phosphor:".length)]
    : undefined
  return (
    <span className="grid size-10 shrink-0 place-items-center text-foreground">
      {Phosphor ? (
        <Phosphor className="size-8" aria-hidden="true" />
      ) : icon ? (
        // The icon is a mask, so it takes the text color and follows the theme.
        <span
          aria-hidden="true"
          className="block size-8 bg-current"
          style={iconMask(icon)}
        />
      ) : (
        <CubeIcon className="size-5 text-muted-foreground" />
      )}
    </span>
  )
}

// Phosphor icons that a part can be drawn with, by name, from the icon map.
const PHOSPHOR_ICONS: Record<string, typeof LightningIcon> = {
  lightning: LightningIcon,
}

function iconMask(url: string) {
  const value = `url("${url}") center / contain no-repeat`
  return { mask: value, WebkitMask: value }
}
