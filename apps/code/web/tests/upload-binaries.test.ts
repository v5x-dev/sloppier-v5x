import { expect, test } from "vitest"
import { selectUploadProgram } from "../src/lib/upload-binaries"

const bytes = new Uint8Array([1, 2, 3])

test("uses a matched hot/cold pair even when a monolith is also present", () => {
  expect(
    selectUploadProgram({
      "bin/hot.package.bin": bytes,
      "bin/cold.package.bin": bytes,
      "bin/monolith.bin": bytes,
    })
  ).toEqual({ type: "hot-cold", hot: bytes, cold: bytes })
})
test("selects monolith and VEXcode program builds", () => {
  for (const path of [
    "bin/monolith.bin",
    "bin/build/program.bin",
    "bin/robot.bin",
  ])
    expect(selectUploadProgram({ [path]: bytes })).toEqual({
      type: "monolith",
      data: bytes,
    })
})
test("rejects missing, empty, mismatched, and ambiguous packages", () => {
  const invalid: Record<string, Uint8Array>[] = [
    {},
    { "hot.package.bin": bytes },
    { "cold.package.bin": bytes },
    { "a/hot.package.bin": bytes, "b/cold.package.bin": bytes },
    { "a/program.bin": bytes, "b/program.bin": bytes },
    { "program.bin": new Uint8Array() },
  ]
  for (const files of invalid)
    expect(() => selectUploadProgram(files)).toThrow()
})
