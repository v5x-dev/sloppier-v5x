import type { Active } from "@dnd-kit/core"
import { bodyDropTarget, type DropTarget } from "@/lib/editor-groups"

export type DragSource = { path: string; groupId: string | null }
export type DropHighlight = { target: DropTarget; beforePath: string | null }
export function dragSourceOf(active: Active): DragSource {
  const data = active.data.current
  return {
    path: String(data?.path),
    groupId: data?.sortable ? String(data.sortable.containerId) : null,
  }
}

/**
 * Splitting is on by default. Like VS Code, holding Alt (Shift on macOS) drops
 * into the group instead.
 */
export function splitsOnDrop(event: { altKey: boolean; shiftKey: boolean }) {
  const apple = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
  return !(apple ? event.shiftKey : event.altKey)
}

/**
 * The drop zone under the pointer, as VS Code offers it: a tab strip inserts at a
 * position, the outer band of a group's body splits it on the nearest side, and
 * the middle moves the file into that group. `sameStripIndex` sets the position inside the dragged
 * tab's own strip, where the sortable tracks the pointer instead.
 */
export function dropAt(
  x: number,
  y: number,
  drag: DragSource,
  sameStripIndex?: number,
  splitting = true
): DropHighlight | null {
  for (const pane of document.querySelectorAll<HTMLElement>(
    "[data-editor-group]"
  )) {
    const rect = pane.getBoundingClientRect()
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)
      continue
    const groupId = pane.dataset.editorGroup ?? ""
    const strip = pane.querySelector<HTMLElement>("[data-editor-tabs]")
    if (strip && y <= strip.getBoundingClientRect().bottom) {
      if (groupId === drag.groupId)
        return sameStripIndex === undefined
          ? null
          : {
              target: { kind: "tabs", groupId, index: sameStripIndex },
              beforePath: null,
            }
      const others = [
        ...strip.querySelectorAll<HTMLElement>("[data-tab-path]"),
      ].filter((tab) => tab.dataset.tabPath !== drag.path)
      const after = others.find((tab) => {
        const tabRect = tab.getBoundingClientRect()
        return x < tabRect.left + tabRect.width / 2
      })
      return {
        target: {
          kind: "tabs",
          groupId,
          index: after ? others.indexOf(after) : others.length,
        },
        beforePath: after?.dataset.tabPath ?? null,
      }
    }
    const body =
      pane
        .querySelector<HTMLElement>("[data-editor-body]")
        ?.getBoundingClientRect() ?? rect
    const target = bodyDropTarget(
      groupId,
      (x - body.left) / body.width,
      (y - body.top) / body.height,
      splitting
    )
    return { target, beforePath: null }
  }
  return null
}
