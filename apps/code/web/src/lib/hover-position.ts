export type HoverAnchor = { left: number; top: number; bottom: number }

/** Ignore a range that does not actually contain the pointer. */
export function hoverAnchor(
  rects: ArrayLike<DOMRect>,
  x: number,
  y: number
): HoverAnchor {
  const rect = Array.from(rects).find(
    (candidate) =>
      x >= candidate.left &&
      x <= candidate.right &&
      y >= candidate.top &&
      y <= candidate.bottom
  )
  return rect
    ? { left: rect.left, top: rect.top, bottom: rect.bottom }
    : { left: x, top: y - 10, bottom: y + 10 }
}

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
