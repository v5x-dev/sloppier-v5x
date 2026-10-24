import { describe, expect, test } from "bun:test"
import {
  assertAvailable,
  containsPath,
  copyDestination,
  joinPath,
  parentPath,
  rootEntries,
  validateNewPath,
} from "../apps/code/web/src/lib/explorer"

describe("Explorer repository paths", () => {
  test("folder operations include descendants but never similarly named siblings", () => {
    expect(containsPath("src/", "src/main.cpp")).toBe(true)
    expect(containsPath("src", "src-old/main.cpp")).toBe(false)
    expect(parentPath("src/nested/")).toBe("src")
    expect(joinPath("src/", "nested/main.cpp")).toBe("src/nested/main.cpp")
  })

  test("rejects traversal, reserved storage, and malformed destination paths", () => {
    for (const path of [
      "",
      "../secret",
      "src/../main.cpp",
      "/main.cpp",
      "src//main.cpp",
      "src\\main.cpp",
      ".v5x/log.bin",
      "src/\0file",
      " file ",
    ]) {
      expect(() => validateNewPath(path)).toThrow()
    }
    expect(validateNewPath("src/new folder/main.cpp")).toBe(
      "src/new folder/main.cpp"
    )
  })

  test("rejects replacing a folder, file, or an ancestor file", () => {
    const paths = ["src/main.cpp", "README.md"]
    for (const destination of [
      "src",
      "src/main.cpp",
      "src/main.cpp/new",
      "README.md/new",
    ]) {
      expect(() => assertAvailable(destination, paths)).toThrow()
    }
    expect(() => assertAvailable("src/other.cpp", paths)).not.toThrow()
  })

  test("copying in the same folder picks a free name and preserves extensions", () => {
    expect(
      copyDestination("src/main.cpp", "src", [
        "src/main.cpp",
        "src/main copy.cpp",
      ])
    ).toBe("src/main copy 2.cpp")
    expect(copyDestination(".gitignore", "", [".gitignore"])).toBe(
      ".gitignore copy"
    )
    expect(
      copyDestination("src", "", ["src/main.cpp", "src copy/main.cpp"])
    ).toBe("src copy 2")
    expect(copyDestination("src/main.cpp", "other", [])).toBe("other/main.cpp")
  })

  test("multi-selection operates on each subtree once", () => {
    expect(
      rootEntries([
        { path: "src/main.cpp", kind: "file" },
        { path: "src/", kind: "directory" },
        { path: "src/", kind: "directory" },
        { path: "src-old/main.cpp", kind: "file" },
      ])
    ).toEqual([
      { path: "src/", kind: "directory" },
      { path: "src-old/main.cpp", kind: "file" },
    ])
  })
})
