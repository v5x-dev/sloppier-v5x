import { ActionTooltip } from "@/components/shared/action-tooltip"
import { SidebarTrigger, useSidebar } from "@v5x/ui/components/sidebar"
import { TooltipProvider } from "@v5x/ui/components/tooltip"

export function ActionsBar({
  leftAction,
  activePath,
  children,
}: {
  activePath: string | null
  leftAction: React.ReactNode
  children: React.ReactNode
}) {
  const { isMobile } = useSidebar()

  return (
    <TooltipProvider>
      <div className="flex h-8 shrink-0 items-center gap-0.5 px-1.5 text-sidebar-foreground">
        {leftAction}
        {/* On mobile the sidebar is a sheet, so the bar carries its toggle and
          the open file's path. */}
        {isMobile ? (
          <>
            <ActionTooltip label="Toggle sidebar">
              <SidebarTrigger variant="outline" />
            </ActionTooltip>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {activePath}
            </span>
          </>
        ) : (
          <div className="flex-1" />
        )}
        {children}
      </div>
    </TooltipProvider>
  )
}
