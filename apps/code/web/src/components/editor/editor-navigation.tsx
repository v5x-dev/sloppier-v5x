import { HoverDocumentation } from "./hover-documentation"
import type { HoverContents } from "@/lib/hover-content"
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"
import { File } from "@pierre/diffs/react"
import { editorThemeOptions } from "@/lib/editor-theme"
import type { PierreCollaboration } from "@/lib/pierre-collaboration"
import { positionAt, RequestCancelled } from "@/lib/language-service"
import { DefinitionContext, useLanguageService } from "./language-session"
import { toast } from "@workspace/ui/components/toast"
import { hoverPosition, type HoverAnchor } from "@/lib/hover-position"
import { isClickGesture, type Point } from "@/lib/click-gesture"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

type Popup = { contents: HoverContents; anchor: HoverAnchor }
type Definition = { path: string; contents: string; line: number }

function HoverCard({
  popup,
  onEnter,
  onLeave,
}: {
  popup: Popup
  onEnter: () => void
  onLeave: () => void
}) {
  const content = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(() =>
    hoverPosition(popup.anchor, 360, window.innerWidth, window.innerHeight)
  )
  useLayoutEffect(() => {
    const node = content.current
    if (!node) return
    const measure = () =>
      setPosition(
        hoverPosition(
          popup.anchor,
          node.getBoundingClientRect().height,
          window.innerWidth,
          window.innerHeight
        )
      )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [popup])
  return (
    <div
      role="tooltip"
      data-language-hover
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="pointer-events-auto fixed z-50 overflow-auto rounded-lg bg-popover text-popover-foreground shadow-xl ring-1 shadow-black/25 ring-foreground/15"
      style={position}
    >
      <div ref={content} className="flow-root">
        <HoverDocumentation contents={popup.contents} />
      </div>
    </div>
  )
}

/** Measure the symbol itself, rather than anchoring the card to a moving pointer. */
function symbolAnchor(
  event: MouseEvent,
  text: string,
  start: number,
  end: number
): HoverAnchor {
  const line = event
    .composedPath()
    .find(
      (node): node is HTMLElement =>
        node instanceof HTMLElement && node.hasAttribute("data-line")
    )
  if (line) {
    const lineStart = text.lastIndexOf("\n", start - 1) + 1
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    let offset = lineStart
    let started = false
    while (walker.nextNode()) {
      const node = walker.currentNode
      const length = node.textContent?.length ?? 0
      if (!started && start < offset + length) {
        range.setStart(node, start - offset)
        started = true
      }
      if (started && end <= offset + length) {
        range.setEnd(node, end - offset)
        const rects = [...range.getClientRects()]
        const rect =
          rects.find(
            (candidate) =>
              event.clientY >= candidate.top &&
              event.clientY <= candidate.bottom
          ) ?? rects.at(0)
        if (rect) return { left: rect.left, top: rect.top, bottom: rect.bottom }
        break
      }
      offset += length
    }
  }
  return {
    left: event.clientX,
    top: event.clientY - 10,
    bottom: event.clientY + 10,
  }
}

/** Read-only toolchain source in the editor theme, scrolled to its definition line. */
function DefinitionSource({ source }: { source: Definition }) {
  const revealed = useRef(false)
  const { line } = source
  const file = useMemo(
    () => ({
      name: source.path,
      contents: source.contents.replace(/\r\n?/g, "\n"),
    }),
    [source.path, source.contents]
  )
  const options = useMemo(
    () => ({
      ...editorThemeOptions,
      disableFileHeader: true,
      overflow: "wrap" as const,
      // Pierre highlights asynchronously; reveal once this line's row exists.
      onPostRender: (node: HTMLElement) => {
        if (revealed.current) return
        const row = node.shadowRoot?.querySelector(`[data-line="${line}"]`)
        if (!row) return
        revealed.current = true
        row.scrollIntoView({ block: "center" })
      },
    }),
    [line]
  )
  return (
    <div className="min-h-0 overflow-auto rounded-lg">
      <File file={file} options={options} />
    </div>
  )
}

/** Maps a pointer into the highlighted text, including Pierre's shadow root. */
export function pointerOffset(
  event: MouseEvent,
  host: HTMLElement,
  text: string
) {
  const roots = [...host.querySelectorAll("*")].flatMap((node) =>
    node.shadowRoot ? [node.shadowRoot] : []
  )
  const caretDocument = document as unknown as {
    caretPositionFromPoint?: (
      x: number,
      y: number,
      options?: { shadowRoots: ShadowRoot[] }
    ) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const caret = caretDocument.caretPositionFromPoint?.(
    event.clientX,
    event.clientY,
    { shadowRoots: roots }
  )
  const fallback = !caret
    ? caretDocument.caretRangeFromPoint?.(event.clientX, event.clientY)
    : null
  const node = caret?.offsetNode ?? fallback?.startContainer
  const offset = caret?.offset ?? fallback?.startOffset
  if (!node || offset === undefined) return null
  const element = node instanceof Element ? node : node.parentElement
  const line = element?.closest("[data-line]")
  if (
    !line ||
    (!event.composedPath().includes(line) &&
      !roots.some((root) => root.contains(line)) &&
      !host.contains(line))
  )
    return null
  const lineNumber = Number(line.getAttribute("data-line"))
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return null
  const range = document.createRange()
  range.setStart(line, 0)
  range.setEnd(node, offset)
  const lines = text.split("\n")
  if (lineNumber > lines.length) return null
  return (
    lines
      .slice(0, lineNumber - 1)
      .reduce((total, value) => total + value.length + 1, 0) +
    Math.min(range.toString().length, lines[lineNumber - 1].length)
  )
}

export function useEditorNavigation(
  binding: PierreCollaboration,
  path: string,
  wrapper: RefObject<HTMLDivElement | null>
) {
  const client = useLanguageService()
  const navigate = useContext(DefinitionContext)
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const [source, setSource] = useState<{
    path: string
    contents: string
    line: number
  } | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )
  const [popup, setPopup] = useState<Popup | null>(null)
  useEffect(() => {
    const host = wrapper.current
    if (!host || !client) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let hover: AbortController | undefined
    let definition: AbortController | undefined
    let hoveredWord: { start: number; end: number; text: string } | undefined
    let pressed: Point | undefined
    let disposed = false
    const cancelHover = () => {
      clearTimeout(timer)
      hover?.abort()
      hoveredWord = undefined
    }
    const hideSoon = () => {
      clearTimeout(leaveTimer.current)
      leaveTimer.current = setTimeout(() => setPopup(null), 200)
    }
    const dismiss = () => {
      cancelHover()
      clearTimeout(leaveTimer.current)
      setPopup(null)
    }
    const go = async (offset: number) => {
      dismiss()
      if (!client.isReady) {
        toast.add({ type: "info", title: "Autocomplete is loading" })
        return
      }
      definition?.abort()
      const controller = (definition = new AbortController())
      const version = client.version(path)
      const stopped = () =>
        disposed ||
        controller.signal.aborted ||
        version !== client.version(path)
      try {
        const targets = await client.definition(
          path,
          positionAt(binding.document.getText(), offset),
          controller.signal
        )
        if (stopped()) return
        const target = targets.at(0)
        if (!target) toast.add({ type: "info", title: "No definition found" })
        else if (
          !target.path ||
          !navigateRef.current?.(
            target.path,
            target.position.line + 1,
            target.position.character + 1
          )
        ) {
          const file = await client.readDefinition(
            target.uri,
            controller.signal
          )
          if (!stopped()) setSource({ ...file, line: target.position.line + 1 })
        }
      } catch (error) {
        if (!(error instanceof RequestCancelled) && !controller.signal.aborted)
          toast.add({
            type: "error",
            title: "Could not find definition",
            description: error instanceof Error ? error.message : String(error),
          })
      }
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss()
      if (
        event.key !== "F12" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return
      const selection = binding.editor?.getViewState().selections?.[0]
      if (!selection) return
      event.preventDefault()
      event.stopPropagation()
      void go(binding.document.offsetAt(selection.start))
    }
    const move = (event: MouseEvent) => {
      if (!client.isReady || event.buttons) return dismiss()
      const text = binding.document.getText()
      const offset = pointerOffset(event, host, text)
      if (offset === null || !/[\w]/.test(text[offset] ?? "")) {
        cancelHover()
        hideSoon()
        return
      }
      let start = offset
      let end = offset + 1
      while (start > 0 && /\w/.test(text[start - 1])) start--
      while (end < text.length && /\w/.test(text[end])) end++
      clearTimeout(leaveTimer.current)
      if (
        hoveredWord?.start === start &&
        hoveredWord.end === end &&
        hoveredWord.text === text
      )
        return
      cancelHover()
      hoveredWord = { start, end, text }
      const anchor = symbolAnchor(event, text, start, end)
      // Keep the old card briefly so the pointer can cross onto it, even if
      // another token lies between the originating symbol and the card.
      hideSoon()
      timer = setTimeout(() => {
        const controller = (hover = new AbortController())
        const version = client.version(path)
        void client
          .hover(path, positionAt(text, offset), controller.signal)
          .then((result) => {
            if (
              disposed ||
              controller.signal.aborted ||
              version !== client.version(path) ||
              !result
            )
              return
            const values = Array.isArray(result.contents)
              ? result.contents
              : [result.contents]
            const content = values
              .map((value) => (typeof value === "string" ? value : value.value))
              .join("\n\n")
              .trim()
            if (content) {
              clearTimeout(leaveTimer.current)
              setPopup({
                contents: result.contents,
                anchor,
              })
            }
          })
          .catch(() => {
            /* Hover is optional; later pointer movement retries. */
          })
      }, 500)
    }
    const pointerdown = (event: PointerEvent) => {
      pressed = { x: event.clientX, y: event.clientY }
    }
    const click = (event: MouseEvent) => {
      const start = pressed
      pressed = undefined
      if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return
      // Dragging to select text also ends in a click; only a press released
      // where it started navigates.
      if (
        !start ||
        !isClickGesture(start, { x: event.clientX, y: event.clientY })
      )
        return
      const text = binding.document.getText()
      const offset = pointerOffset(event, host, text)
      if (offset === null || !/\w/.test(text[offset] ?? "")) return
      event.preventDefault()
      event.stopPropagation()
      void go(offset)
    }
    const leave = (event: MouseEvent) => {
      cancelHover()
      // React's portaled mouse-enter can run before the editor's native leave.
      // Do not re-arm dismissal after the pointer has already entered the card.
      if (
        event.relatedTarget instanceof Element &&
        event.relatedTarget.closest("[data-language-hover]")
      ) {
        clearTimeout(leaveTimer.current)
        return
      }
      hideSoon()
    }
    host.addEventListener("keydown", keydown, true)
    host.addEventListener("mousemove", move)
    host.addEventListener("mouseleave", leave)
    host.addEventListener("pointerdown", pointerdown, true)
    host.addEventListener("click", click, true)
    host.addEventListener("input", dismiss, true)
    const scroll = (event: Event) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("[data-language-hover]")
      )
        dismiss()
    }
    window.addEventListener("scroll", scroll, true)
    return () => {
      disposed = true
      clearTimeout(timer)
      clearTimeout(leaveTimer.current)
      hover?.abort()
      definition?.abort()
      host.removeEventListener("keydown", keydown, true)
      host.removeEventListener("mousemove", move)
      host.removeEventListener("mouseleave", leave)
      host.removeEventListener("pointerdown", pointerdown, true)
      host.removeEventListener("click", click, true)
      host.removeEventListener("input", dismiss, true)
      window.removeEventListener("scroll", scroll, true)
    }
  }, [binding, path, client, wrapper])
  return (
    <>
      <Dialog
        open={Boolean(source)}
        onOpenChange={(open) => {
          if (!open) setSource(null)
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="break-all">{source?.path}</DialogTitle>
          </DialogHeader>
          {source && <DefinitionSource source={source} />}
        </DialogContent>
      </Dialog>
      {popup &&
        createPortal(
          <HoverCard
            popup={popup}
            onEnter={() => clearTimeout(leaveTimer.current)}
            onLeave={() => {
              clearTimeout(leaveTimer.current)
              leaveTimer.current = setTimeout(() => setPopup(null), 200)
            }}
          />,
          document.body
        )}
    </>
  )
}
