import { useEffect } from "react"
import type { PierreCollaboration } from "@/lib/pierre-collaboration"
import { useLanguageService } from "./language-session"

export type FormatChange = (
  path: string,
  action: (() => Promise<void>) | null
) => void

export function useEditorFormatting(
  binding: PierreCollaboration,
  path: string,
  onFormatChange: FormatChange
) {
  const client = useLanguageService()
  useEffect(() => {
    if (!client) return
    let disposed = false
    let pending: AbortController | undefined
    const format = async () => {
      const editor = binding.editor
      if (!editor || !client.isReady || pending)
        throw new Error("Formatter is not ready.")
      const controller = new AbortController()
      pending = controller
      const version = client.version(path)
      const text = binding.document.getText()
      try {
        const edits = await client.formatting(path, controller.signal)
        if (disposed || controller.signal.aborted)
          throw new Error("Formatting was interrupted.")
        if (
          version !== client.version(path) ||
          text !== binding.document.getText()
        ) {
          throw new Error("Document changed while formatting. Try again.")
        }
        binding.undo.stopCapturing()
        try {
          editor.applyEdits(edits)
        } finally {
          binding.undo.stopCapturing()
        }
      } finally {
        pending = undefined
      }
    }
    const update = (ready: boolean) =>
      onFormatChange(path, ready ? format : null)
    const stop = client.onReadyChange(update)
    update(client.isReady)
    return () => {
      disposed = true
      pending?.abort()
      stop()
      onFormatChange(path, null)
    }
  }, [binding, client, path, onFormatChange])
}
