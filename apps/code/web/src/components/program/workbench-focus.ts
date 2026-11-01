/**
 * The group that sits beside a group in a direction. Like VS Code, it prefers the
 * nearest group whose extent overlaps the current group on the perpendicular axis.
 */
export function neighborGroupId(
  groupId: string,
  direction: "left" | "right" | "up" | "down"
): string | null {
  const panes = [
    ...document.querySelectorAll<HTMLElement>("[data-editor-group]"),
  ]
  const current = panes
    .find((pane) => pane.dataset.editorGroup === groupId)
    ?.getBoundingClientRect()
  if (!current) return null
  let best: { id: string; gap: number } | null = null
  for (const pane of panes) {
    const id = pane.dataset.editorGroup ?? ""
    if (id === groupId) continue
    const rect = pane.getBoundingClientRect()
    const overlapsX = rect.left < current.right && rect.right > current.left
    const overlapsY = rect.top < current.bottom && rect.bottom > current.top
    const gap =
      direction === "left"
        ? current.left - rect.right
        : direction === "right"
          ? rect.left - current.right
          : direction === "up"
            ? current.top - rect.bottom
            : rect.top - current.bottom
    const beside =
      direction === "left" || direction === "right" ? overlapsY : overlapsX
    if (!beside || gap < -1) continue
    if (!best || gap < best.gap) best = { id, gap }
  }
  return best?.id ?? null
}

/** Focuses the visible editor of a group, so keystrokes go to that group. */
export function focusGroupEditor(groupId: string) {
  const panel = document.querySelector<HTMLElement>(
    `[data-editor-group="${groupId}"] [data-editor-body] [role="tabpanel"]:not([hidden])`
  )
  if (panel) findInShadowTree(panel, '[role="textbox"]')?.focus()
}

/** The first match in a tree, looking through the shadow roots of the editor's elements. */
function findInShadowTree(
  root: ParentNode,
  selector: string
): HTMLElement | null {
  const match = root.querySelector<HTMLElement>(selector)
  if (match) return match
  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    const inner =
      element.shadowRoot && findInShadowTree(element.shadowRoot, selector)
    if (inner) return inner
  }
  return null
}
