import { describe, expect, it } from "vitest"
import { AutocompleteEngine } from "../src/lib/autocomplete/engine"

describe("Program symbols", () => {
  it("indexes all source files and updates live edits and removals", () => {
    const engine = new AutocompleteEngine({
      symbols: [],
      inlineNamespaces: {},
      headers: [],
    })
    engine.setFile("src/main.cpp", "void drive() { int local = 0; }\n")
    engine.setFile(
      "include/robot.h",
      "class Robot { private: void calibrate(); public: void run(); };"
    )
    expect(engine.programSymbols().map((symbol) => symbol.name)).toEqual([
      "drive",
      "Robot",
      "calibrate",
      "run",
    ])
    engine.setFile("src/main.cpp", "void turn() {}")
    expect(engine.programSymbols().map((symbol) => symbol.name)).toContain(
      "turn"
    )
    expect(engine.programSymbols().map((symbol) => symbol.name)).not.toContain(
      "drive"
    )
    engine.removeFile("include/robot.h")
    expect(engine.programSymbols().map((symbol) => symbol.name)).toEqual([
      "turn",
    ])
  })
})
