import type { ReactNode } from "react"
import { Kbd, KbdGroup } from "@v5x/ui/components/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@v5x/ui/components/tooltip"

export function ActionTooltip({
  label,
  shortcut,
  children,
}: {
  label: ReactNode
  shortcut?: string[]
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger delay={300} render={<span className="inline-flex" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && (
          <KbdGroup>
            {shortcut.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </KbdGroup>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
