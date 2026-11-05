import { describe, expect, it } from "vitest"
import { encodeSourceText, sourceHash } from "../src/lib/build-source"

// infra/build/test-build-server.py asserts this same value for the Builder's source_hash.
const vector = {
  "src/main.cpp": encodeSourceText("int main() {}"),
  Makefile: encodeSourceText("all:"),
  "include/main.h": encodeSourceText("#pragma once"),
}
const EXPECTED =
  "a6c1c674b9a1fae9dcf6350a9c6f456d673f01c793c106946f0f8e623ee369b5"

describe("sourceHash", () => {
  it("matches the Builder's source hash for the shared vector", async () => {
    expect(await sourceHash(vector)).toBe(EXPECTED)
  })

  it("does not depend on the order files were added", async () => {
    const reversed = Object.fromEntries(Object.entries(vector).reverse())
    expect(await sourceHash(reversed)).toBe(EXPECTED)
  })

  it("changes when contents or paths change", async () => {
    const changed = {
      ...vector,
      "src/main.cpp": encodeSourceText("int main() { return 1; }"),
    }
    const renamed = { ...vector, "src/other.cpp": vector["src/main.cpp"] }
    delete (renamed as Record<string, unknown>)["src/main.cpp"]
    expect(await sourceHash(changed)).not.toBe(EXPECTED)
    expect(await sourceHash(renamed)).not.toBe(EXPECTED)
  })

  it("separates a path from the bytes that follow it", async () => {
    // Without the NUL separator, these two snapshots would hash the same concatenated bytes.
    const a = { ab: encodeSourceText("c") }
    const b = { a: encodeSourceText("bc") }
    expect(await sourceHash(a)).not.toBe(await sourceHash(b))
  })
})
