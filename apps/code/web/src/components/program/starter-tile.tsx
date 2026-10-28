import type React from "react"

// Dialog triggers on the programs page use these classes on an outline Button
// so every starter, including Import, reads as the same physical control.
export const starterTileClassName =
  "h-auto w-full min-w-0 flex-col items-start justify-start gap-3 rounded-xl p-3 text-left whitespace-normal [--tactile-bg-active:color-mix(in_oklab,var(--starter)_22%,var(--card))]! [--tactile-bg-hover:color-mix(in_oklab,var(--starter)_40%,var(--card))]! [--tactile-bg:color-mix(in_oklab,var(--starter)_32%,var(--card))]! [--tactile-border:color-mix(in_oklab,var(--starter)_50%,var(--card))]!"

// The template color tints the whole tile: face, border, hover, and pressed state.
export function starterTileStyle(color: string) {
  return { "--starter": color } as React.CSSProperties
}

export function StarterTile({
  icon,
  label,
}: {
  icon: React.ReactNode
  label: string
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-lg bg-black/25 shadow-[inset_0_1px_2px_0_var(--shadow-color)]"
      >
        {icon}
      </span>
      <span className="text-sm leading-tight font-semibold text-foreground">
        {label}
      </span>
    </>
  )
}
