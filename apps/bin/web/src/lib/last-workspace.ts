// Remembers the workspace this browser last opened. Per-viewer only, so a
// missing or blocked storage just means `/` falls back to the first workspace.
const key = "bin:last-workspace"

export function readLastWorkspace(): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeLastWorkspace(id: string) {
  try {
    localStorage.setItem(key, id)
  } catch {
    // Storage unavailable: the next visit simply starts from the first workspace.
  }
}
