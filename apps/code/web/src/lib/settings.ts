import { useSyncExternalStore } from "react"
import { readEditorState, writeEditorState } from "./editor-persistence"

export const defaultSettings = {
  fontSize: 13,
  lineSpacing: 7,
  showMinimap: true,
  lineNumbers: true,
  wordWrap: false,
  tabSize: 2,
  matchBrackets: true,
  roundedSelection: true,
  autoSurround: true,
  autoCloseBrackets: true,
  autoComplete: true,
  autoSignature: true,
  texture: true,
  reduceMotion: false,
  uploadSlot: 1,
  runAfterUpload: true,
}
export type Settings = typeof defaultSettings
const key = "settings"
let current = defaultSettings
let initialized = false
const listeners = new Set<() => void>()

export function normalizeSettings(value: unknown): Settings {
  const saved =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const number = (name: keyof Settings, min: number, max: number) =>
    typeof saved[name] === "number" &&
    Number.isInteger(saved[name]) &&
    saved[name] >= min &&
    saved[name] <= max
      ? saved[name]
      : (defaultSettings[name] as number)
  const boolean = (name: keyof Settings) =>
    typeof saved[name] === "boolean"
      ? saved[name]
      : (defaultSettings[name] as boolean)
  return {
    fontSize: number("fontSize", 11, 20),
    lineSpacing: number("lineSpacing", 4, 12),
    showMinimap: boolean("showMinimap"),
    lineNumbers: boolean("lineNumbers"),
    wordWrap: boolean("wordWrap"),
    tabSize: number("tabSize", 1, 8),
    matchBrackets: boolean("matchBrackets"),
    roundedSelection: boolean("roundedSelection"),
    autoSurround: boolean("autoSurround"),
    autoCloseBrackets: boolean("autoCloseBrackets"),
    autoComplete: boolean("autoComplete"),
    autoSignature: boolean("autoSignature"),
    texture: boolean("texture"),
    reduceMotion: boolean("reduceMotion"),
    uploadSlot: number("uploadSlot", 1, 8),
    runAfterUpload: boolean("runAfterUpload"),
  }
}
function initialize() {
  if (initialized || typeof window === "undefined") return
  initialized = true
  const saved = readEditorState<unknown>(key)
  if (saved === null) {
    current = normalizeSettings({
      fontSize: readEditorState("font-size"),
      showMinimap: readEditorState("show-minimap"),
    })
  } else current = normalizeSettings(saved)
}
export function getSettings() {
  initialize()
  return current
}
function subscribeSettings(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function useSettings() {
  return useSyncExternalStore(
    subscribeSettings,
    getSettings,
    () => defaultSettings
  )
}
export function updateSettings(patch: Partial<Settings>) {
  initialize()
  current = normalizeSettings({ ...current, ...patch })
  writeEditorState(key, current)
  for (const listener of listeners) listener()
}
export function resetSettings() {
  updateSettings(defaultSettings)
}
