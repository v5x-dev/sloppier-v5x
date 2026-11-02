/** Where one open file's live edits stand. Shown as an icon, labeled for assistive tech. */
export type LiveSaveStatus =
  "opening" | "saving" | "backing-up" | "saved" | "offline"

// Uses the glossary's terms: "live" is synced to the server, and "commit" is separate.
export const liveSaveLabels: Record<LiveSaveStatus, string> = {
  opening: "Opening file",
  saving: "Saving live…",
  "backing-up": "Live · backing up to the repository",
  saved: "Live · all edits saved",
  offline: "Offline · edits kept on this device",
}
