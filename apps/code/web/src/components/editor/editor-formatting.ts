import { useEffect } from "react"
import type { PierreCollaboration } from "@/lib/pierre-collaboration"
import { RequestCancelled } from "@/lib/language-service"
import { errorMessage } from "@/lib/errors"
import { toast } from "@workspace/ui/components/toast"
import { useLanguageService } from "./language-session"

export type FormatChange = (path: string, action: (() => void) | null) => void

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
      if (!editor || !client.isReady || pending) return
      const controller = new AbortController()
      pending = controller
      const version = client.version(path)
      const text = binding.document.getText()
      try {
        const edits = await client.formatting(path, controller.signal)
        if (disposed || controller.signal.aborted) return
        if (
          version !== client.version(path) ||
          text !== binding.document.getText()
        ) {
          toast.add({
            type: "info",
            title: "Document changed. Try formatting again.",
          })
          return
        }
        binding.undo.stopCapturing()
        try {
          editor.applyEdits(edits)
        } finally {
          binding.undo.stopCapturing()
        }
      } catch (error) {
        if (!disposed && !(error instanceof RequestCancelled))
          toast.add({
            type: "error",
            title: "Could not format document",
            description: errorMessage(error),
          })
      } finally {
        pending = undefined
      }
    }
    const update = (ready: boolean) =>
      onFormatChange(path, ready ? () => void format() : null)
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
