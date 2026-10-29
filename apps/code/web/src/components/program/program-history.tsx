import { ActionTooltip } from "@/components/shared/action-tooltip"
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react"
import type { Id } from "@v5x/backend/dataModel"
import { Button } from "@v5x/ui/components/button"
import { lazy, Suspense, useState } from "react"

const loadHistory = () => import("@/components/program/program-history-panel")
const HistoryPanel = lazy(() =>
  loadHistory().then((module) => ({ default: module.ProgramHistoryPanel }))
)
export function ProgramHistory(props: {
  programId: Id<"programs">
  revision?: string
  canRestore: boolean
  onRestore: (sha: string) => Promise<string | null>
}) {
  const [mounted, setMounted] = useState(false)
  const trigger = (disabled: boolean) => (
    <ActionTooltip label="Program history">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Program history"
        disabled={disabled}
        onPointerEnter={() => void loadHistory().catch(() => {})}
        onClick={() => setMounted(true)}
      >
        <ClockCounterClockwiseIcon />
      </Button>
    </ActionTooltip>
  )
  return mounted ? (
    <Suspense fallback={trigger(true)}>
      <HistoryPanel {...props} initiallyOpen />
    </Suspense>
  ) : (
    trigger(false)
  )
}
