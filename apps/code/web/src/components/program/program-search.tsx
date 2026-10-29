import { ActionTooltip } from "@/components/shared/action-tooltip"
import { shortcutKeys } from "@/lib/keyboard-shortcuts"
import type { WorkbenchSource } from "@/lib/workbench-source"
import { MagnifyingGlassIcon } from "@phosphor-icons/react"
import type { Id } from "@v5x/backend/dataModel"
import { Button } from "@v5x/ui/components/button"
import { Sheet, SheetContent } from "@v5x/ui/components/sheet"
import { Spinner } from "@v5x/ui/components/spinner"
import { lazy, Suspense, useEffect, useRef, useState } from "react"

const loadSearch = () => import("@/components/program/program-search-panel")
const SearchPanel = lazy(() =>
  loadSearch().then((module) => ({ default: module.ProgramSearchPanel }))
)

export function ProgramSearch(props: {
  programId: Id<"programs">
  revision?: string
  drafts: Pick<
    WorkbenchSource,
    "getDrafts" | "subscribeDrafts" | "getDraftVersion" | "replaceMatches"
  >
  onSelect: (path: string, line: number, column: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const openSearch = () => {
    setMounted(true)
    setOpen(true)
    input.current?.focus()
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault()
        openSearch()
      }
    }
    window.addEventListener("keydown", shortcut)
    return () => window.removeEventListener("keydown", shortcut)
  }, [])
  return (
    <>
      <ActionTooltip label="Search program" shortcut={shortcutKeys("⇧", "F")}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Search program"
          onClick={openSearch}
          onPointerEnter={() => void loadSearch().catch(() => {})}
        >
          <MagnifyingGlassIcon />
        </Button>
      </ActionTooltip>
      {mounted && (
        <Suspense
          fallback={
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetContent side="right" aria-label="Search program">
                <Spinner />
              </SheetContent>
            </Sheet>
          }
        >
          <SearchPanel
            {...props}
            open={open}
            onOpenChange={setOpen}
            input={input}
          />
        </Suspense>
      )}
    </>
  )
}
