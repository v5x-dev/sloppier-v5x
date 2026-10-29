import type { PathPoint } from "./auton-paths"

// Approximate playback time from the geometry; the parser does not model motor speed.
function pathSteps(points: PathPoint[]) {
  return points.slice(1).map((point, index) => {
    const previous = points[index]
    const angle =
      ((((point.heading - previous.heading) % 360) + 540) % 360) - 180
    const duration = point.start
      ? 0
      : Math.max(
          Math.hypot(point.x - previous.x, point.y - previous.y) / 18,
          Math.abs(angle) / 90
        )
    return { previous, point, angle, duration }
  })
}

export function pathDuration(points: PathPoint[]) {
  return pathSteps(points).reduce((sum, step) => sum + step.duration, 0)
}

export function pathPoseAt(
  points: PathPoint[],
  elapsed: number
): PathPoint | undefined {
  if (!points.length) return undefined
  const steps = pathSteps(points)
  const total = steps.reduce((sum, step) => sum + step.duration, 0)
  if (!total) return points[0]
  let time = ((elapsed % total) + total) % total
  for (const step of steps) {
    if (!step.duration) continue
    if (time < step.duration) {
      const fraction = time / step.duration
      return {
        x: step.previous.x + (step.point.x - step.previous.x) * fraction,
        y: step.previous.y + (step.point.y - step.previous.y) * fraction,
        heading: step.previous.heading + step.angle * fraction,
      }
    }
    time -= step.duration
  }
  return points.at(-1)
}
