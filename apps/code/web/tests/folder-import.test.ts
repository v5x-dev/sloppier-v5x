import { describe, expect, it } from "vitest"
import {
  folderBatches,
  planFolder,
  selectedFolder,
} from "../src/lib/folder-import"
import {
  IMPORT_BATCH_BYTES,
  IMPORT_MAX_BYTES,
} from "@v5x/backend/imports"

function file(path: string, contents: string | Uint8Array = "// source") {
  const value = new File(
    [
      typeof contents === "string"
        ? contents
        : (contents.buffer as ArrayBuffer),
    ],
    path.split("/").at(-1)!
  )
  Object.defineProperty(value, "webkitRelativePath", { value: path })
  return value
}

describe("local folder import", () => {
  it("strips only the selected root folder and detects the program before filtering dependencies", () => {
    const folder = selectedFolder([
      file("Robot/project.pros"),
      file("Robot/include/EZ-Template/api.hpp"),
      file("Robot/src/drive/main.cpp"),
      file("Robot/bin/output.bin"),
      file("Robot/.git/config"),
      file("Robot/.env.local"),
    ])
    expect(folder.name).toBe("Robot")
    expect(folder.template).toBe("ez-template")
    const plan = planFolder(folder.entries, folder.template!)
    expect(plan.included.map((entry) => entry.path)).toEqual([
      "project.pros",
      "src/drive/main.cpp",
    ])
    expect(plan.skipped).toHaveLength(4)
  })

  it.each(["pros", "ez-template"] as const)(
    "removes nonessential %s files while preserving custom source and build inputs",
    (template) => {
      const essential = [
        "project.pros",
        "Makefile",
        "src/main.cpp",
        "include/main.h",
        "include/custom/robot.hpp",
        "custom-rules.mk",
        "assets/robot.dat",
        "LICENSE",
        "include/custom/LICENSE.md",
      ]
      const nonessential = [
        "firmware/v5.ld",
        "firmware/libpros.a",
        "include/pros/api.h",
        "common.mk",
        ".vscode/settings.json",
        ".github/workflows/build.yml",
        ".idea/workspace.xml",
        ".pros/cache.json",
        ".clang-format",
        "compile_commands.json",
        "compile_flags.txt",
        "README.md",
        "CHANGELOG.md",
        "docs/setup.md",
        "EZ-Template@3.2.2.zip",
        "kernel-4.1.1.zip",
        "build.log",
      ]
      if (template === "ez-template")
        nonessential.push(
          "include/EZ-Template/api.hpp",
          "include/okapi/api.hpp"
        )
      const folder = selectedFolder(
        [...essential, ...nonessential].map((path) => file(`Robot/${path}`))
      )
      const plan = planFolder(folder.entries, template)
      expect(plan.included.map((entry) => entry.path).sort()).toEqual(
        [...essential].sort()
      )
      expect(plan.skipped.map((entry) => entry.path).sort()).toEqual(
        [...nonessential].sort()
      )
    }
  )

  it("batches file bytes within request limits while preserving empty and binary files", async () => {
    const folder = selectedFolder([
      file("Robot/assets/one.dat", new Uint8Array(IMPORT_BATCH_BYTES)),
      file("Robot/assets/two.dat", Uint8Array.of(0, 255, 128)),
      file("Robot/empty.txt", ""),
    ])
    const batches = []
    for await (const batch of folderBatches(
      planFolder(folder.entries, "vexcode").included
    ))
      batches.push(batch)
    expect(batches).toHaveLength(2)
    expect(batches.flat().map((entry) => entry.path)).toEqual([
      "assets/one.dat",
      "assets/two.dat",
      "empty.txt",
    ])
    expect([...new Uint8Array(batches[1][0].contents)]).toEqual([0, 255, 128])
    expect(batches[1][1].contents.byteLength).toBe(0)
    expect(
      batches.every(
        (batch) =>
          batch.reduce((sum, entry) => sum + entry.contents.byteLength, 0) <=
          IMPORT_BATCH_BYTES
      )
    ).toBe(true)
  })

  it("rejects ordinary files, mixed roots, empty source folders, traversal, and oversized files", () => {
    expect(() => selectedFolder([new File([""], "file.cpp")])).toThrow(
      "single program folder"
    )
    expect(() => selectedFolder([file("A/a.cpp"), file("B/b.cpp")])).toThrow(
      "single program folder"
    )
    expect(() =>
      planFolder(selectedFolder([file("Robot/.git/config")]).entries, "pros")
    ).toThrow("no files to import")
    expect(() =>
      planFolder(selectedFolder([file("Robot/../escape.cpp")]).entries, "pros")
    ).toThrow()
    expect(() =>
      planFolder(
        selectedFolder([
          file("Robot/big.txt", new Uint8Array(IMPORT_BATCH_BYTES + 1)),
        ]).entries,
        "pros"
      )
    ).toThrow("384 KiB")
  })

  it("enforces source size and count limits before reading file contents", () => {
    const large = Array.from(
      { length: Math.ceil(IMPORT_MAX_BYTES / IMPORT_BATCH_BYTES) + 1 },
      (_, index) => {
        const value = file(`Robot/${index}.txt`)
        Object.defineProperty(value, "size", { value: IMPORT_BATCH_BYTES })
        return value
      }
    )
    expect(() => planFolder(selectedFolder(large).entries, "pros")).toThrow(
      "16 MiB"
    )
    const many = Array.from({ length: 1001 }, (_, index) =>
      file(`Robot/${index}.txt`, "")
    )
    expect(() => planFolder(selectedFolder(many).entries, "pros")).toThrow(
      "1,000 files"
    )
  })
})
