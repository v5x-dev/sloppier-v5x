import { expect, test } from "vitest"
import { zipSync } from "fflate"
import { readBuildBinaries } from "../src/lib/build-binaries"

test("downloads all binaries, retaining bytes and excluding other outputs", () => {
  const bytes = new Uint8Array([0, 255, 128, 1])
  const result = readBuildBinaries(
    zipSync({
      "bin/program.bin": bytes,
      "build/secondary.bin": bytes,
      "bin/program.elf": bytes,
      "src/main.cpp": bytes,
    })
  )
  expect(Object.keys(result)).toEqual([
    "bin/program.bin",
    "build/secondary.bin",
  ])
  expect(result["bin/program.bin"]).toEqual(bytes)
})

test("rejects archive paths that escape the client bin folder", () => {
  for (const path of [
    "../escape.bin",
    "/absolute.bin",
    "bin/../../escape.bin",
    "bin\\escape.bin",
  ]) {
    expect(() =>
      readBuildBinaries(zipSync({ [path]: new Uint8Array([1]) }))
    ).toThrow("Invalid binary path")
  }
})
