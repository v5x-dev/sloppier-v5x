/**
 * Editor groups are tab strips arranged in a grid, as in VS Code: a tree of rows
 * and columns whose leaves are groups. A file can be open in more than one group,
 * and each group keeps its own tab order and active tab. Functions here are pure,
 * so the workbench and the source apply the same rules.
 */

export type EditorGroup = {
  id: string
  /** Open tabs, left to right. A path appears at most once per group. */
  paths: string[]
  activePath: string | null
}

/** A group leaf, or a split that arranges its children along one axis. */
export type LayoutNode =
  | { kind: "group"; group: EditorGroup; size: number }
  | {
      kind: "split"
      axis: "row" | "column"
      children: LayoutNode[]
      size: number
    }

export type EditorLayout = {
  root: LayoutNode
  activeGroupId: string
}

/** Where a tab lands: a position in a tab strip, a group's body, or a new group beside one. */
export type DropTarget =
  | { kind: "tabs"; groupId: string; index?: number }
  | { kind: "group"; groupId: string }
  | {
      kind: "split"
      groupId: string
      side: "left" | "right" | "top" | "bottom"
    }

/** Smallest share a group keeps while its sash is dragged. */
export const MIN_GROUP_SIZE = 0.15

const newGroupId = () => crypto.randomUUID()
const unique = <T>(values: T[]) => [...new Set(values)]

export function createLayout(
  paths: string[] = [],
  activePath: string | null = paths.at(-1) ?? null
): EditorLayout {
  const id = newGroupId()
  return {
    root: {
      kind: "group",
      group: { id, paths: unique(paths), activePath },
      size: 1,
    },
    activeGroupId: id,
  }
}

/** Every group in the layout, in reading order. */
export function groupsOf(layout: EditorLayout): EditorGroup[] {
  const groups: EditorGroup[] = []
  const visit = (node: LayoutNode) => {
    if (node.kind === "group") groups.push(node.group)
    else node.children.forEach(visit)
  }
  visit(layout.root)
  return groups
}

/** Reads a saved layout, returning null when the stored value is not one. */
export function readLayout(value: unknown): EditorLayout | null {
  if (!isRecord(value) || typeof value.activeGroupId !== "string") return null
  const root = readNode(value.root)
  if (!root) return null
  const ids = groupsOf({ root, activeGroupId: "" }).map((group) => group.id)
  if (new Set(ids).size !== ids.length) return null
  return pruneEmptyGroups({
    root,
    activeGroupId: ids.includes(value.activeGroupId)
      ? value.activeGroupId
      : ids[0],
  })
}

export function layoutPaths(layout: EditorLayout): string[] {
  return unique(groupsOf(layout).flatMap((group) => group.paths))
}

export function activePathOf(layout: EditorLayout): string | null {
  return findGroup(layout, layout.activeGroupId)?.activePath ?? null
}

/**
 * Where a file dropped on a group's body lands, as VS Code decides it. The inner
 * 80% of the body drops into the group. The border band splits on the outer
 * thirds of the sides and on the halves of the top and bottom. Turning splitting
 * off (Alt, or Shift on macOS, while dragging) always drops into the group.
 * `fx` and `fy` are the pointer's position across the body, from 0 to 1.
 */
export function bodyDropTarget(
  groupId: string,
  fx: number,
  fy: number,
  splitting = true
): DropTarget {
  const inside = fx > 0.1 && fx < 0.9 && fy > 0.1 && fy < 0.9
  if (!splitting || inside) return { kind: "group", groupId }
  if (fx < 1 / 3) return { kind: "split", groupId, side: "left" }
  if (fx > 2 / 3) return { kind: "split", groupId, side: "right" }
  return { kind: "split", groupId, side: fy < 0.5 ? "top" : "bottom" }
}

