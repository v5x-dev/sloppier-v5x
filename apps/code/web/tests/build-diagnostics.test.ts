import { describe, expect, it } from "vitest"
import {
  diagnosticRevision,
  diagnosticsAreStale,
  parseBuildDiagnostics,
  resolveDiagnosticPath,
} from "../src/lib/build-diagnostics"

describe("compiler diagnostics", () => {
  it("reads Clang/GCC diagnostics without mistaking source snippets and linker output for locations", () => {
    const result = parseBuildDiagnostics(
      [
        "Building commit abc123",
        "\x1b[1msrc/main.cpp:12:7: \x1b[31merror: \x1b[0muse of undeclared identifier 'motor'",
        "   12 | motor.spin();",
        "      | ^",
        "./include/robot.hpp:4: warning: unused variable 'speed' [-Wunused-variable]",
        "src/main.cpp:9:1: note: declared here",
        "/usr/include/missing.h:1:1: fatal error: file not found",
        "arm-none-eabi-ld: error: undefined reference to main",
        "make: *** [build/main.o] Error 1",
      ].join("\n")
    )
    expect(result).toEqual([
      {
        path: "src/main.cpp",
        line: 12,
        column: 7,
        severity: "error",
        message: "use of undeclared identifier 'motor'",
      },
      {
        path: "include/robot.hpp",
        line: 4,
        severity: "warning",
        message: "unused variable 'speed' [-Wunused-variable]",
      },
      {
        path: "src/main.cpp",
        line: 9,
        column: 1,
        severity: "note",
        message: "declared here",
      },
      {
        path: "/usr/include/missing.h",
        line: 1,
        column: 1,
        severity: "error",
        message: "file not found",
      },
    ])
  })
  it("handles colons, spaces, Windows paths, CRLF, and duplicate diagnostics", () => {
    expect(
      parseBuildDiagnostics(
        "C:\\robot code\\main.cpp:3:2: error: bad value\r\nC:\\robot code\\main.cpp:3:2: error: bad value\r\n"
      )
    ).toEqual([
      {
        path: "C:/robot code/main.cpp",
        line: 3,
        column: 2,
        severity: "error",
        message: "bad value",
      },
    ])
    expect(
      parseBuildDiagnostics(
        "main.cpp:0:1: error: bad\nmain.cpp:1:0: error: bad\nmain.cpp:2:1: error:"
      )
    ).toEqual([])
  })
  it("only resolves known files under the actual build source root", () => {
    const paths = ["src/main.cpp", "include/main.h"]
    expect(resolveDiagnosticPath("src/main.cpp", paths)).toBe("src/main.cpp")
    expect(
      resolveDiagnosticPath(
        "/home/builder/workspace/source/include/main.h",
        paths
      )
    ).toBe("include/main.h")
    expect(resolveDiagnosticPath("/sdk/include/main.h", paths)).toBeUndefined()
    expect(resolveDiagnosticPath("main.cpp", paths)).toBeUndefined()
    expect(resolveDiagnosticPath("../src/main.cpp", paths)).toBeUndefined()
  })
  it("tracks stale locations through edits, commits, and incomplete log history", () => {
    const logs = "Building commit abc123\nBuild succeeded."
    expect(diagnosticRevision(logs)).toBe("abc123")
    expect(diagnosticsAreStale(logs, "abc123", false)).toBe(false)
    expect(diagnosticsAreStale(logs, "abc123", true)).toBe(true)
    expect(diagnosticsAreStale(logs, "def456", false)).toBe(true)
    expect(diagnosticsAreStale("truncated output", "def456", false)).toBe(false)
  })
})
