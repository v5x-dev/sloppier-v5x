// The keyboard settings: every shortcut in the editor, its keys, and a way to change or reset
// each one. It is also the shortcut reference, so what it shows is what the editor does.

import { Button } from "@v5x/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@v5x/ui/components/dialog"
import { Kbd } from "@v5x/ui/components/kbd"
import { useEffect, useState } from "react"
import { keyStore } from "@/design/key-store"
import {
  comboFromEvent,
  comboLabel,
  defaultBindings,
  groupedActions,
  isModifierOnly,
  sameList,
  type ActionId,
} from "@/design/keys"
import { useKeyBindings } from "@/lib/use-key-bindings"

const POINTER_ROWS: [string[], string][] = [
  [["Click"], "Select one Part"],
  [["Shift", "Click"], "Add or remove a Part"],
  [["Shift", "Drag"], "Select the Parts inside a box"],
  [["Alt", "Drag"], "Move or turn one Part alone and break its connections"],
]

export function KeyboardSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const bindings = useKeyBindings()
  const [capturing, setCapturing] = useState<ActionId>()
  const [problem, setProblem] = useState<{ id: ActionId; message: string }>()
  const dropped = keyStore.droppedOnLoad
  const changed = Object.keys(bindings).some(
    (id) => !sameList(bindings[id], defaultBindings()[id])
  )

  // Only while a key is being chosen. The capture phase runs before the editor's own
  // handlers, so the key press that picks a new binding does not also run the old one.
  useEffect(() => {
    if (!capturing) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        // Tab keeps moving focus, so keyboard users are never stuck in this dialog.
        setCapturing(undefined)
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      if (
        event.key === "Escape" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        setCapturing(undefined)
        setProblem(undefined)
        return
      }
      if (isModifierOnly(event.key)) return
      const combo = comboFromEvent(event)
      if (combo === undefined) {
        setProblem({ id: capturing, message: "That key can't be used." })
        setCapturing(undefined)
        return
      }
      const result = keyStore.set(capturing, [combo])
      if (result.ok) {
        setProblem(undefined)
        setCapturing(undefined)
      } else {
        setProblem({ id: capturing, message: result.message })
        setCapturing(undefined)
      }
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [capturing])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setCapturing(undefined)
        setProblem(undefined)
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts work when the 3D view or the page has focus, not while
            typing in a field. Changes are kept in this browser.
          </DialogDescription>
        </DialogHeader>

        {dropped.length > 0 && (
          <p
            role="status"
            className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
          >
            {dropped.length === 1
              ? "A saved shortcut"
              : `${dropped.length} saved shortcuts`}{" "}
            could not be used here and went back to the default.
          </p>
        )}

        <div className="grid gap-6 sm:grid-cols-2">
          {groupedActions().map(({ group, actions }) => (
            <section key={group} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{group}</h3>
              <ul className="flex flex-col divide-y divide-border">
                {actions.map((action) => {
                  const combos = bindings[action.id] ?? []
                  const isChanged = !sameList(
                    combos,
                    defaultBindings()[action.id]
                  )
                  const isCapturing = capturing === action.id
                  return (
                    <li key={action.id} className="flex flex-col gap-1 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 text-sm">{action.label}</span>
                        <div className="flex shrink-0 items-center gap-1">
                          {isCapturing ? (
                            <span
                              role="status"
                              className="text-sm text-muted-foreground"
                            >
                              Press a key… (Esc to cancel)
                            </span>
                          ) : (
                            <span className="flex flex-wrap items-center justify-end gap-1">
                              {combos.map((combo, i) => (
                                <span
                                  key={combo}
                                  className="inline-flex items-center gap-1"
                                >
                                  {i > 0 && (
                                    <span className="text-xs text-muted-foreground">
                                      or
                                    </span>
                                  )}
                                  <Kbd>{comboLabel(combo)}</Kbd>
                                </span>
                              ))}
                            </span>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Change the key for ${action.label}`}
                            onClick={() => {
                              setProblem(undefined)
                              setCapturing(isCapturing ? undefined : action.id)
                            }}
                          >
                            {isCapturing ? "Cancel" : "Change"}
                          </Button>
                          {isChanged && (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Reset the key for ${action.label}`}
                              onClick={() => keyStore.reset(action.id)}
                            >
                              Reset
                            </Button>
                          )}
                        </div>
                      </div>
                      {problem?.id === action.id && (
                        <p role="alert" className="text-xs text-destructive">
                          {problem.message}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Pointer</h3>
            <dl className="flex flex-col gap-2 text-sm">
              {POINTER_ROWS.map(([keys, text]) => (
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
        </div>

        <DialogFooter>
          <p className="mr-auto text-xs text-muted-foreground">
            Pressing a key that another action uses is refused, and the message
            names that action.
          </p>
          <Button
            variant="outline"
            disabled={!changed}
            onClick={() => {
              setProblem(undefined)
              keyStore.resetAll()
            }}
          >
            Reset all to defaults
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