/** Opens a path in a group. Without an index, an open path is only activated. */
export function addTab(
  layout: EditorLayout,
  groupId: string,
  path: string,
  options: { index?: number; activate?: boolean } = {}
): EditorLayout {
  const group = findGroup(layout, groupId)
  if (!group) return layout
  let paths = group.paths
  if (options.index !== undefined) {
    paths = paths.filter((entry) => entry !== path)
    paths.splice(Math.min(Math.max(options.index, 0), paths.length), 0, path)
  } else if (!paths.includes(path)) {
    paths = [...paths, path]
  }
  const activate = options.activate ?? true
  return {
    root: mapGroup(layout.root, groupId, (entry) => ({
      ...entry,
      paths,
      activePath: activate ? path : entry.activePath,
    })),
    activeGroupId: activate ? groupId : layout.activeGroupId,
  }
}

export function activateTab(
  layout: EditorLayout,
  groupId: string,
  path: string
): EditorLayout {
  const group = findGroup(layout, groupId)
  if (!group?.paths.includes(path)) return layout
  return {
    root: mapGroup(layout.root, groupId, (entry) => ({
      ...entry,
      activePath: path,
    })),
    activeGroupId: groupId,
  }
}

export function activateGroup(
  layout: EditorLayout,
  groupId: string
): EditorLayout {
  if (layout.activeGroupId === groupId || !findGroup(layout, groupId))
    return layout
  return { ...layout, activeGroupId: groupId }
}

/** Closes one tab. A group left without tabs closes too, unless it is the last one. */
export function closeTab(
  layout: EditorLayout,
  groupId: string,
  path: string
): EditorLayout {
  const group = findGroup(layout, groupId)
  if (!group?.paths.includes(path)) return layout
  const index = group.paths.indexOf(path)
  const paths = group.paths.filter((entry) => entry !== path)
  if (paths.length === 0 && groupsOf(layout).length > 1)
    return removeGroup(layout, groupId)
  return {
    ...layout,
    root: mapGroup(layout.root, groupId, (entry) => ({
      ...entry,
      paths,
      activePath:
        entry.activePath === path
          ? (paths.at(index) ?? paths.at(-1) ?? null)
          : entry.activePath,
    })),
  }
}

/**
 * Moves a tab from its group (or opens a file from the explorer when `from` is
 * null) to a drop target. Splitting off the only tab of a group does nothing.
 */
export function placeTab(
  layout: EditorLayout,
  path: string,
  from: string | null,
  target: DropTarget
): EditorLayout {
  if (target.kind === "group")
    return placeTab(layout, path, from, {
      kind: "tabs",
      groupId: target.groupId,
    })
  if (target.kind === "tabs") {
    const moved =
      from && from !== target.groupId ? closeTab(layout, from, path) : layout
    return addTab(moved, target.groupId, path, { index: target.index })
  }
  const host = findGroup(layout, target.groupId)
  if (!host) return layout
  if (from === target.groupId && host.paths.length === 1) return layout
  const next = from ? closeTab(layout, from, path) : layout
  const created: EditorGroup = {
    id: newGroupId(),
    paths: [path],
    activePath: path,
  }
  return {
    root: insertBeside(next.root, target.groupId, target.side, created),
    activeGroupId: created.id,
  }
}

/** Opens the active tab of a group in a new group on its right. */
export function splitGroup(
  layout: EditorLayout,
  groupId: string
): EditorLayout {
  const group = findGroup(layout, groupId)
  if (!group?.activePath) return layout
  return placeTab(layout, group.activePath, null, {
    kind: "split",
    groupId,
    side: "right",
  })
}

/**
 * Moves the sash after child `index` of the split at `path` (child indices from
 * the root). `position` is that sash's share of the split's extent.
 */
export function resizeSash(
  layout: EditorLayout,
  path: number[],
  index: number,
  position: number
): EditorLayout {
  return {
    ...layout,
    root: updateSplit(layout.root, path, (split) => {
      const left = split.children.at(index)
      const right = split.children.at(index + 1)
      if (!left || !right) return split
      const start = split.children
        .slice(0, index)
        .reduce((total, child) => total + child.size, 0)
      const end = start + left.size + right.size
      const boundary = Math.min(
        Math.max(position, start + MIN_GROUP_SIZE),
        end - MIN_GROUP_SIZE
      )
      return {
        ...split,
        children: split.children.map((child, entry) =>
          entry === index
            ? { ...child, size: boundary - start }
            : entry === index + 1
              ? { ...child, size: end - boundary }
              : child
        ),
      }
    }),
  }
}

