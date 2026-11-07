import { groupsOf } from "@/lib/editor-groups"
import {
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import {
  dragSourceOf,
  dropAt,
  splitsOnDrop,
  type DragSource,
  type DropHighlight,
} from "./workbench-drop"

import type { WorkbenchSource } from "@/lib/workbench-source"
import { useCallback, useEffect, useRef, useState } from "react"

/** The drag in progress. A tree drag also tracks the pointer, which draws the preview. */
type Drag =
  | { kind: "none" }
  | { kind: "tab"; source: DragSource; highlight: DropHighlight | null }
  | {
      kind: "tree"
      source: DragSource
      position: { x: number; y: number }
      highlight: DropHighlight | null
    }

export function useWorkbenchDrag(
  source: WorkbenchSource,
  layout: ReturnType<WorkbenchSource["getSnapshot"]>["layout"]
) {
  const { placeTab } = source
  const stopTreeDrag = useRef<(() => void) | null>(null)
  useEffect(() => () => stopTreeDrag.current?.(), [])
  // dnd-kit's move events carry no modifier keys, so the latest pointer's are kept here.
  const dragModifiers = useRef({ altKey: false, shiftKey: false })
  useEffect(() => {
    const track = (event: PointerEvent) => {
      dragModifiers.current = { altKey: event.altKey, shiftKey: event.shiftKey }
    }
    window.addEventListener("pointermove", track, true)
    return () => window.removeEventListener("pointermove", track, true)
  }, [])
  // One drag at a time: a tab dragged by dnd-kit, or a file dragged from the explorer. Each carries what it drops and
  // the zone it would drop into, so the drag preview and the drop target always agree.
  const [dragState, setDragState] = useState<Drag>({ kind: "none" })
  const drag = dragState.kind === "none" ? null : dragState.source
  const treeDragPosition = dragState.kind === "tree" ? dragState.position : null
  const dropHighlight = dragState.kind === "none" ? null : dragState.highlight
  // Explorer drags use window pointer events, because the tree handles its own
  // pointer input. A press is only a click until the pointer travels past the threshold.
  const beginFileDrag = (path: string, event: React.PointerEvent) => {
    stopTreeDrag.current?.()
    const dragged: DragSource = { path, groupId: null }
    const startX = event.clientX,
      startY = event.clientY
    let phase: "pressed" | "dragging" = "pressed"
    const move = (e: PointerEvent) => {
      if (phase === "pressed") {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) <= 6) return
        phase = "dragging"
      }
      setDragState({
        kind: "tree",
        source: dragged,
        position: { x: e.clientX, y: e.clientY },
        highlight: dropAt(
          e.clientX,
          e.clientY,
          dragged,
          undefined,
          splitsOnDrop(e)
        ),
      })
    }
    const finish = (e: PointerEvent) => {
      stop()
      const dragging = phase === "dragging"
      setDragState({ kind: "none" })
      if (!dragging) return
      const drop = dropAt(
        e.clientX,
        e.clientY,
        dragged,
        undefined,
        splitsOnDrop(e)
      )
      if (drop) placeTab(path, null, drop.target)
    }
    const cancel = () => {
      stop()
      setDragState({ kind: "none" })
    }
    const stop = () => {
      stopTreeDrag.current = null
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", cancel)
    }
    stopTreeDrag.current = stop
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", cancel)
  }
  const tabSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  // Tabs reorder only within their own strip, so drags across groups are resolved
  // from the pointer instead of from sortable collisions.
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const containerId = args.active.data.current?.sortable?.containerId
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (container) =>
          container.data.current?.sortable?.containerId === containerId
      ),
    })
  }, [])
  const resolveTabDrop = (
    event: DragMoveEvent | DragEndEvent,
    dragged: DragSource
  ): DropHighlight | null => {
    const over = event.over?.data.current?.sortable
    if (!(event.activatorEvent instanceof MouseEvent)) {
      // Keyboard drags reorder within the strip of the tab they land on.
      return over
        ? {
            target: {
              kind: "tabs",
              groupId: String(over.containerId),
              index: over.index,
            },
            beforePath: null,
          }
        : null
    }
    const x = event.activatorEvent.clientX + event.delta.x
    const y = event.activatorEvent.clientY + event.delta.y
    const group = groupsOf(layout).find((entry) => entry.id === dragged.groupId)
    const sameStripIndex =
      dragged.groupId === null
        ? undefined
        : over?.containerId === dragged.groupId
          ? over.index
          : (group?.paths.length ?? 1) - 1
    return dropAt(
      x,
      y,
      dragged,
      sameStripIndex,
      splitsOnDrop(dragModifiers.current)
    )
  }
  return {
    drag,
    treeDragPosition,
    dropHighlight,
    beginFileDrag,
    dragEvents: {
      sensors: tabSensors,
      collisionDetection,
      onDragStart: ({ active }: DragStartEvent) =>
        setDragState({
          kind: "tab",
          source: dragSourceOf(active),
          highlight: null,
        }),
      onDragMove: (event: DragMoveEvent) =>
        setDragState((current) =>
          current.kind === "none"
            ? current
            : {
                ...current,
                highlight: resolveTabDrop(event, dragSourceOf(event.active)),
              }
        ),
      onDragEnd: (event: DragEndEvent) => {
        const dragged = dragSourceOf(event.active)
        const drop = resolveTabDrop(event, dragged)
        setDragState({ kind: "none" })
        if (drop) placeTab(dragged.path, dragged.groupId, drop.target)
      },
      onDragCancel: () => setDragState({ kind: "none" }),
    },
  }
}
