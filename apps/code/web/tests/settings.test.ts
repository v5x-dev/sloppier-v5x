import { describe, expect, it } from "vitest"
import { defaultSettings, normalizeSettings } from "../src/lib/settings"

describe("settings", () => {
  it("keeps supported saved values and fills in missing defaults", () => {
    expect(
      normalizeSettings({ fontSize: 17, wordWrap: true, uploadSlot: 8 })
    ).toEqual({
      ...defaultSettings,
      fontSize: 17,
      wordWrap: true,
      uploadSlot: 8,
    })
  })
  it("keeps editing preferences and rejects invalid tab widths", () => {
    expect(
      normalizeSettings({
        tabSize: 4,
        autoCloseBrackets: false,
        autoComplete: false,
        autoSurround: false,
      })
    ).toMatchObject({
      tabSize: 4,
      autoCloseBrackets: false,
      autoComplete: false,
      autoSurround: false,
      matchBrackets: true,
    })
    expect(
      normalizeSettings({ tabSize: 9, autoSignature: "off" })
    ).toMatchObject({ tabSize: 2, autoSignature: true })
  })
  it("ignores invalid or out-of-range stored values", () => {
    expect(
      normalizeSettings({
        fontSize: 100,
        lineSpacing: 4.5,
        uploadSlot: 0,
        lineNumbers: "false",
      })
    ).toEqual(defaultSettings)
    expect(normalizeSettings(null)).toEqual(defaultSettings)
  })
})