/** Gives every child of the split at `path` the same share. */
export function equalizeSplit(
  layout: EditorLayout,
  path: number[]
): EditorLayout {
  return {
    ...layout,
    root: updateSplit(layout.root, path, (split) => ({
      ...split,
      children: split.children.map((child) => ({
        ...child,
        size: 1 / split.children.length,
      })),
    })),
  }
}

/**
 * Renames, removes, or keeps open paths in every group. Returning null drops the
 * tab. Groups left without tabs close, and a removed active tab falls back to the
 * neighbor at its position.
 */
export function remapPaths(
  layout: EditorLayout,
  map: (path: string) => string | null
): EditorLayout {
  const root = mapAllGroups(layout.root, (group) => {
    const kept = group.paths.flatMap((path) => {
      const next = map(path)
      return next === null ? [] : [next]
    })
    const paths = unique(kept)
    const mappedActive = group.activePath && map(group.activePath)
    const activeIndex = group.activePath
      ? group.paths
          .slice(0, group.paths.indexOf(group.activePath))
          .filter((path) => map(path) !== null).length
      : 0
    const activePath =
      mappedActive && paths.includes(mappedActive)
        ? mappedActive
        : (paths.at(activeIndex) ?? paths.at(-1) ?? null)
    return { ...group, paths, activePath }
  })
  return pruneEmptyGroups({ root, activeGroupId: layout.activeGroupId })
}

export function retainPaths(
  layout: EditorLayout,
  keep: (path: string) => boolean
): EditorLayout {
  return remapPaths(layout, (path) => (keep(path) ? path : null))
}

function pruneEmptyGroups(layout: EditorLayout): EditorLayout {
  let next = layout
  for (const group of groupsOf(layout))
    if (group.paths.length === 0 && groupsOf(next).length > 1)
      next = removeGroup(next, group.id)
  return next
}

function removeGroup(layout: EditorLayout, groupId: string): EditorLayout {
  const order = groupsOf(layout).map((group) => group.id)
  const index = order.indexOf(groupId)
  if (index < 0) return layout
  const root = withoutGroup(layout.root, groupId)
  if (!root) return layout
  // Focus moves to the group before the removed one, or the one after it.
  const activeGroupId =
    layout.activeGroupId === groupId
      ? (order[index - 1] ?? order[index + 1])
      : layout.activeGroupId
  return { root, activeGroupId }
}

/** Removes a group from a subtree. The space it held goes to its neighbor in the split. */
function withoutGroup(node: LayoutNode, groupId: string): LayoutNode | null {
  if (node.kind === "group") return node.group.id === groupId ? null : node
  const results = node.children.map((child) => withoutGroup(child, groupId))
  const removed = results.findIndex((result) => result === null)
  if (removed < 0) return { ...node, children: results as LayoutNode[] }
  const size = node.children[removed].size
  // The previous sibling takes the space; the first sibling hands it to the next one.
  const receiver = removed > 0 ? removed - 1 : 0
  const children = results
    .filter((result): result is LayoutNode => result !== null)
    .map((child, entry) =>
      entry === receiver ? { ...child, size: child.size + size } : child
    )
  if (children.length === 1) return { ...children[0], size: node.size }
  return { ...node, children }
}

