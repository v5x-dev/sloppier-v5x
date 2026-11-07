import type { FormatChange } from "@/components/editor/editor-formatting"
import { adjacentTab, hotkeys } from "@/components/program/workbench-shortcuts"
import {
  focusGroupEditor,
  neighborGroupId,
} from "@/components/program/workbench-focus"
import { groupsOf } from "@/lib/editor-groups"
import { toast } from "@v5x/ui/components/toast"
import { useHotkey, useHotkeys } from "@tanstack/react-hotkeys"

import { waitForSourceSync } from "@/lib/build-program"
import {
  commitFormattedSource,
  type FormatRegistry,
} from "@/lib/commit-formatted-source"
import { errorMessage } from "@/lib/errors"
import type { WorkbenchSource } from "@/lib/workbench-source"
import { useCallback, useEffect, useRef, useState } from "react"

export function useWorkbenchCommands({
  source,
  layout,
  dirtyPaths,
  headSha,
}: {
  source: WorkbenchSource
  layout: ReturnType<WorkbenchSource["getSnapshot"]>["layout"]
  dirtyPaths: string[]
  headSha?: string
}) {
  const { activateTab, activateGroup, splitGroup } = source
  const [formatActions, setFormatActions] = useState<
    Record<string, (() => Promise<void>) | null>
  >({})
  const formatActionsRef = useRef(formatActions)
  const formatListeners = useRef(new Set<() => void>())
  const onFormatChange = useCallback<FormatChange>((path, action) => {
    formatActionsRef.current = { ...formatActionsRef.current, [path]: action }
    setFormatActions((current) => ({ ...current, [path]: action }))
    for (const listener of formatListeners.current) listener()
  }, [])
  const formatRegistry: FormatRegistry = {
    get: () => formatActionsRef.current,
    subscribe: (listener) => {
      formatListeners.current.add(listener)
      return () => {
        formatListeners.current.delete(listener)
      }
    },
  }
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
    await commitFormattedSource(source, formatRegistry, message, signal)
  }
  const [commitOpen, setCommitOpen] = useState(false)
  const commitLabel = `Commit ${dirtyPaths.length} ${dirtyPaths.length === 1 ? "file" : "files"}`
  const savePending = useRef(false)
  // Commits started from the keyboard stop when the workbench unmounts.
  const lifetime = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => controller.abort()
  }, [])
  useEffect(() => {
    void source.refreshRepository()
  }, [source, headSha])

  const commitFromKeyboard = () => {
    const signal = lifetime.current?.signal
    if (!signal || savePending.current) return
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

  useHotkey(hotkeys.commitSource, commitFromKeyboard, { capture: true })
  // Shift/Alt chords count as typing by default, so this one must also fire inside the editor.
  useHotkey(
    hotkeys.formatDocument,
    () => {
      const path = source.getSnapshot().activePath
      if (path) formatManually(path)
    },
    { capture: true, ignoreInputs: false }
  )
  useHotkey(hotkeys.splitEditor, () => splitGroup(layout.activeGroupId), {
    capture: true,
  })

  const groups = groupsOf(layout)
  const activeGroup = groups.find((group) => group.id === layout.activeGroupId)
  const focusGroup = (groupId: string) => {
    activateGroup(groupId)
    requestAnimationFrame(() => focusGroupEditor(groupId))
  }
  const moveGroupFocus = (direction: "left" | "right" | "up" | "down") => {
    const next = neighborGroupId(layout.activeGroupId, direction)
    if (next) focusGroup(next)
  }
  const cycleTab = (step: 1 | -1) => {
    const next = activeGroup
      ? adjacentTab(activeGroup.paths, activeGroup.activePath, step)
      : null
    if (activeGroup && next) activateTab(activeGroup.id, next)
  }
  // Mod+K, then 1 to 8 focuses that group, and Mod+K, then 9 focuses the last tab.
  // Chords, because browsers reserve Ctrl+1 to 9 for switching tabs.
  const groupDigits = (["1", "2", "3", "4", "5", "6", "7", "8"] as const).map(
    (digit) => ["Mod+K", digit] as const
  )
  useHotkeys(
    [
      ...groupDigits.map((hotkey, index) => ({
        hotkey,
        callback: () => {
          const target = groups.at(index)
          if (target) focusGroup(target.id)
        },
      })),
      {
        hotkey: hotkeys.focusLastTab,
        callback: () => {
          const last = activeGroup?.paths.at(-1)
          if (activeGroup && last) activateTab(activeGroup.id, last)
          requestAnimationFrame(() => focusGroupEditor(layout.activeGroupId))
        },
      },
      {
        hotkey: hotkeys.focusGroupLeft,
        callback: () => moveGroupFocus("left"),
      },
      {
        hotkey: hotkeys.focusGroupRight,
        callback: () => moveGroupFocus("right"),
      },
      {
        hotkey: hotkeys.focusGroupUp,
        callback: () => moveGroupFocus("up"),
      },
      {
        hotkey: hotkeys.focusGroupDown,
        callback: () => moveGroupFocus("down"),
      },
      { hotkey: hotkeys.previousTab, callback: () => cycleTab(-1) },
      { hotkey: hotkeys.nextTab, callback: () => cycleTab(1) },
    ],
    { capture: true }
  )

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
