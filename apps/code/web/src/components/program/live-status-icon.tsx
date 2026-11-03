import { ActionTooltip } from "@/components/shared/action-tooltip"
import { liveSaveLabels, type LiveSaveStatus } from "@/lib/live-save-status"
import {
  CircleNotchIcon,
  CloudArrowUpIcon,
  CloudCheckIcon,
  CloudSlashIcon,
} from "@phosphor-icons/react"
import { cn } from "@v5x/ui/lib/utils"

// Icon only, so the editor bar stays free of text. The label is the tooltip and the accessible name.
const statusIcons: Record<
  LiveSaveStatus,
  { icon: React.ReactNode; className: string }
> = {
  opening: {
    icon: <CircleNotchIcon className="motion-safe:animate-spin" />,
    className: "text-muted-foreground",
  },
  saving: {
    icon: <CircleNotchIcon className="motion-safe:animate-spin" />,
    className: "text-muted-foreground",
  },
  "backing-up": {
    icon: <CloudArrowUpIcon />,
    className: "text-muted-foreground",
  },
  saved: {
    icon: <CloudCheckIcon />,
    className: "text-success",
  },
  offline: {
    icon: <CloudSlashIcon />,
    className: "text-primary",
  },
}

export function LiveStatusIcon({
  status,
}: {
  status: LiveSaveStatus | undefined
}) {
  if (!status) return null
  const label = liveSaveLabels[status]
  const { icon, className } = statusIcons[status]
  return (
    <ActionTooltip label={label}>
      <span
        role="status"
        aria-label={label}
        className={cn(
          "flex size-7 shrink-0 items-center justify-center [&_svg]:size-4",
          className
        )}
      >
        {icon}
      </span>
    </ActionTooltip>
  )
}