/** Replaces a group with a split, or adds it beside the group inside a split on the same axis. */
function insertBeside(
  node: LayoutNode,
  groupId: string,
  side: "left" | "right" | "top" | "bottom",
  created: EditorGroup
): LayoutNode {
  const axis = side === "left" || side === "right" ? "row" : "column"
  const before = side === "left" || side === "top"
  if (node.kind === "group") {
    if (node.group.id !== groupId) return node
    // The new split's children share its extent equally.
    const hosted = { ...node, size: 0.5 }
    const fresh: LayoutNode = { kind: "group", group: created, size: 0.5 }
    return {
      kind: "split",
      axis,
      size: node.size,
      children: before ? [fresh, hosted] : [hosted, fresh],
    }
  }
  const index = node.children.findIndex((child) =>
    containsGroup(child, groupId)
  )
  if (index < 0) return node
  const child = node.children[index]
  if (
    node.axis === axis &&
    child.kind === "group" &&
    child.group.id === groupId
  ) {
    const hosted = { ...child, size: child.size / 2 }
    const fresh: LayoutNode = {
      kind: "group",
      group: created,
      size: child.size / 2,
    }
    const pair = before ? [fresh, hosted] : [hosted, fresh]
    return {
      ...node,
      children: [
        ...node.children.slice(0, index),
        ...pair,
        ...node.children.slice(index + 1),
      ],
    }
  }
  return {
    ...node,
    children: node.children.map((entry, position) =>
      position === index ? insertBeside(entry, groupId, side, created) : entry
    ),
  }
}

function readNode(value: unknown): LayoutNode | null {
  if (!isRecord(value)) return null
  const size = typeof value.size === "number" && value.size > 0 ? value.size : 1
  if (value.kind === "group") {
    const group = value.group
    if (
      !isRecord(group) ||
      typeof group.id !== "string" ||
      !Array.isArray(group.paths) ||
      !group.paths.every((path) => typeof path === "string")
    )
      return null
    const paths = unique(group.paths)
    const activePath =
      typeof group.activePath === "string" && paths.includes(group.activePath)
        ? group.activePath
        : (paths.at(-1) ?? null)
    return {
      kind: "group",
      group: { id: group.id, paths, activePath },
      size,
    }
  }
  if (
    value.kind === "split" &&
    (value.axis === "row" || value.axis === "column") &&
    Array.isArray(value.children) &&
    value.children.length > 0
  ) {
    const children = value.children.map(readNode)
    if (children.some((child) => child === null)) return null
    return normalizeSplit({
      kind: "split",
      axis: value.axis,
      children: children as LayoutNode[],
      size,
    })
  }
  return null
}

/** Scales the children of a split to sum to 1, and collapses a split with one child. */
function normalizeSplit(split: LayoutNode & { kind: "split" }): LayoutNode {
  if (split.children.length === 1)
    return { ...split.children[0], size: split.size }
  const total = split.children.reduce((sum, child) => sum + child.size, 0)
  return {
    ...split,
    children: split.children.map((child) => ({
      ...child,
      size: child.size / total,
    })),
  }
}

function updateSplit(
  node: LayoutNode,
  path: number[],
  update: (
    split: LayoutNode & { kind: "split" }
  ) => LayoutNode & { kind: "split" }
): LayoutNode {
  if (node.kind === "group") return node
  if (path.length === 0) return update(node)
  const [head, ...rest] = path
  return {
    ...node,
    children: node.children.map((child, index) =>
      index === head ? updateSplit(child, rest, update) : child
    ),
  }
}

function mapGroup(
  node: LayoutNode,
  groupId: string,
  update: (group: EditorGroup) => EditorGroup
): LayoutNode {
  if (node.kind === "group")
    return node.group.id === groupId
      ? { ...node, group: update(node.group) }
      : node
  return {
    ...node,
    children: node.children.map((child) => mapGroup(child, groupId, update)),
  }
}

function mapAllGroups(
  node: LayoutNode,
  update: (group: EditorGroup) => EditorGroup
): LayoutNode {
  if (node.kind === "group") return { ...node, group: update(node.group) }
  return {
    ...node,
    children: node.children.map((child) => mapAllGroups(child, update)),
  }
}

function containsGroup(node: LayoutNode, groupId: string): boolean {
  return node.kind === "group"
    ? node.group.id === groupId
    : node.children.some((child) => containsGroup(child, groupId))
}

function findGroup(layout: EditorLayout, groupId: string) {
  return groupsOf(layout).find((group) => group.id === groupId)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
