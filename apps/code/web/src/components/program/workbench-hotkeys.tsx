import { useState } from "react"
import { formatForDisplay, useHotkeys } from "@tanstack/react-hotkeys"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@v5x/ui/components/command"
import { ScrollArea } from "@v5x/ui/components/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@v5x/ui/components/dialog"
import { Input } from "@v5x/ui/components/input"
import { Kbd } from "@v5x/ui/components/kbd"
import { toast } from "@v5x/ui/components/toast"
import { groupsOf } from "@/lib/editor-groups"
import { errorMessage } from "@/lib/errors"
import type { WorkbenchSource } from "@/lib/workbench-source"
import { focusExplorerTree, focusGroupEditor } from "./workbench-focus"
import {
  hotkeys,
  parseLineNumber,
  shortcutReference,
} from "./workbench-shortcuts"

type Palette = "files" | "commands"

export function WorkbenchHotkeys({
  source,
  paths,
  format,
  showExplorer,
  showSymbols,
  onGoToLine,
}: {
  source: WorkbenchSource
  paths: string[] | null
  format: () => void
  showExplorer: () => void
  showSymbols: () => void
  onGoToLine: (line: number) => void
}) {
  const [palette, setPalette] = useState<Palette | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [lineOpen, setLineOpen] = useState(false)
  const [lineText, setLineText] = useState("")
  const [lineInvalid, setLineInvalid] = useState(false)
  const anyOpen = palette !== null || shortcutsOpen || lineOpen

  const focusExplorer = () => {
    showExplorer()
    requestAnimationFrame(focusExplorerTree)
  }
  // The symbols search field focuses itself when the panel mounts.
  const focusSymbols = () => showSymbols()
  const close = (all: boolean) => {
    const layout = source.getSnapshot().layout
    const group = groupsOf(layout).find(
      (item) => item.id === layout.activeGroupId
    )
    if (!group) return
    try {
      for (const path of all
        ? [...group.paths]
        : group.activePath
          ? [group.activePath]
          : [])
        source.closeTab(group.id, path)
    } catch (error) {
      toast.add({
        type: "error",
        title: "This file is still syncing",
        description: errorMessage(error),
      })
    }
  }
  const nextGroup = () => {
    const layout = source.getSnapshot().layout
    const groups = groupsOf(layout)
    if (groups.length < 2) return
    const next =
      groups[
        (groups.findIndex((item) => item.id === layout.activeGroupId) + 1) %
          groups.length
      ]
    source.activateGroup(next.id)
    requestAnimationFrame(() => focusGroupEditor(next.id))
  }
  const openLine = () => {
    if (!source.getSnapshot().activePath) {
      toast.add({ type: "error", title: "Open a file to go to a line" })
      return
    }
    setLineText("")
    setLineInvalid(false)
    setLineOpen(true)
  }
  const openPath = (path: string) => {
    source.openFile(path)
    setPalette(null)
    requestAnimationFrame(() =>
      focusGroupEditor(source.getSnapshot().layout.activeGroupId)
    )
  }
  // Palette commands run after the palette closes, so they can move focus.
  const commands = [
    { label: "Go to line", hotkey: hotkeys.goToLine, run: openLine },
    {
      label: "Go to symbol in program",
      hotkey: hotkeys.goToSymbol,
      run: focusSymbols,
    },
    {
      label: "Focus file explorer",
      hotkey: hotkeys.focusExplorer,
      run: focusExplorer,
    },
    { label: "Format document", hotkey: hotkeys.formatDocument, run: format },
    {
      label: "Focus next editor group",
      hotkey: hotkeys.focusNextGroup,
      run: nextGroup,
    },
    {
      label: "Close active file tab",
      hotkey: hotkeys.closeTab,
      run: () => close(false),
    },
    {
      label: "Close file tabs in group",
      hotkey: hotkeys.closeGroupTabs,
      run: () => close(true),
    },
    {
      label: "Keyboard shortcuts",
      hotkey: hotkeys.showShortcuts,
      run: () => setShortcutsOpen(true),
    },
  ]
  const groups = [...new Set(shortcutReference.map((item) => item.group))]

  useHotkeys(
    [
      { hotkey: hotkeys.goToFile, callback: () => setPalette("files") },
      {
        hotkey: hotkeys.commandPalette,
        callback: () => setPalette("commands"),
      },
      { hotkey: hotkeys.goToLine, callback: openLine },
      { hotkey: hotkeys.goToSymbol, callback: focusSymbols },
      { hotkey: hotkeys.focusExplorer, callback: focusExplorer },
      { hotkey: hotkeys.focusNextGroup, callback: nextGroup },
      { hotkey: hotkeys.closeTab, callback: () => close(false) },
      { hotkey: hotkeys.closeGroupTabs, callback: () => close(true) },
      { hotkey: hotkeys.showShortcuts, callback: () => setShortcutsOpen(true) },
    ],
    { capture: true, enabled: !anyOpen }
  )

  return (
    <>
      <CommandDialog
        key={palette ?? "closed"}
        open={palette !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPalette(null)
        }}
        title={palette === "files" ? "Go to file" : "Command palette"}
        description={
          palette === "files"
            ? "Search the program's files and open one."
            : "Search for a command to run."
        }
      >
        <Command loop>
          <CommandInput
            autoFocus
            aria-label={palette === "files" ? "Find a file" : "Find a command"}
            placeholder={
              palette === "files" ? "Go to file…" : "Type a command…"
            }
          />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            {palette === "files" ? (
              <CommandGroup>
                {(paths ?? []).map((path) => (
                  <CommandItem
                    key={path}
                    value={path}
                    onSelect={() => openPath(path)}
                  >
                    {path}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              <CommandGroup>
                {commands.map((item) => (
                  <CommandItem
                    key={item.label}
                    value={item.label}
                    onSelect={() => {
                      setPalette(null)
                      item.run()
                    }}
                  >
                    {item.label}
                    <CommandShortcut>
                      {formatForDisplay(item.hotkey)}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] [&_[data-slot=scroll-area-viewport]]:max-h-[70vh]">
            <div className="space-y-4 pr-3">
              {groups.map((group) => (
                <section key={group} aria-label={group}>
                  <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                    {group}
                  </h3>
                  <dl className="divide-y">
                    {shortcutReference
                      .filter((item) => item.group === group)
                      .map((item) => (
                        <div
                          key={item.label}
                          className="flex items-center justify-between gap-4 py-1.5 text-sm"
                        >
                          <dt>{item.label}</dt>
                          <dd>
                            <Kbd>{formatForDisplay(item.hotkey)}</Kbd>
                          </dd>
                        </div>
                      ))}
                  </dl>
                </section>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
      <Dialog open={lineOpen} onOpenChange={setLineOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Go to line</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const line = parseLineNumber(lineText)
              if (line === null) {
                setLineInvalid(true)
                return
              }
              setLineOpen(false)
              onGoToLine(line)
            }}
          >
            <Input
              autoFocus
              inputMode="numeric"
              aria-label="Line number"
              aria-invalid={lineInvalid}
              placeholder="Line number"
              value={lineText}
              onChange={(event) => {
                setLineText(event.target.value)
                setLineInvalid(false)
              }}
            />
            {lineInvalid && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                Enter a line number from 1 or more.
              </p>
            )}
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
