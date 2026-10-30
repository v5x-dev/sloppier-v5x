import { describe, expect, it } from "vitest"
import {
  MIN_GROUP_SIZE,
  activateGroup,
  bodyDropTarget,
  activateTab,
  activePathOf,
  addTab,
  closeTab,
  createLayout,
  equalizeSplit,
  groupsOf,
  layoutPaths,
  placeTab,
  readLayout,
  remapPaths,
  resizeSash,
  retainPaths,
  splitGroup,
  type EditorLayout,
  type LayoutNode,
} from "../src/lib/editor-groups"

/** Effective share of the editor for every group, in reading order. */
function leafShares(node: LayoutNode, base = 1): number[] {
  const share = base * node.size
  if (node.kind === "group") return [Number(share.toFixed(4))]
  return node.children.flatMap((child) => leafShares(child, share))
}

/** Each group's tabs and active tab, plus the active group's index and the shares. */
function shape(layout: EditorLayout) {
  const groups = groupsOf(layout)
  return {
    groups: groups.map((group) => [group.paths, group.activePath]),
    active: groups.findIndex((group) => group.id === layout.activeGroupId),
    sizes: leafShares(layout.root),
  }
}

/** Two groups side by side: the original on the left, a split duplicate on the right. */
function twoGroups(paths: string[], active: string) {
  const layout = createLayout(paths, active)
  return splitGroup(layout, layout.activeGroupId)
}

