import { ActionTooltip } from "@/components/shared/action-tooltip"
import { SidebarTrigger, useSidebar } from "@v5x/ui/components/sidebar"
import { TooltipProvider } from "@v5x/ui/components/tooltip"

export function ActionsBar({
  leftAction,
  children,
  progress,
}: {
  leftAction: React.ReactNode
  children: React.ReactNode
  progress?: { label: string; value: number | null } | null
}) {
  const { isMobile } = useSidebar()

  return (
    <TooltipProvider>
      <div className="relative flex h-8 shrink-0 items-center gap-0.5 px-1.5 text-sidebar-foreground">
        {leftAction}
        {isMobile && (
          <ActionTooltip label="Toggle sidebar">
            <SidebarTrigger />
          </ActionTooltip>
        )}
        <div className="flex-1" />
        {children}
        {progress && (
          <div
            role="progressbar"
            aria-label={progress.label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.value ?? undefined}
            className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
          >
            <div
              className={
                progress.value === null
                  ? "h-full w-1/3 bg-primary motion-safe:animate-pulse"
                  : "h-full bg-primary transition-[width]"
              }
              style={
                progress.value === null
                  ? undefined
                  : { width: `${Math.max(0, Math.min(100, progress.value))}%` }
              }
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
