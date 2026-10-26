import { expect, test } from "vitest"
import { FileTree } from "@pierre/trees"
import { assertRepositoryPaths, isClientBuildPath } from "../src/lib/explorer"

test("Pierre treats generated binaries as files under its bin directory", () => {
  const model = new FileTree({
    paths: ["src/main.cpp", "bin/cold.package.bin", "bin/hot.package.bin"],
  })
  expect(model.getItem("bin")?.isDirectory()).toBe(true)
  expect(model.getItem("bin/cold.package.bin")?.isDirectory()).toBe(false)
  expect(model.getItem("src/main.cpp")?.isDirectory()).toBe(false)
  model.cleanUp()
})

test("generated bin files and folder cannot enter repository mutations", () => {
  const generated = ["bin/cold.package.bin", "bin/hot.package.bin"]
  for (const path of [
    "bin",
    "bin/",
    "bin/hot.package.bin",
    "bin/nested/new.bin",
  ]) {
    expect(isClientBuildPath(path, generated)).toBe(true)
    expect(() =>
      assertRepositoryPaths(["src/main.cpp", path], generated)
    ).toThrow("client-only")
  }
  expect(() =>
    assertRepositoryPaths(["src/main.cpp", "binary/file.cpp"], generated)
  ).not.toThrow()
  expect(() => assertRepositoryPaths(["bin/source.txt"], [])).not.toThrow()
})
