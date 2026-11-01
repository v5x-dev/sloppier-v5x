import type { FormatChange } from "@/components/editor/editor-formatting"
import {
  focusGroupEditor,
  neighborGroupId,
} from "@/components/program/workbench-focus"
import { groupsOf } from "@/lib/editor-groups"
import { toast } from "@v5x/ui/components/toast"

import { waitForSourceSync } from "@/lib/build-program"
import { commitFormattedSource } from "@/lib/commit-formatted-source"
import { errorMessage } from "@/lib/errors"
import type { WorkbenchSource } from "@/lib/workbench-source"
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react"

export function useWorkbenchCommands({
  source,
  activePath,
  layout,
  dirtyPaths,
  headSha,
}: {
  source: WorkbenchSource
  activePath: string | null
  layout: ReturnType<WorkbenchSource["getSnapshot"]>["layout"]
  dirtyPaths: string[]
  headSha?: string
}) {
  const { activateTab, activateGroup, splitGroup } = source
  const [formatActions, setFormatActions] = useState<
    Record<string, (() => Promise<void>) | null>
  >({})
  const formatActionsRef = useRef(formatActions)
  const onFormatChange = useCallback<FormatChange>((path, action) => {
    formatActionsRef.current = { ...formatActionsRef.current, [path]: action }
    setFormatActions((current) => ({ ...current, [path]: action }))
  }, [])
  const formatManually = (path: string) => {
    void formatActionsRef.current[path]?.().catch((error) =>
      toast.add({
        type: "error",
        title: "Could not format document",
        description: errorMessage(error),
      })
    )
  }
  const commitFormatted = async (
    message: string | undefined,
    signal: AbortSignal
  ) => {
    await commitFormattedSource(
      source,
      () => formatActionsRef.current,
      message,
      signal
    )
  }
  const formatFromKeyboard = useEffectEvent((event: KeyboardEvent) => {
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      event.shiftKey ||
      event.isComposing ||
      event.key.toLowerCase() !== "p"
    )
      return
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat && activePath) formatManually(activePath)
  })
  const [commitOpen, setCommitOpen] = useState(false)
  const commitLabel = `Commit ${dirtyPaths.length} ${dirtyPaths.length === 1 ? "file" : "files"}`
  const savePending = useRef(false)
  useEffect(() => {
    void source.refreshRepository()
  }, [source, headSha])

  const saveFromKeyboard = useEffectEvent(
    (event: KeyboardEvent, signal: AbortSignal) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing ||
        event.key.toLowerCase() !== "s"
      )
        return
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat || savePending.current) return
      if (source.getSnapshot().dirtyPaths.length === 0) return
      savePending.current = true
      void (async () => {
        try {
          await waitForSourceSync(source.isSynced, signal)
          signal.throwIfAborted()
          await commitFormatted(undefined, signal)
          if (!signal.aborted)
            toast.add({ type: "success", title: "Changes committed" })
        } catch (error) {
          if (!signal.aborted)
            toast.add({
              type: "error",
              title: "Could not commit",
              description: errorMessage(error),
            })
        } finally {
          savePending.current = false
        }
      })()
    }
  )

  const splitFromKeyboard = useEffectEvent((event: KeyboardEvent) => {
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      event.shiftKey ||
      event.isComposing ||
      event.key !== "\\"
    )
      return
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat) splitGroup(layout.activeGroupId)
  })

  // VS Code's group focus chord: Ctrl/Cmd+K, then Ctrl/Cmd+Arrow moves focus to the
  // neighboring group. The chord expires after a short pause.
  const chordStartedAt = useRef(0)
  const focusGroupFromKeyboard = useEffectEvent((event: KeyboardEvent) => {
    // Pressing the modifier itself between the chord's keys must not cancel the chord.
    if (MODIFIER_KEYS.has(event.key)) return
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      event.shiftKey ||
      event.isComposing
    )
      return
    // Ctrl/Cmd+1 to 8 focus that group; Ctrl/Cmd+9 focuses the last tab of the active group.
    if (/^[1-9]$/.test(event.key)) {
      event.preventDefault()
      event.stopPropagation()
      const digit = Number(event.key)
      if (digit === 9) {
        const active = groupsOf(layout).find(
          (group) => group.id === layout.activeGroupId
        )
        const last = active?.paths.at(-1)
        if (active && last) activateTab(active.id, last)
        requestAnimationFrame(() => focusGroupEditor(layout.activeGroupId))
        return
      }
      const target = groupsOf(layout).at(digit - 1)
      if (!target) return
      activateGroup(target.id)
      requestAnimationFrame(() => focusGroupEditor(target.id))
      return
    }
    const chordOpen = Date.now() - chordStartedAt.current < CHORD_TIMEOUT_MS
    if (!chordOpen) {
      if (event.key.toLowerCase() !== "k") return
      event.preventDefault()
      event.stopPropagation()
      chordStartedAt.current = Date.now()
      return
    }
    chordStartedAt.current = 0
    const direction = GROUP_FOCUS_KEYS[event.key]
    if (!direction) return
    event.preventDefault()
    event.stopPropagation()
    const next = neighborGroupId(layout.activeGroupId, direction)
    if (!next) return
    activateGroup(next)
    focusGroupEditor(next)
  })

  // One capture listener serves the workbench shortcuts; each ignores keys it does not own.
  useEffect(() => {
    const controller = new AbortController()
    const onKeyDown = (event: KeyboardEvent) => {
      formatFromKeyboard(event)
      saveFromKeyboard(event, controller.signal)
      splitFromKeyboard(event)
      focusGroupFromKeyboard(event)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => {
      controller.abort()
      window.removeEventListener("keydown", onKeyDown, true)
    }
  }, [])

  return {
    formatActions,
    onFormatChange,
    formatManually,
    commitFormatted,
    commitOpen,
    setCommitOpen,
    commitLabel,
  }
}

const CHORD_TIMEOUT_MS = 2000
const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "Shift"])
const GROUP_FOCUS_KEYS: Partial<
  Record<string, "left" | "right" | "up" | "down">
> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
}
