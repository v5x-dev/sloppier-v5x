import type { AutonPath } from "./auton-paths"
import { pathDuration, pathPoseAt } from "./path-animation"

const size = 400
const extent = 3690 / 25.4
const coordinate = (value: number) => (value / extent) * size

export async function exportPathGif(options: {
  route: AutonPath
  fieldImage: string
  robotWidth: number
  robotLength: number
  robotVisible: boolean
  primary: string
  startColor: string
  foreground: string
  background: string
}) {
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc")
  const image = new Image()
  image.crossOrigin = "anonymous"
  image.src = options.fieldImage
  await image.decode()
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = size
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("Could not create the GIF canvas.")
  const gif = GIFEncoder()
  const duration = pathDuration(options.route.points)
  // Keep long routes bounded while preserving the complete route and its timing.
  const frames = Math.max(1, Math.min(300, Math.ceil(duration * 10)))
  const delay = Math.max(100, (duration * 1000) / frames)
  // A shared palette also keeps stationary pixels stable between frames.
  let palette: number[][] | undefined
  for (let frame = 0; frame < frames; frame++) {
    ctx.fillStyle = options.background
    ctx.fillRect(0, 0, size, size)
    ctx.drawImage(image, 0, 0, size, size)
    ctx.strokeStyle = options.primary
    ctx.lineWidth = size / 100
    ctx.lineJoin = "round"
    ctx.beginPath()
    for (const point of options.route.points) {
      const x = size / 2 + coordinate(point.x)
      const y = size / 2 - coordinate(point.y)
      if (point.start) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    for (const point of options.route.points) {
      if (point.interpolated) continue
      ctx.save()
      ctx.translate(
        size / 2 + coordinate(point.x),
        size / 2 - coordinate(point.y)
      )
      ctx.fillStyle = point.start ? options.startColor : options.primary
      ctx.strokeStyle = options.background
      ctx.lineWidth = size * 0.003
      ctx.beginPath()
      ctx.arc(0, 0, size * (point.start ? 0.018 : 0.009), 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.rotate((point.heading * Math.PI) / 180)
      ctx.strokeStyle = options.foreground
      ctx.lineWidth = size * 0.005
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(0, -size * 0.03)
      ctx.stroke()
      ctx.restore()
    }
    const robot = pathPoseAt(options.route.points, (duration * frame) / frames)
    if (options.robotVisible && robot) {
      ctx.save()
      ctx.translate(
        size / 2 + coordinate(robot.x),
        size / 2 - coordinate(robot.y)
      )
      ctx.rotate((robot.heading * Math.PI) / 180)
      const width = coordinate(options.robotWidth)
      const length = coordinate(options.robotLength)
      ctx.fillStyle = options.primary
      ctx.globalAlpha = 0.4
      ctx.fillRect(-width / 2, -length / 2, width, length)
      ctx.globalAlpha = 1
      ctx.strokeStyle = options.primary
      ctx.lineWidth = size * 0.006
      ctx.strokeRect(-width / 2, -length / 2, width, length)
      ctx.strokeStyle = options.foreground
      ctx.lineWidth = size * 0.005
      ctx.beginPath()
      ctx.moveTo(-size * 0.01, -size * 0.02)
      ctx.lineTo(0, -size * 0.03)
      ctx.lineTo(size * 0.01, -size * 0.02)
      ctx.stroke()
      ctx.restore()
    }
    const pixels = ctx.getImageData(0, 0, size, size).data
    // gifenc caches nearest colors by RGB565 value. Normalize each pixel to
    // that value so the cache result cannot depend on frame traversal order.
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] &= 0xf8
      pixels[i + 1] &= 0xfc
      pixels[i + 2] &= 0xf8
    }
    palette ??= quantize(pixels, 256)
    gif.writeFrame(applyPalette(pixels, palette), size, size, {
      palette,
      delay,
    })
    if (frame % 5 === 0)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  gif.finish()
  const blob = new Blob([new Uint8Array(gif.bytes())], { type: "image/gif" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${options.route.name.replace(/[^a-z0-9_-]+/gi, "-") || "auton-path"}.gif`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
