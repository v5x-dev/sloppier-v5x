import { useEffect, type RefObject } from "react"
import type { PierreCollaboration } from "@/lib/pierre-collaboration"

const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" }

export function useEditorBrackets(
  binding: PierreCollaboration,
  wrapper: RefObject<HTMLDivElement | null>
) {
  useEffect(() => {
    const host = wrapper.current
    if (!host) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return
      const editor = binding.editor
      const selections = editor?.getViewState().selections
      if (!editor || !selections?.length) return
      const document = binding.document
      const text = document.getText()
      const offsets = selections.map((selection) => ({
        start: document.offsetAt(selection.start),
        end: document.offsetAt(selection.end),
      }))
      // Pierre handles surrounding selected text itself.
      if (offsets.some(({ start, end }) => start !== end)) return
      const close = pairs[event.key]
      const opening = Object.values(pairs).includes(event.key)
      const backspace = event.key === "Backspace"
      if (
        close &&
        offsets.some(({ start }) => !/^[\s\])},;:]?$/.test(text[start] ?? ""))
      )
        return
      if (opening && offsets.some(({ start }) => text[start] !== event.key))
        return
      if (
        backspace &&
        offsets.some(
          ({ start }) => !start || pairs[text[start - 1]] !== text[start]
        )
      )
        return
      if (!close && !opening && !backspace) return
      event.preventDefault()
      event.stopPropagation()
      if (opening) {
        editor.setSelections(
          offsets.map(({ start }) => ({
            start: document.positionAt(start + 1),
            end: document.positionAt(start + 1),
            direction: "forward" as const,
          }))
        )
        return
      }
      const edits = offsets.map(({ start }) => ({
        range: {
          start: document.positionAt(backspace ? start - 1 : start),
          end: document.positionAt(backspace ? start + 1 : start),
        },
        newText: close ? event.key + close : "",
      }))
      binding.undo.stopCapturing()
      editor.applyEdits(edits)
      binding.undo.stopCapturing()
      // Do not move carets if the document rejected the edit due to its size limit.
      if (document.getText() === text) return
      const sorted = [...offsets].sort((a, b) => a.start - b.start)
      editor.setSelections(
        offsets.map(({ start }) => {
          const prior = sorted.filter((offset) => offset.start < start).length
          const position = document.positionAt(
            backspace ? start - 1 - prior * 2 : start + 1 + prior * 2
          )
          return {
            start: position,
            end: position,
            direction: "forward" as const,
          }
        })
      )
    }
    host.addEventListener("keydown", onKeyDown, true)
    return () => host.removeEventListener("keydown", onKeyDown, true)
  }, [binding, wrapper])
}
