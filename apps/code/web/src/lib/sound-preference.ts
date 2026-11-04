import { setEnabled } from "cuelume"

// Cuelume keeps no state, so the app owns the mute choice. It is device-local:
// a muted laptop stays muted across reloads without syncing to other devices.
export const SOUND_PREFERENCE_KEY = "v5x:sound-enabled"

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">

// Sound stays on unless the stored value is explicitly "off". Missing or
// unreadable storage (private windows, blocked site data) falls back to on.
export function readSoundPreference(storage: PreferenceStorage | undefined) {
  try {
    return storage?.getItem(SOUND_PREFERENCE_KEY) !== "off"
  } catch {
    return true
  }
}

export function writeSoundPreference(
  storage: PreferenceStorage | undefined,
  enabled: boolean
) {
  try {
    storage?.setItem(SOUND_PREFERENCE_KEY, enabled ? "on" : "off")
  } catch {
    // The mute still applies for this page load when storage is unavailable.
  }
}

function browserStorage(): PreferenceStorage | undefined {
  if (typeof window === "undefined") return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

let cached: boolean | undefined
const listeners = new Set<() => void>()

export function getSoundEnabled(): boolean {
  // Server renders have no stored preference; cuelume is silent there anyway.
  if (typeof window === "undefined") return true
  cached ??= readSoundPreference(browserStorage())
  return cached
}

export function subscribeSoundEnabled(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Call once on startup, before the first cue can play.
export function applySoundPreference() {
  setEnabled(getSoundEnabled())
}

export function setSoundEnabled(enabled: boolean) {
  cached = enabled
  setEnabled(enabled)
  writeSoundPreference(browserStorage(), enabled)
  for (const listener of listeners) listener()
}
