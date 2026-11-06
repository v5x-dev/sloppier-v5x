// The editor's top bar. Every control here names what it does, and its tooltip shows the key
// the person has bound to it.

import {
  ArrowArcLeftIcon,
  ArrowArcRightIcon,
  ArrowsOutCardinalIcon,
  ArrowsClockwiseIcon,
  CompassIcon,
} from "@phosphor-icons/react"
import { Button } from "@v5x/ui/components/button"
import { primaryLabel, type Bindings } from "@/design/keys"
import type { GizmoMode } from "@/viewport/gizmo"

export function EditorToolbar(props: {
  mode: GizmoMode
  onMode: (mode: GizmoMode) => void
  local: boolean
  onLocal: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onShortcuts: () => void
  bindings: Bindings
}) {
  const key = (id: string) => primaryLabel(props.bindings, id)
  return (
    <div
      role="toolbar"
      aria-label="Editing"
      className="flex items-center gap-1 rounded-lg border border-border bg-background/90 p-1 backdrop-blur-sm"
    >
      <Button
        size="sm"
        variant={props.mode === "move" ? "secondary" : "ghost"}
        aria-pressed={props.mode === "move"}
        onClick={() => props.onMode("move")}
        title={`Move (${key("moveMode")})`}
      >
        <ArrowsOutCardinalIcon /> Move
      </Button>
      <Button
        size="sm"
        variant={props.mode === "rotate" ? "secondary" : "ghost"}
        aria-pressed={props.mode === "rotate"}
        onClick={() => props.onMode("rotate")}
        title={`Turn (${key("turnMode")})`}
      >
        <ArrowsClockwiseIcon /> Turn
      </Button>
      <Button
        size="sm"
        variant={props.local ? "secondary" : "ghost"}
        aria-pressed={props.local}
        onClick={props.onLocal}
        title={`Use the selected Part's own axes (${key("localAxes")})`}
      >
        <CompassIcon /> Part axes
      </Button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <Button
        size="icon"
        variant="ghost"
        aria-label="Undo"
        title={`Undo (${key("undo")})`}
        disabled={!props.canUndo}
        onClick={props.onUndo}
      >
        <ArrowArcLeftIcon />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Redo"
        title={`Redo (${key("redo")})`}
        disabled={!props.canRedo}
        onClick={props.onRedo}
      >
        <ArrowArcRightIcon />
      </Button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <Button
        size="sm"
        variant="ghost"
        onClick={props.onShortcuts}
        title={`Keyboard shortcuts (${key("shortcuts")})`}
      >
        Shortcuts
      </Button>
    </div>
  )
}
