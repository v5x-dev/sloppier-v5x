import { useProgramConnection } from "./program-connection"
import { ActionTooltip } from "./action-tooltip"
import { cn } from "@workspace/ui/lib/utils"

export function MachineStatus() {
  const { machineStatus, ready, status, error } = useProgramConnection()
  const failed = Boolean(error) || machineStatus === "error"
  const building = ready && status?.building
  const label = failed
    ? "Smolmachine: connection error"
    : building
      ? "Smolmachine: building"
      : ready
        ? "Smolmachine: connected"
        : machineStatus === "starting"
          ? "Smolmachine: starting"
          : "Smolmachine: connecting"

  return (
    <div className="ml-auto flex items-center">
      <ActionTooltip label={error ? `${label}. ${error}` : label}>
        <span
          role="status"
          aria-label={label}
          tabIndex={0}
          className="flex size-6 items-center justify-center rounded-sm outline-offset-2"
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-2 rounded-full",
              failed
                ? "bg-red-500"
                : building
                  ? "bg-blue-500"
                  : ready
                    ? "bg-emerald-500"
                    : "bg-amber-500"
            )}
          />
        </span>
      </ActionTooltip>
    </div>
  )
}
