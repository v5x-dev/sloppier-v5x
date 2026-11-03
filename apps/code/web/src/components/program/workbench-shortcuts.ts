// Keyboard map for the program workbench, in TanStack Hotkeys syntax. `Mod` is
// Ctrl on Windows and Linux and Cmd on macOS. Handlers and the shortcut
// reference both read these strings, so a binding changes in one place.
export const hotkeys = {
  goToFile: "Mod+P",
  commandPalette: "Mod+Shift+P",
  goToLine: "Mod+G",
  goToSymbol: "Mod+Shift+O",
  focusExplorer: "Mod+Shift+E",
  searchProgram: "Mod+Shift+F",
  uploadToBrain: "Mod+Shift+B",
  commitSource: "Mod+S",
  formatDocument: "Alt+Shift+F",
  splitEditor: "Mod+[Backslash]",
  focusNextGroup: "Mod+Shift+[Backslash]",
  // Ctrl/Cmd+1 to 9 are reserved by browsers for switching tabs, so these are chords.
  focusGroup: ["Mod+K", "1"],
  focusLastTab: ["Mod+K", "9"],
  previousTab: "Mod+Alt+ArrowLeft",
  nextTab: "Mod+Alt+ArrowRight",
  closeTab: ["Mod+K", "W"],
  closeGroupTabs: ["Mod+K", "Mod+W"],
  showShortcuts: ["Mod+K", "Mod+S"],
  focusGroupLeft: ["Mod+K", "Mod+ArrowLeft"],
  focusGroupRight: ["Mod+K", "Mod+ArrowRight"],
  focusGroupUp: ["Mod+K", "Mod+ArrowUp"],
  focusGroupDown: ["Mod+K", "Mod+ArrowDown"],
} as const

// Editor-native keys come from Pierre's editor keymap. They are listed here so
// the reference is complete, but the workbench does not bind them.
export const shortcutReference = [
  {
    group: "Files and commands",
    label: "Go to file",
    hotkey: hotkeys.goToFile,
  },
  {
    group: "Files and commands",
    label: "Command palette",
    hotkey: hotkeys.commandPalette,
  },
  {
    group: "Files and commands",
    label: "Go to line",
    hotkey: hotkeys.goToLine,
  },
  {
    group: "Files and commands",
    label: "Go to symbol in program",
    hotkey: hotkeys.goToSymbol,
  },
  {
    group: "Files and commands",
    label: "Focus file explorer",
    hotkey: hotkeys.focusExplorer,
  },
  {
    group: "Files and commands",
    label: "Keyboard shortcuts",
    hotkey: hotkeys.showShortcuts,
  },
  { group: "Editor", label: "Commit changes", hotkey: hotkeys.commitSource },
  { group: "Editor", label: "Format document", hotkey: hotkeys.formatDocument },
  { group: "Editor", label: "Find in file", hotkey: "Mod+F" },
  { group: "Editor", label: "Replace in file", hotkey: "Mod+Alt+F" },
  { group: "Editor", label: "Find next match", hotkey: "Mod+D" },
  { group: "Editor", label: "Toggle line comment", hotkey: "Mod+/" },
  { group: "Program", label: "Search program", hotkey: hotkeys.searchProgram },
  { group: "Program", label: "Upload to Brain", hotkey: hotkeys.uploadToBrain },
  {
    group: "Editor groups and tabs",
    label: "Split editor",
    hotkey: hotkeys.splitEditor,
  },
  {
    group: "Editor groups and tabs",
    label: "Focus next editor group",
    hotkey: hotkeys.focusNextGroup,
  },
  {
    group: "Editor groups and tabs",
    label: "Focus editor group 1–8",
    hotkey: hotkeys.focusGroup,
  },
  {
    group: "Editor groups and tabs",
    label: "Focus last tab",
    hotkey: hotkeys.focusLastTab,
  },
  {
    group: "Editor groups and tabs",
    label: "Focus editor group in a direction",
    hotkey: hotkeys.focusGroupLeft,
  },
  {
    group: "Editor groups and tabs",
    label: "Previous tab",
    hotkey: hotkeys.previousTab,
  },
  {
    group: "Editor groups and tabs",
    label: "Next tab",
    hotkey: hotkeys.nextTab,
  },
  {
    group: "Editor groups and tabs",
    label: "Close active file tab",
    hotkey: hotkeys.closeTab,
  },
  {
    group: "Editor groups and tabs",
    label: "Close file tabs in group",
    hotkey: hotkeys.closeGroupTabs,
  },
] as const

// Accepts a one-based line number. Returns null for anything that is not a
// whole number from 1 upward, so the dialog can keep the user in place.
export function parseLineNumber(value: string) {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const line = Number(trimmed)
  return line >= 1 ? line : null
}

// The path that follows (step 1) or precedes (step -1) the active tab in a group,
// wrapping at either end. Returns null when there is nothing to switch to.
export function adjacentTab(
  paths: readonly string[],
  activePath: string | null,
  step: 1 | -1
) {
  if (paths.length < 2) return null
  const index = activePath ? paths.indexOf(activePath) : -1
  const next = index === -1 ? 0 : (index + step + paths.length) % paths.length
  return paths[next] ?? null
}
