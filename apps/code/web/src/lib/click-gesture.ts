export type Point = { x: number; y: number }

/** Pixels a pointer may travel between press and release and still count as a click. */
const CLICK_TRAVEL = 4

/** A press released where it started is a click; dragging to select text is not. */
export function isClickGesture(press: Point, release: Point) {
  return Math.hypot(release.x - press.x, release.y - press.y) <= CLICK_TRAVEL
}
