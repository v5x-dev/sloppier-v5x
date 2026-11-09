import { cn } from "@v5x/ui/lib/utils"

// The color Robosource gives a star drive screw of this length, as in the
// length chart. Light colors get a ring so they show on a light background.
export type ScrewColor = { name: string; hex: string; length: string }

export function ScrewSwatch({
  color,
  className,
}: {
  color: ScrewColor
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label={`${color.name}, ${color.length} long`}
      title={`${color.name}, ${color.length} long`}
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full ring-1 ring-foreground/25",
        className
      )}
      style={{ backgroundColor: color.hex }}
    />
  )
}
