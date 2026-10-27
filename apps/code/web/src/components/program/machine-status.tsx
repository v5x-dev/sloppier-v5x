import { useSyncExternalStore } from "react"
import { CodeIcon, HammerIcon } from "@phosphor-icons/react"
import { useLanguageService } from "@/components/editor/language-session"
import { useProgramConnection } from "./program-connection"
import { ActionTooltip } from "@/components/shared/action-tooltip"
import { cn } from "@workspace/ui/lib/utils"

const subscribeToNothing = () => () => {}
const stoppedStatus = () => "stopped" as const

export function MachineStatus() {
  const client = useLanguageService()
  const languageStatus = useSyncExternalStore(
    client?.onStatusChange ?? subscribeToNothing,
    client?.getStatus ?? stoppedStatus,
    stoppedStatus
  )
  const languageLabel = `Autocomplete: ${languageStatus}${client?.error ? `. ${client.error}` : ""}`
  const { machineStatus, ready, status, error } = useProgramConnection()
  const failed = Boolean(error) || machineStatus === "error"
  const building = ready && status?.building
  const label = failed
    ? "Builder: connection error"
    : building
      ? "Builder: building"
      : ready
        ? "Builder: connected"
        : machineStatus === "starting"
          ? "Builder: starting"
          : "Builder: connecting"

  return (
    <div className="ml-auto flex items-center">
      <ActionTooltip label={error ? `${label}. ${error}` : label}>
        <span
          role="status"
          aria-label={label}
          tabIndex={0}
          className="flex size-6 items-center justify-center rounded-sm outline-offset-2"
        >
          <HammerIcon
            aria-hidden="true"
            className={cn(
              "size-3.5",
              failed
                ? "text-red-500"
                : building
                  ? "text-blue-500"
                  : ready
                    ? "text-emerald-500"
                    : "text-amber-500"
            )}
          />
        </span>
      </ActionTooltip>
      <ActionTooltip label={languageLabel}>
        <span
          role="status"
          aria-label={languageLabel}
          tabIndex={0}
          className="flex size-6 items-center justify-center rounded-sm outline-offset-2"
        >
          <CodeIcon
            aria-hidden="true"
            className={cn(
              "size-3.5",
              languageStatus === "error"
                ? "text-red-500"
                : languageStatus === "ready"
                  ? "text-emerald-500"
                  : languageStatus === "starting"
                    ? "text-amber-500"
                    : "text-muted-foreground"
            )}
          />
        </span>
      </ActionTooltip>
    </div>
  )
}
