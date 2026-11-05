import { describe, expect, it } from "vitest"
import type { BuildDiagnostic } from "../src/lib/build-diagnostics"
import { quickFixEdit, quickFixesFor } from "../src/lib/build-quick-fixes"

function error(message: string, column = 5) {
  return {
    path: "src/main.cpp",
    line: 12,
    column,
    severity: "error",
    message,
  } satisfies BuildDiagnostic
}

describe("build quick fixes", () => {
  it("offers the compiler's suggested spelling for an unknown name", () => {
    expect(
      quickFixesFor(
        error("use of undeclared identifier 'mtr'; did you mean 'motor'?")
      )
    ).toEqual([
      {
        title: "Replace 'mtr' with 'motor'",
        line: 12,
        column: 5,
        expected: "mtr",
        replacement: "motor",
      },
    ])
    expect(
      quickFixesFor(
        error("'mtr' was not declared in this scope; did you mean 'motor'?")
      )
    ).toEqual([
      {
        title: "Replace 'mtr' with 'motor'",
        line: 12,
        column: 5,
        expected: "mtr",
        replacement: "motor",
      },
    ])
    expect(
      quickFixesFor(
        error(
          "no member named 'spin' in 'pros::Motor'; did you mean 'move'?",
          9
        )
      )
    ).toEqual([
      {
        title: "Replace 'spin' with 'move'",
        line: 12,
        column: 9,
        expected: "spin",
        replacement: "move",
      },
    ])
  })

  it("inserts a missing semicolon only where the compiler reports the end of the previous token", () => {
    expect(quickFixesFor(error("expected ';' after expression", 10))).toEqual([
      {
        title: "Insert ';'",
        line: 12,
        column: 10,
        expected: "",
        replacement: ";",
      },
    ])
    expect(
      quickFixesFor(error("expected ';' at end of declaration", 10))
    ).toHaveLength(1)
    expect(quickFixesFor(error("expected ';' before 'return'", 10))).toEqual([])
  })

  it("offers nothing it cannot verify from the message alone", () => {
    expect(
      quickFixesFor({
        path: "src/main.cpp",
        line: 12,
        severity: "error",
        message: "use of undeclared identifier 'mtr'; did you mean 'motor'?",
      })
    ).toEqual([])
    expect(
      quickFixesFor({
        ...error("unused variable 'speed'"),
        severity: "warning",
      })
    ).toEqual([])
    expect(quickFixesFor(error("use of undeclared identifier 'mtr'"))).toEqual(
      []
    )
    expect(
      quickFixesFor(
        error("'struct Foo' has no member named 'bar'; did you mean 'baz'?")
      )
    ).toEqual([])
    expect(
      quickFixesFor(
        error("use of undeclared identifier 'mtr'; did you mean 'mo tor'?")
      )
    ).toEqual([])
  })

  it("edits only when the live text still has the expected characters", () => {
    const fix = {
      title: "Replace 'mtr' with 'motor'",
      line: 2,
      column: 5,
      expected: "mtr",
      replacement: "motor",
    }
    expect(quickFixEdit("int a;\n    mtr.spin();\n", fix)).toEqual({
      range: {
        start: { line: 1, character: 4 },
        end: { line: 1, character: 7 },
      },
      newText: "motor",
    })
    expect(() => quickFixEdit("int a;\n    mtz.spin();\n", fix)).toThrow(
      "Build again before applying this fix."
    )
    expect(() => quickFixEdit("int a;\n", fix)).toThrow(
      "Build again before applying this fix."
    )
  })

  it("inserts at the reported column, and refuses positions past the end of the line", () => {
    // "int x = 5" ends at column 10: the compiler points just past the last token.
    const fix = quickFixesFor(error("expected ';' after expression", 10))[0]
    expect(quickFixEdit("int x = 5\n", { ...fix, line: 1 })).toEqual({
      range: {
        start: { line: 0, character: 9 },
        end: { line: 0, character: 9 },
      },
      newText: ";",
    })
    expect(() => quickFixEdit("int x\n", { ...fix, line: 1 })).toThrow(
      "Build again before applying this fix."
    )
  })
})