describe("editor groups", () => {
  it("opens tabs in the active group and activates them", () => {
    const layout = createLayout(["src/main.cpp"])
    const next = addTab(layout, layout.activeGroupId, "include/robot.h")
    expect(shape(next).groups).toEqual([
      [["src/main.cpp", "include/robot.h"], "include/robot.h"],
    ])
    expect(activePathOf(next)).toBe("include/robot.h")
  })

  it("activates an open tab without reordering it", () => {
    const layout = createLayout(["a.cpp", "b.cpp"], "b.cpp")
    const next = addTab(layout, layout.activeGroupId, "a.cpp")
    expect(shape(next).groups[0]).toEqual([["a.cpp", "b.cpp"], "a.cpp"])
  })

  it("reorders a tab to an index within its group", () => {
    const layout = createLayout(["a.cpp", "b.cpp", "c.cpp"])
    const next = addTab(layout, layout.activeGroupId, "c.cpp", { index: 0 })
    expect(layoutPaths(next)).toEqual(["c.cpp", "a.cpp", "b.cpp"])
    expect(activePathOf(next)).toBe("c.cpp")
  })

  it("keeps the neighbor at the same position active when the active tab closes", () => {
    const layout = createLayout(["a.cpp", "b.cpp", "c.cpp"], "b.cpp")
    const next = closeTab(layout, layout.activeGroupId, "b.cpp")
    expect(shape(next).groups[0]).toEqual([["a.cpp", "c.cpp"], "c.cpp"])
    const last = closeTab(next, next.activeGroupId, "c.cpp")
    expect(shape(last).groups[0]).toEqual([["a.cpp"], "a.cpp"])
  })

  it("splits the active file into a group on the right, duplicating it", () => {
    const layout = createLayout(["a.cpp", "b.cpp"], "a.cpp")
    const next = splitGroup(layout, layout.activeGroupId)
    expect(shape(next)).toEqual({
      groups: [
        [["a.cpp", "b.cpp"], "a.cpp"],
        [["a.cpp"], "a.cpp"],
      ],
      active: 1,
      sizes: [0.5, 0.5],
    })
  })

  it("does nothing to an empty group when splitting", () => {
    const layout = createLayout()
    expect(splitGroup(layout, layout.activeGroupId)).toBe(layout)
  })

  it("moves a tab into a new group on the side of the group it is dropped on", () => {
    const layout = createLayout(["a.cpp", "b.cpp"], "a.cpp")
    const groupId = layout.activeGroupId
    const next = placeTab(layout, "b.cpp", groupId, {
      kind: "split",
      groupId,
      side: "left",
    })
    expect(shape(next)).toEqual({
      groups: [
        [["b.cpp"], "b.cpp"],
        [["a.cpp"], "a.cpp"],
      ],
      active: 0,
      sizes: [0.5, 0.5],
    })
  })

  it("ignores splitting off the only tab of a group onto its own side", () => {
    const layout = createLayout(["a.cpp"])
    const groupId = layout.activeGroupId
    expect(
      placeTab(layout, "a.cpp", groupId, {
        kind: "split",
        groupId,
        side: "right",
      })
    ).toBe(layout)
  })

  it("closes a group emptied by a move, handing its width to the neighbor", () => {
    const layout = createLayout(["a.cpp", "b.cpp"], "a.cpp")
    const groupId = layout.activeGroupId
    const split = placeTab(layout, "b.cpp", groupId, {
      kind: "split",
      groupId,
      side: "right",
    })
    const next = placeTab(split, "b.cpp", split.activeGroupId, {
      kind: "tabs",
      groupId,
      index: 1,
    })
    expect(groupsOf(next)).toHaveLength(1)
    expect(shape(next).groups[0]).toEqual([["a.cpp", "b.cpp"], "b.cpp"])
    expect(shape(next).sizes).toEqual([1])
    expect(next.activeGroupId).toBe(groupId)
  })

  it("moves a tab between tab strips at the dropped position", () => {
    const layout = createLayout(["a.cpp", "b.cpp"], "a.cpp")
    const groupId = layout.activeGroupId
    const split = splitGroup(layout, groupId)
    const rightId = split.activeGroupId
    const next = placeTab(split, "a.cpp", groupId, {
      kind: "tabs",
      groupId: rightId,
      index: 0,
    })
    expect(shape(next).groups).toEqual([
      [["b.cpp"], "b.cpp"],
      [["a.cpp"], "a.cpp"],
    ])
    expect(next.activeGroupId).toBe(rightId)
  })

  it("moves a tab into a group's body without splitting it", () => {
    const layout = createLayout(["a.cpp"], "a.cpp")
    const groupId = layout.activeGroupId
    const split = splitGroup(layout, groupId)
    const next = placeTab(split, "a.cpp", groupId, {
      kind: "group",
      groupId: split.activeGroupId,
    })
    // The left group held only a.cpp, so it closes and the right group remains.
    expect(groupsOf(next)).toHaveLength(1)
    expect(layoutPaths(next)).toEqual(["a.cpp"])
  })

  it("opens an explorer file in a split without touching the other group", () => {
    const layout = createLayout(["a.cpp"], "a.cpp")
    const next = placeTab(layout, "b.cpp", null, {
      kind: "split",
      groupId: layout.activeGroupId,
      side: "right",
    })
    expect(shape(next).groups).toEqual([
      [["a.cpp"], "a.cpp"],
      [["b.cpp"], "b.cpp"],
    ])
  })

  it("splits a group above or below another, forming a column", () => {
    const layout = createLayout(["a.cpp", "b.cpp"], "a.cpp")
    const groupId = layout.activeGroupId
    const next = placeTab(layout, "b.cpp", groupId, {
      kind: "split",
      groupId,
      side: "bottom",
    })
    expect(next.root.kind).toBe("split")
    if (next.root.kind !== "split") throw new Error("expected a split")
    expect(next.root.axis).toBe("column")
    expect(shape(next)).toEqual({
      groups: [
        [["a.cpp"], "a.cpp"],
        [["b.cpp"], "b.cpp"],
      ],
      active: 1,
      sizes: [0.5, 0.5],
    })
  })

  it("nests a row inside a column when a group splits sideways within it", () => {
    const layout = createLayout(["a.cpp", "b.cpp", "c.cpp"], "a.cpp")
    const top = layout.activeGroupId
    const column = placeTab(layout, "b.cpp", top, {
      kind: "split",
      groupId: top,
      side: "bottom",
    })
    const bottom = column.activeGroupId
    const grid = placeTab(column, "c.cpp", null, {
      kind: "split",
      groupId: bottom,
      side: "right",
    })
    expect(grid.root.kind).toBe("split")
    if (grid.root.kind !== "split") throw new Error("expected a split")
    expect(grid.root.axis).toBe("column")
    // The top group kept a.cpp and c.cpp when b.cpp moved below it; c.cpp is also
    // duplicated to the right of the lower group.
    expect(groupsOf(grid).map((group) => group.paths)).toEqual([
      ["a.cpp", "c.cpp"],
      ["b.cpp"],
      ["c.cpp"],
    ])
    expect(shape(grid).sizes).toEqual([0.5, 0.25, 0.25])
  })

  it("collapses a column when its lower group closes", () => {
    const layout = createLayout(["a.cpp", "b.cpp"], "a.cpp")
    const top = layout.activeGroupId
    const column = placeTab(layout, "b.cpp", top, {
      kind: "split",
      groupId: top,
      side: "bottom",
    })
    const next = closeTab(column, column.activeGroupId, "b.cpp")
    expect(next.root.kind).toBe("group")
    expect(shape(next)).toEqual({
      groups: [[["a.cpp"], "a.cpp"]],
      active: 0,
      sizes: [1],
    })
  })

  it("activates a tab and its group together", () => {
    const layout = twoGroups(["a.cpp"], "a.cpp")
    const [left] = groupsOf(layout)
    const next = activateTab(layout, left.id, "a.cpp")
    expect(next.activeGroupId).toBe(left.id)
    expect(activateGroup(next, left.id)).toBe(next)
  })

  it("moves the sash within minimum sizes and evens groups out", () => {
    const layout = twoGroups(["a.cpp"], "a.cpp")
    const moved = resizeSash(layout, [], 0, 0.9)
    expect(shape(moved).sizes[0]).toBeCloseTo(1 - MIN_GROUP_SIZE)
    expect(shape(moved).sizes[1]).toBeCloseTo(MIN_GROUP_SIZE)
    const low = resizeSash(layout, [], 0, 0)
    expect(shape(low).sizes[0]).toBeCloseTo(MIN_GROUP_SIZE)
    expect(shape(equalizeSplit(moved, [])).sizes).toEqual([0.5, 0.5])
  })

  it("resizes only the sash's neighbors inside a nested split", () => {
    const layout = createLayout(["a.cpp", "b.cpp", "c.cpp"], "a.cpp")
    const top = layout.activeGroupId
    const column = placeTab(layout, "b.cpp", top, {
      kind: "split",
      groupId: top,
      side: "bottom",
    })
    const grid = placeTab(column, "c.cpp", null, {
      kind: "split",
      groupId: column.activeGroupId,
      side: "right",
    })
    // The row under the column's second child has the sash after child 0.
    const moved = resizeSash(grid, [1], 0, 0.8)
    expect(shape(moved).sizes).toEqual([0.5, 0.4, 0.1])
  })

  it("renames tabs and drops deleted ones across groups", () => {
    const layout = twoGroups(["a.cpp", "b.cpp"], "b.cpp")
    const renamed = remapPaths(layout, (path) =>
      path === "a.cpp" ? "src/a.cpp" : path === "b.cpp" ? null : path
    )
    // The right group held only b.cpp, so it closes once that file is deleted.
    expect(shape(renamed).groups).toEqual([[["src/a.cpp"], "src/a.cpp"]])
  })

  it("keeps the group's neighbor tab active when its active tab is deleted", () => {
    const layout = createLayout(["a.cpp", "b.cpp", "c.cpp"], "b.cpp")
    const next = retainPaths(layout, (path) => path !== "b.cpp")
    expect(activePathOf(next)).toBe("c.cpp")
  })

  it("keeps the layout when every tab in it is deleted", () => {
    const layout = createLayout(["a.cpp"], "a.cpp")
    const next = retainPaths(layout, () => false)
    expect(groupsOf(next)).toHaveLength(1)
    expect(activePathOf(next)).toBeNull()
  })

  it("reads a saved layout and drops unknown or empty state", () => {
    const saved = {
      root: {
        kind: "split",
        axis: "row",
        size: 1,
        children: [
          {
            kind: "group",
            size: 1,
            group: {
              id: "left",
              paths: ["a.cpp", "a.cpp", "b.cpp"],
              activePath: "gone",
            },
          },
          {
            kind: "group",
            size: 1,
            group: { id: "right", paths: [], activePath: null },
          },
        ],
      },
      activeGroupId: "left",
    }
    expect(readLayout(saved)).toEqual({
      root: {
        kind: "group",
        size: 1,
        group: { id: "left", paths: ["a.cpp", "b.cpp"], activePath: "b.cpp" },
      },
      activeGroupId: "left",
    })
    expect(readLayout({ root: null, activeGroupId: "x" })).toBeNull()
    expect(readLayout("tabs")).toBeNull()
    expect(
      readLayout({
        root: {
          kind: "split",
          axis: "diagonal",
          size: 1,
          children: [],
        },
        activeGroupId: "x",
      })
    ).toBeNull()
  })
})

