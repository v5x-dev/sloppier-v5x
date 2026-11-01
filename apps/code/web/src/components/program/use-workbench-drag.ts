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
  // The file being dragged and the editor group zone it would drop into.
  const [drag, setDrag] = useState<DragSource | null>(null)
  const [treeDragPosition, setTreeDragPosition] = useState<{
    x: number
    y: number
  } | null>(null)
  const [dropHighlight, setDropHighlight] = useState<DropHighlight | null>(null)
  // Explorer drags use window pointer events, because the tree handles its own
  // pointer input.
  const beginFileDrag = (path: string, event: React.PointerEvent) => {
    stopTreeDrag.current?.()
    const startX = event.clientX,
      startY = event.clientY
    let dragging = false
    const move = (e: PointerEvent) => {
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) > 6) {
        dragging = true
        setDrag({ path, groupId: null })
      }
      if (dragging) {
        setTreeDragPosition({ x: e.clientX, y: e.clientY })
        setDropHighlight(
          dropAt(
            e.clientX,
            e.clientY,
            { path, groupId: null },
            undefined,
            splitsOnDrop(e)
          )
        )
      }
    }
    const finish = (e: PointerEvent) => {
      stop()
      setDrag(null)
      setTreeDragPosition(null)
      setDropHighlight(null)
      if (!dragging) return
      const drop = dropAt(
        e.clientX,
        e.clientY,
        { path, groupId: null },
        undefined,
        splitsOnDrop(e)
      )
      if (drop) placeTab(path, null, drop.target)
    }
    const cancel = () => {
      stop()
      setDrag(null)
      setTreeDragPosition(null)
      setDropHighlight(null)
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
        setDrag(dragSourceOf(active)),
      onDragMove: (event: DragMoveEvent) =>
        setDropHighlight(resolveTabDrop(event, dragSourceOf(event.active))),
      onDragEnd: (event: DragEndEvent) => {
        const dragged = dragSourceOf(event.active)
        const drop = resolveTabDrop(event, dragged)
        setDrag(null)
        setDropHighlight(null)
        if (drop) placeTab(dragged.path, dragged.groupId, drop.target)
      },
      onDragCancel: () => {
        setDrag(null)
        setDropHighlight(null)
      },
    },
  }
}
