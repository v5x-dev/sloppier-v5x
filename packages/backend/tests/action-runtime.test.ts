import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"

const require = createRequire(import.meta.resolve("convex/package.json"))
const { parse } = require("@babel/parser")

describe("repository action runtime", () => {
  it("declares the Node runtime so template extraction avoids the 64 MB isolate limit", () => {
    const source = readFileSync(
      new URL("../convex/codeStorage.ts", import.meta.url),
      "utf8"
    )
    const ast = parse(source, {
      sourceType: "module",
      plugins: ["typescript"],
    })
    expect(
      ast.program.directives.map(
        (d: { value: { value: string } }) => d.value.value
      )
    ).toContain("use node")
  })
})
