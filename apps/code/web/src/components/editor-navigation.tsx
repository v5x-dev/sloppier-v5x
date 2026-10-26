import { HoverDocumentation } from "./hover-documentation"
import type { HoverContents } from "@/lib/hover-content"
import { useContext, useEffect, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"
import type { PierreCollaboration } from "@/lib/pierre-collaboration"
import { positionAt, RequestCancelled } from "@/lib/language-client"
import { DefinitionContext, useLanguageClient } from "./language-session"
import { toast } from "@workspace/ui/components/toast"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

type Popup = { contents: HoverContents; left: number; top: number }

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
  const client = useLanguageClient()
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
    let disposed = false
    const dismiss = () => {
      clearTimeout(timer)
      clearTimeout(leaveTimer.current)
      hover?.abort()
      setPopup(null)
    }
    const go = async (offset: number) => {
      dismiss()
      if (!client.isReady) {
        toast.add({ type: "info", title: "Language server is connecting" })
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
      dismiss()
      if (!client.isReady || event.buttons) return
      const text = binding.document.getText()
      const offset = pointerOffset(event, host, text)
      if (offset === null || !/[\w]/.test(text[offset] ?? "")) return
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
            if (content)
              setPopup({
                contents: result.contents,
                left: Math.max(
                  8,
                  Math.min(event.clientX, window.innerWidth - 456)
                ),
                top: Math.max(
                  8,
                  Math.min(event.clientY + 20, window.innerHeight - 376)
                ),
              })
          })
          .catch(() => {
            /* Hover is optional; later pointer movement retries. */
          })
      }, 500)
    }
    const click = (event: MouseEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return
      const offset = pointerOffset(event, host, binding.document.getText())
      if (offset === null) return
      event.preventDefault()
      event.stopPropagation()
      void go(offset)
    }
    const leave = () => {
      leaveTimer.current = setTimeout(dismiss, 200)
    }
    host.addEventListener("keydown", keydown, true)
    host.addEventListener("mousemove", move)
    host.addEventListener("mouseleave", leave)
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
          <pre className="min-h-0 overflow-auto text-xs">
            {source?.contents.split("\n").map((line, index) => (
              <div
                key={index}
                ref={
                  index + 1 === source.line
                    ? (node) => node?.scrollIntoView({ block: "center" })
                    : undefined
                }
              >
                <span className="mr-4 inline-block w-10 text-right text-muted-foreground select-none">
                  {index + 1}
                </span>
                {line || " "}
              </div>
            ))}
          </pre>
        </DialogContent>
      </Dialog>
      {popup &&
        createPortal(
          <div
            role="tooltip"
            data-language-hover
            onMouseEnter={() => clearTimeout(leaveTimer.current)}
            onMouseLeave={() => setPopup(null)}
            className="pointer-events-auto fixed z-50 max-h-[min(360px,calc(100vh-16px))] w-[min(440px,calc(100vw-16px))] overflow-auto rounded-lg bg-popover text-popover-foreground shadow-xl ring-1 shadow-black/25 ring-foreground/15"
            style={{ left: popup.left, top: popup.top }}
          >
            <HoverDocumentation contents={popup.contents} />
          </div>,
          document.body
        )}
    </>
  )
}
