import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { source } from "@/lib/live-document"
import type { PierreCollaboration } from "@/lib/pierre-collaboration"

const MAX_WIDTH = 112

/** An overview of the live document, positioned beside its own scroll panel. */
export function EditorMinimap({
  binding,
  active,
  host,
}: {
  binding: PierreCollaboration
  active: boolean
  host: React.RefObject<HTMLDivElement | null>
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [parent, setParent] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const panel = host.current?.closest<HTMLElement>('[role="tabpanel"]')
    if (!panel || !active) return
    const container = panel.parentElement
    if (!container) return
    setParent(container)
    const resize = () => {
      const available = container.clientWidth
      const next =
        available < 300
          ? 0
          : Math.min(MAX_WIDTH, Math.max(56, Math.floor(available * 0.16)))
      setWidth(next)
      panel.style.paddingRight = next ? `${next + 8}px` : ""
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()
    return () => {
      observer.disconnect()
      panel.style.paddingRight = ""
      setParent(null)
    }
  }, [active, host])

  useEffect(() => {
    const panel = host.current?.closest<HTMLElement>('[role="tabpanel"]')
    const element = canvas.current
    if (!parent || !panel || !element || !width) return
    const context = element.getContext("2d")
    if (!context) return
    let frame = 0
    let lines = binding.document.getText().split("\n")
    let dirty = false
    const draw = () => {
      frame = 0
      if (dirty) {
        lines = binding.document.getText().split("\n")
        dirty = false
      }
      const height = panel.clientHeight
      const ratio = window.devicePixelRatio || 1
      if (element.width !== width * ratio) element.width = width * ratio
      if (element.height !== height * ratio) element.height = height * ratio
      element.style.height = `${height}px`
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      const lineHeight = Math.min(3, height / Math.max(lines.length, 1))
      const contentHeight = lines.length * lineHeight
      const styles = getComputedStyle(element)
      const foreground = styles.getPropertyValue("--foreground").trim()
      const muted = styles.getPropertyValue("--muted-foreground").trim()
      lines.forEach((line, index) => {
        const text = line.replaceAll("\t", "  ").slice(0, 74)
        const comment = /^\s*(\/\/|\/\*|\*)/.test(text)
        const directive = /^\s*#/.test(text)
        context.fillStyle = comment ? muted : foreground
        context.globalAlpha = comment ? 0.35 : directive ? 0.55 : 0.45
        // Each run of non-whitespace becomes a block, retaining indentation
        // and spacing without attempting to render tiny, unreadable text.
        const characterWidth = Math.min(1.4, (width - 8) / 74)
        for (const match of text.matchAll(/\S+/g)) {
          const x = 4 + match.index * characterWidth
          const blockWidth = Math.min(
            match[0].length * characterWidth,
            width - 4 - x
          )
          if (blockWidth > 0)
            context.fillRect(
              x,
              index * lineHeight,
              blockWidth,
              Math.max(0.5, lineHeight * 0.65)
            )
        }
      })
      context.globalAlpha = 1
      const total = Math.max(panel.scrollHeight, panel.clientHeight)
      element.setAttribute(
        "aria-valuenow",
        String(
          Math.round(
            (100 * panel.scrollTop) / Math.max(1, total - panel.clientHeight)
          )
        )
      )
      const top = (panel.scrollTop / total) * contentHeight
      const viewportHeight = Math.min(
        height - top,
        Math.max(12, (panel.clientHeight / total) * contentHeight)
      )
      if (element.matches(":hover, :focus-visible")) {
        context.fillStyle = foreground
        context.globalAlpha = 0.12
        context.fillRect(0, top, width, viewportHeight)
        context.globalAlpha = 1
      } else {
        context.strokeStyle = foreground
        context.globalAlpha = 0.4
        context.lineWidth = 1
        context.strokeRect(
          0.5,
          top + 0.5,
          width - 1,
          Math.max(0, viewportHeight - 1)
        )
        context.globalAlpha = 1
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw)
    }
    const update = () => {
      dirty = true
      schedule()
    }
    let resolution = window.matchMedia(
      `(resolution: ${window.devicePixelRatio}dppx)`
    )
    const resolutionChanged = () => {
      resolution.removeEventListener("change", resolutionChanged)
      resolution = window.matchMedia(
        `(resolution: ${window.devicePixelRatio}dppx)`
      )
      resolution.addEventListener("change", resolutionChanged)
      schedule()
    }
    resolution.addEventListener("change", resolutionChanged)
    const shared = source(binding.shared)
    element.addEventListener("pointerenter", schedule)
    element.addEventListener("pointerleave", schedule)
    element.addEventListener("focus", schedule)
    element.addEventListener("blur", schedule)
    shared.observe(update)
    panel.addEventListener("scroll", schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(panel)
    if (panel.firstElementChild) observer.observe(panel.firstElementChild)
    schedule()
    return () => {
      resolution.removeEventListener("change", resolutionChanged)
      element.removeEventListener("pointerenter", schedule)
      element.removeEventListener("pointerleave", schedule)
      element.removeEventListener("focus", schedule)
      element.removeEventListener("blur", schedule)
      shared.unobserve(update)
      panel.removeEventListener("scroll", schedule)
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [binding, host, parent, width])

  if (!parent || !active || !width) return null
  const navigate = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const panel = host.current?.closest<HTMLElement>('[role="tabpanel"]')
    if (!panel) return
    const rect = event.currentTarget.getBoundingClientRect()
    const lines = binding.document.getText().split("\n").length
    const contentHeight = lines * Math.min(3, rect.height / Math.max(lines, 1))
    const fraction = Math.max(
      0,
      Math.min(1, (event.clientY - rect.top) / Math.max(contentHeight, 1))
    )
    panel.scrollTop = fraction * panel.scrollHeight - panel.clientHeight / 2
  }
  return createPortal(
    <canvas
      ref={canvas}
      aria-label="Editor minimap"
      role="slider"
      tabIndex={0}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      aria-orientation="vertical"
      onKeyDown={(event) => {
        const panel = host.current?.closest<HTMLElement>('[role="tabpanel"]')
        if (!panel) return
        const amount =
          event.key === "ArrowDown"
            ? 40
            : event.key === "ArrowUp"
              ? -40
              : event.key === "PageDown"
                ? panel.clientHeight
                : event.key === "PageUp"
                  ? -panel.clientHeight
                  : 0
        if (amount) {
          event.preventDefault()
          panel.scrollTop += amount
        }
        if (event.key === "Home" || event.key === "End") {
          event.preventDefault()
          panel.scrollTop = event.key === "Home" ? 0 : panel.scrollHeight
        }
      }}
      onWheel={(event) => {
        const panel = host.current?.closest<HTMLElement>('[role="tabpanel"]')
        if (panel) panel.scrollTop += event.deltaY
      }}
      className="absolute top-0 right-0 z-10 cursor-pointer touch-none"
      style={{
        width,
        backgroundColor: "var(--background)",
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        navigate(event)
      }}
      onPointerMove={(event) => {
        if (event.buttons & 1) navigate(event)
      }}
    />,
    parent
  )
}
