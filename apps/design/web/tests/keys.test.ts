import { describe, expect, it } from "vitest"
import {
  ACTIONS,
  checkCombo,
  clashesFor,
  comboFromEvent,
  comboLabel,
  defaultBindings,
  overridesFrom,
  rebind,
  resolveOverrides,
  type KeyEventLike,
} from "@/design/keys"

function press(key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  }
}

describe("reading a key press", () => {
  it.each<[string, KeyEventLike, string | undefined]>([
    ["a letter", press("w"), "w"],
    ["an upper-case letter is lower-cased", press("W"), "w"],
    ["Ctrl with a letter", press("z", { ctrlKey: true }), "mod+z"],
    ["Cmd counts as Ctrl", press("z", { metaKey: true }), "mod+z"],
    [
      "Ctrl Shift with a letter",
      press("Z", { ctrlKey: true, shiftKey: true }),
      "mod+shift+z",
    ],
    ["Shift with a letter", press("W", { shiftKey: true }), "shift+w"],
    ["a digit", press("1"), "1"],
    ["a symbol ignores Shift", press("?", { shiftKey: true }), "?"],
    ["Delete", press("Delete"), "Delete"],
    [
      "Shift with a named key",
      press("Escape", { shiftKey: true }),
      "shift+Escape",
    ],
    ["space", press(" "), "space"],
    ["the plus key", press("+"), "+"],
    ["Ctrl plus the plus key", press("+", { ctrlKey: true }), "mod++"],
    ["a lone modifier", press("Shift", { shiftKey: true }), undefined],
    ["Tab is left to the page", press("Tab"), undefined],
    ["Enter is left to dialogs", press("Enter"), undefined],
  ])("%s", (_name, event, combo) => {
    expect(comboFromEvent(event)).toBe(combo)
  })
})

describe("checking a combo before it is bound", () => {
  it("accepts canonical combos, including the plus key", () => {
    for (const combo of [
      "mod+z",
      "mod+shift+z",
      "alt+w",
      "?",
      "Delete",
      "mod++",
    ])
      expect(checkCombo(combo).ok).toBe(true)
  })

  it.each([
    ["modifiers out of order", "shift+mod+z"],
    ["a repeated modifier", "mod+mod+z"],
    ["an unknown modifier", "hyper+z"],
    ["an empty key", ""],
    ["a key the page keeps", "Tab"],
    ["a browser shortcut", "mod+t"],
  ])("refuses %s", (_name, combo) => {
    expect(checkCombo(combo).ok).toBe(false)
  })
})

describe("labels", () => {
  it.each([
    ["mod+shift+z", "Ctrl Shift Z"],
    ["Delete", "Del"],
    ["Escape", "Esc"],
    ["?", "?"],
    ["mod++", "Ctrl +"],
  ])("%s reads as %s", (combo, label) => {
    expect(comboLabel(combo)).toBe(label)
  })
})

describe("the registry", () => {
  it("gives every action a unique id and no two actions the same default key", () => {
    const ids = ACTIONS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    const defaults = ACTIONS.flatMap((a) => a.defaults)
    expect(new Set(defaults).size).toBe(defaults.length)
  })

  it("only has defaults that a person may bind", () => {
    for (const action of ACTIONS)
      for (const combo of action.defaults)
        expect(checkCombo(combo).ok, `${action.id}: ${combo}`).toBe(true)
  })

  it("covers every shortcut the editor had before rebinding", () => {
    const keys = new Set(ACTIONS.flatMap((a) => a.defaults))
    for (const combo of [
      "mod+a",
      "Escape",
      "w",
      "e",
      "l",
      "mod+d",
      "Delete",
      "Backspace",
      "mod+z",
      "mod+shift+z",
      "mod+y",
      "1",
      "8",
      "r",
      "f",
      "o",
      "?",
    ])
      expect(keys.has(combo), combo).toBe(true)
  })
})

describe("rebinding", () => {
  it("moves an action to a free key", () => {
    const result = rebind(defaultBindings(), "frame", ["g"])
    expect(result.ok && result.bindings.frame).toEqual(["g"])
  })

  it("refuses a key another action uses, and names that action", () => {
    const result = rebind(defaultBindings(), "frame", ["w"])
    expect(result).toEqual({
      ok: false,
      message: "W is already used by Move handles.",
    })
  })

  it("lets an action keep its own key", () => {
    const result = rebind(defaultBindings(), "undo", ["mod+z"])
    expect(result.ok).toBe(true)
  })

  it("replaces every key an action had, so Redo can drop its second key", () => {
    const result = rebind(defaultBindings(), "redo", ["mod+shift+y"])
    expect(result.ok && result.bindings.redo).toEqual(["mod+shift+y"])
  })

  it("refuses an empty list, an unknown action, and an unusable key", () => {
    expect(rebind(defaultBindings(), "undo", []).ok).toBe(false)
    expect(rebind(defaultBindings(), "nope", ["g"]).ok).toBe(false)
    expect(rebind(defaultBindings(), "undo", ["Tab"]).ok).toBe(false)
  })

  it("finds every other action that clashes", () => {
    expect(clashesFor(defaultBindings(), "frame", ["w", "Delete"])).toEqual([
      "moveMode",
      "delete",
    ])
  })
})

describe("saved overrides", () => {
  it("keeps only what a person changed", () => {
    const changed = rebind(defaultBindings(), "frame", ["g"])
    if (!changed.ok) throw new Error("setup failed")
    expect(overridesFrom(changed.bindings)).toEqual({ frame: ["g"] })
    expect(overridesFrom(defaultBindings())).toEqual({})
  })

  it("reads back what it wrote", () => {
    const saved = { bindings: { frame: ["g"], undo: ["mod+u"] } }
    const { bindings, kept, dropped } = resolveOverrides(saved)
    expect(bindings.frame).toEqual(["g"])
    expect(bindings.undo).toEqual(["mod+u"])
    expect(kept).toEqual(saved.bindings)
    expect(dropped).toEqual([])
  })

  it("skips what cannot be read, and says so", () => {
    const saved = {
      bindings: {
        unknownAction: ["g"],
        frame: "g",
        undo: ["Tab"],
        turnMode: [],
        projection: ["g", "g"],
        recolor1: ["mod+t"],
        selectAll: ["h"],
      },
    }
    const { bindings, dropped } = resolveOverrides(saved)
    expect(bindings.frame).toEqual(["f"])
    expect(bindings.undo).toEqual(["mod+z"])
    expect(bindings.selectAll).toEqual(["h"])
    expect([...dropped].sort()).toEqual(
      [
        "frame",
        "projection",
        "recolor1",
        "turnMode",
        "undo",
        "unknownAction",
      ].sort()
    )
  })

  it("never lets a saved key shadow another action", () => {
    // "o" is Projection's default. A saved Frame binding to "o" must give way.
    const saved = { bindings: { frame: ["o"] } }
    const { bindings, dropped } = resolveOverrides(saved)
    expect(bindings.frame).toEqual(["f"])
    expect(bindings.projection).toEqual(["o"])
    expect(dropped).toEqual(["frame"])
  })

  it("handles storage that is not an object", () => {
    for (const raw of [null, 3, "x", [], { bindings: null }])
      expect(resolveOverrides(raw).bindings).toEqual(defaultBindings())
  })
})
