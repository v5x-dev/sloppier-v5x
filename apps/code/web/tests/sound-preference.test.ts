import { describe, expect, test } from "vitest"
import {
  SOUND_PREFERENCE_KEY,
  readSoundPreference,
  writeSoundPreference,
} from "../src/lib/sound-preference"

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe("sound preference", () => {
  test("sound is on when nothing has been stored", () => {
    expect(readSoundPreference(memoryStorage())).toBe(true)
  })

  test("a stored off value mutes and on unmutes", () => {
    const storage = memoryStorage({ [SOUND_PREFERENCE_KEY]: "off" })
    expect(readSoundPreference(storage)).toBe(false)
    writeSoundPreference(storage, true)
    expect(storage.values.get(SOUND_PREFERENCE_KEY)).toBe("on")
    expect(readSoundPreference(storage)).toBe(true)
  })

  test("unreadable or missing storage keeps sound on without throwing", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("quota")
      },
    }
    expect(readSoundPreference(broken)).toBe(true)
    expect(() => writeSoundPreference(broken, false)).not.toThrow()
    expect(readSoundPreference(undefined)).toBe(true)
    expect(() => writeSoundPreference(undefined, false)).not.toThrow()
  })
})