describe("body drop zones", () => {
  it("drops into the group across its inner 80%", () => {
    expect(bodyDropTarget("g", 0.5, 0.5)).toEqual({
      kind: "group",
      groupId: "g",
    })
    expect(bodyDropTarget("g", 0.15, 0.85)).toEqual({
      kind: "group",
      groupId: "g",
    })
  })

  it("splits on the outer thirds of the sides", () => {
    expect(bodyDropTarget("g", 0.05, 0.5)).toEqual({
      kind: "split",
      groupId: "g",
      side: "left",
    })
    expect(bodyDropTarget("g", 0.95, 0.5)).toEqual({
      kind: "split",
      groupId: "g",
      side: "right",
    })
    // Along the top band, the side zones take the outer thirds before the halves.
    expect(bodyDropTarget("g", 0.2, 0.05)).toMatchObject({ side: "left" })
  })

  it("splits on the halves of the top and bottom bands", () => {
    expect(bodyDropTarget("g", 0.5, 0.05)).toMatchObject({ side: "top" })
    expect(bodyDropTarget("g", 0.5, 0.95)).toMatchObject({ side: "bottom" })
  })

  it("drops into the group instead of splitting when splitting is off", () => {
    expect(bodyDropTarget("g", 0.02, 0.5, false)).toEqual({
      kind: "group",
      groupId: "g",
    })
  })
})
