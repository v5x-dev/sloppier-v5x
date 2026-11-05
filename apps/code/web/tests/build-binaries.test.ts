import { createHash } from "node:crypto"
import { zipSync } from "fflate"
import { describe, expect, it } from "vitest"
import { loadArtifactFiles } from "../src/lib/build-binaries"
import type { BuildRequest } from "../src/lib/build-program"

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")
const encode = (text: string) => new TextEncoder().encode(text)

// A Builder that serves whole archives, or single entries by name as the indexed protocol does.
function builder(files: Record<string, Uint8Array>) {
  const requested: string[] = []
  const request: BuildRequest = async (path) => {
    requested.push(path)
    const entry = new URL(path, "http://builder").searchParams.get("entry")
    if (entry === null) return new Response(zipSync(files))
    const bytes = Object.hasOwn(files, entry) ? files[entry] : undefined
    return bytes
      ? new Response(new Uint8Array(bytes))
      : new Response("{}", { status: 404 })
  }
  return { request, requested }
}

describe("loadArtifactFiles", () => {
  it("fetches only the files it does not already hold, by digest", async () => {
    const cold = new Uint8Array(4096).fill(11)
    const hot = encode("hot one")
    const first = builder({
      "bin/hot.package.bin": hot,
      "bin/cold.package.bin": cold,
    })
    const entries = {
      "bin/hot.package.bin": { sha256: digest(hot), bytes: hot.length },
      "bin/cold.package.bin": { sha256: digest(cold), bytes: cold.length },
    }
    const before = await loadArtifactFiles(first.request, {
      artifactId: "build-1",
      entries,
    })
    expect(before["bin/cold.package.bin"]).toEqual(cold)
    expect(first.requested.sort()).toEqual([
      "/artifact?id=build-1&entry=bin%2Fcold.package.bin",
      "/artifact?id=build-1&entry=bin%2Fhot.package.bin",
    ])

    // A later build changes only the hot package; the cold package is the same bytes and is not downloaded again.
    const hotTwo = encode("hot two")
    const second = builder({
      "bin/hot.package.bin": hotTwo,
      "bin/cold.package.bin": cold,
    })
    const after = await loadArtifactFiles(second.request, {
      artifactId: "build-2",
      entries: {
        "bin/hot.package.bin": { sha256: digest(hotTwo), bytes: hotTwo.length },
        "bin/cold.package.bin": { sha256: digest(cold), bytes: cold.length },
      },
    })
    expect(second.requested).toEqual([
      "/artifact?id=build-2&entry=bin%2Fhot.package.bin",
    ])
    expect(after["bin/hot.package.bin"]).toEqual(hotTwo)
    expect(after["bin/cold.package.bin"]).toBe(before["bin/cold.package.bin"])
  })

  it("refuses a file whose bytes do not match the digest the build reported", async () => {
    const reported = encode("hot program")
    const served = encode("hot progrAm")
    const { request } = builder({ "bin/hot.package.bin": served })
    await expect(
      loadArtifactFiles(request, {
        artifactId: "build-3",
        entries: {
          "bin/hot.package.bin": {
            sha256: digest(reported),
            bytes: reported.length,
          },
        },
      })
    ).rejects.toThrow("The build changed while downloading")
  })

  it("reads the whole archive from a Builder that does not index its files", async () => {
    const { request, requested } = builder({
      "bin/program.bin": new Uint8Array([1, 2, 3]),
    })
    expect(
      await loadArtifactFiles(request, {
        artifactId: "old-build",
        entries: null,
      })
    ).toEqual({
      "bin/program.bin": new Uint8Array([1, 2, 3]),
    })
    expect(requested).toEqual(["/artifact?id=old-build"])
  })

  it("rejects an indexed path that escapes the build folder or is not a binary", async () => {
    const { request } = builder({})
    await expect(
      loadArtifactFiles(request, {
        artifactId: "build-4",
        entries: {
          "../secrets.bin": { sha256: digest(encode("x")), bytes: 1 },
        },
      })
    ).rejects.toThrow("Invalid binary path")
    await expect(
      loadArtifactFiles(request, {
        artifactId: "build-4",
        entries: { "bin/notes.txt": { sha256: digest(encode("x")), bytes: 1 } },
      })
    ).rejects.toThrow("Invalid binary path")
  })
})
