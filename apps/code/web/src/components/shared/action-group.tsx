import type { ReactNode } from "react"

// Groups related bar controls. The bar is flat like a status bar, so groups
// are spacing alone; no joined borders.
export function ActionGroup({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5">
      {children}
    </div>
  )
}
