import { ActionTooltip } from "@/components/shared/action-tooltip"
import { SidebarTrigger, useSidebar } from "@v5x/ui/components/sidebar"
import { TooltipProvider } from "@v5x/ui/components/tooltip"

export function ActionsBar({
  leftAction,
  children,
}: {
  leftAction: React.ReactNode
  children: React.ReactNode
}) {
  const { isMobile } = useSidebar()

  return (
    <TooltipProvider>
      <div className="flex h-8 shrink-0 items-center gap-0.5 px-1.5 text-sidebar-foreground">
        {leftAction}
        {isMobile && (
          <ActionTooltip label="Toggle sidebar">
            <SidebarTrigger />
          </ActionTooltip>
        )}
        <div className="flex-1" />
        {children}
      </div>
    </TooltipProvider>
  )
}
