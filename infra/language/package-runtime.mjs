// Package the locally built JSPI runtime with verifiable, checked-in provenance.
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { gzipSync } from "node:zlib"

const build = process.argv[2]
if (!build) throw new Error("Pass the build-jspi/bin directory")
const directory = new URL("./runtime/", import.meta.url)
await mkdir(directory, { recursive: true })
const js = await readFile(resolve(build, "clangd.js"))
const wasm = await readFile(resolve(build, "clangd.wasm"))
if (!WebAssembly.validate(wasm)) throw new Error("Invalid clangd Wasm module")
const compressed = gzipSync(wasm, { level: 9 })
if (compressed.length > 25 * 1024 * 1024)
  throw new Error("Runtime exceeds the static asset limit")
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
await writeFile(new URL("clangd.js", directory), js)
await writeFile(new URL("clangd.wasm.gz", directory), compressed)
await writeFile(
  new URL("manifest.json", directory),
  JSON.stringify(
    {
      llvm: "21.1.0",
      llvmCommit: "3623fe661ae35c6c80ac221f14d85be76aa870f1",
      emscripten: "4.0.22",
      kind: "jspi",
      initialMemory: 64 * 1024 * 1024,
      jsSha256: digest(js),
      compressedSha256: digest(compressed),
      sha256: digest(wasm),
      bytes: wasm.length,
      compressedBytes: compressed.length,
    },
    null,
    2
  ) + "\n"
)
console.log("Packaged JSPI clangd:", compressed.length, "compressed bytes")
