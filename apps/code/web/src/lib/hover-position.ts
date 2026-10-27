export type HoverAnchor = { left: number; top: number; bottom: number }

/** Prefer above the symbol, falling below when the card fits better there. */
export function hoverPosition(
  anchor: HoverAnchor,
  contentHeight: number,
  viewportWidth: number,
  viewportHeight: number
) {
  const margin = 8
  const gap = 4
  const width = Math.min(440, Math.max(0, viewportWidth - margin * 2))
  const above = Math.max(0, anchor.top - gap - margin)
  const below = Math.max(0, viewportHeight - anchor.bottom - gap - margin)
  const height = Math.min(360, contentHeight)
  const placeAbove = height <= above || above >= below
  return {
    left: Math.max(
      margin,
      Math.min(anchor.left, viewportWidth - width - margin)
    ),
    width,
    maxHeight: Math.min(360, placeAbove ? above : below),
    ...(placeAbove
      ? { bottom: viewportHeight - anchor.top + gap }
      : { top: anchor.bottom + gap }),
  }
}
