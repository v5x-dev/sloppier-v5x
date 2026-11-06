// The editor's top bar and its shortcut reference. Every control here names what it does.

import {
  ArrowArcLeftIcon,
  ArrowArcRightIcon,
  ArrowsOutCardinalIcon,
  ArrowsClockwiseIcon,
  CompassIcon,
} from "@phosphor-icons/react"
import { Button } from "@v5x/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@v5x/ui/components/dialog"
import { Kbd } from "@v5x/ui/components/kbd"
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
}) {
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
        title="Move (W)"
      >
        <ArrowsOutCardinalIcon /> Move
      </Button>
      <Button
        size="sm"
        variant={props.mode === "rotate" ? "secondary" : "ghost"}
        aria-pressed={props.mode === "rotate"}
        onClick={() => props.onMode("rotate")}
        title="Turn (E)"
      >
        <ArrowsClockwiseIcon /> Turn
      </Button>
      <Button
        size="sm"
        variant={props.local ? "secondary" : "ghost"}
        aria-pressed={props.local}
        onClick={props.onLocal}
        title="Use the selected Part's own axes (L)"
      >
        <CompassIcon /> Part axes
      </Button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <Button
        size="icon"
        variant="ghost"
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
        disabled={!props.canUndo}
        onClick={props.onUndo}
      >
        <ArrowArcLeftIcon />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Redo"
        title="Redo (Ctrl+Shift+Z)"
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
        title="Keyboard shortcuts (?)"
      >
        Shortcuts
      </Button>
    </div>
  )
}

const SECTIONS: { title: string; rows: [string[], string][] }[] = [
  {
    title: "Select",
    rows: [
      [["Click"], "Select one Part"],
      [["Shift", "Click"], "Add or remove a Part"],
      [["Shift", "Drag"], "Select the Parts inside a box"],
      [["Ctrl", "A"], "Select everything"],
      [["Esc"], "Clear the selection, or stop placing"],
    ],
  },
  {
    title: "Move and turn",
    rows: [
      [["W"], "Move handles"],
      [["E"], "Turn rings"],
      [["L"], "Use the Part's own axes"],
      [
        ["Alt", "Drag"],
        "Move or turn one Part alone and break its connections",
      ],
    ],
  },
  {
    title: "Edit",
    rows: [
      [["Ctrl", "D"], "Duplicate"],
      [["Del"], "Delete"],
      [["Ctrl", "Z"], "Undo"],
      [["Ctrl", "Shift", "Z"], "Redo"],
      [["1"], "Recolour to the first swatch, through 8"],
    ],
  },
  {
    title: "Place and view",
    rows: [
      [["Click"], "Place the Part being placed"],
      [["R"], "Turn the Part being placed"],
      [["F"], "Frame everything"],
      [["O"], "Switch between perspective and orthographic"],
      [["?"], "Show this list"],
    ],
  },
]

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard and pointer</DialogTitle>
          <DialogDescription>
            Shortcuts work when the 3D view or the page has focus, not while
            typing in a field.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <section key={section.title} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{section.title}</h3>
              <dl className="flex flex-col gap-2 text-sm">
                {section.rows.map(([keys, text]) => (
                  <div
                    key={text}
                    className="flex items-start justify-between gap-3"
                  >
                    <dt className="flex flex-wrap gap-1">
                      {keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </dt>
                    <dd className="text-right text-muted-foreground">{text}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
