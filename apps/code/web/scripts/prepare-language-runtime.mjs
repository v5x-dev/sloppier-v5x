// Pinned upstream build. Generated assets are reproducible and stay out of git.
import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"

import { gzipSync } from "node:zlib"

const cache = new URL("../.cache/language/", import.meta.url)
await mkdir(cache, { recursive: true })
const directory = new URL("../public/language/", import.meta.url)
await mkdir(directory, { recursive: true })
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
const legacy = { kind: "asyncify", initialMemory: 128 * 1024 * 1024 }
const manifest = { asyncify: legacy }
const hashes = {
  "clangd.js":
    "a7ff1c588eb5374783bbda84d949b92b8027c2381c786072448b96eba90c7027",
  "clangd.wasm":
    "0d71e7a7f8e6dd369cb2a0b22cc4016d649f370e5b905adb6092536deb0ee019",
}
for (const [name, expected] of Object.entries(hashes)) {
  const cached = new URL(name + ".upstream", cache)
  let bytes = await readFile(cached).catch(() => null)
  if (!bytes || createHash("sha256").update(bytes).digest("hex") !== expected) {
    const response = await fetch(`https://clangd.guyutongxue.site/wasm/${name}`)
    if (!response.ok)
      throw new Error(`clangd download failed: ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
    if (createHash("sha256").update(bytes).digest("hex") !== expected)
      throw new Error(`clangd integrity check failed: ${name}`)
    await writeFile(cached, bytes)
  }
  if (name.endsWith(".js")) {
    const original =
      "var pthreadPoolSize=Math.max(navigator.hardwareConcurrency,8)"
    const source = bytes.toString()
    if (!source.includes(original))
      throw new Error("Upstream pthread pool changed")
    // clangd -j=1 needs a bounded pool, including its main/async service threads.
    const cores =
      'var _emscripten_num_logical_cores=()=>navigator["hardwareConcurrency"]'
    if (!source.includes(cores))
      throw new Error("Upstream core-count function changed")
    const patched = source
      .replace(original, 'var pthreadPoolSize=Module["v5xThreadPoolSize"]||8')
      .replace(cores, "var _emscripten_num_logical_cores=()=>2")
    legacy.js = `clangd-${digest(patched).slice(0, 16)}.js`
    await writeFile(new URL(legacy.js, directory), patched)
  } else {
    // The pinned module imports shared memory with a 2 GiB minimum. Lower that
    // declaration to match the runtime allocation; keep the same LEB byte width.
    const marker = Buffer.from([
      6,
      ...Buffer.from("memory"),
      2,
      3,
      0x80,
      0x80,
      2,
      0x80,
      0x80,
      4,
    ])
    const at = bytes.indexOf(marker)
    if (at < 0 || bytes.indexOf(marker, at + 1) >= 0)
      throw new Error("Wasm memory import changed")
    bytes = Buffer.from(bytes)
    bytes.set([0x80, 0x90, 0], at + 9) // 2048 pages = 128 MiB
    if (!WebAssembly.validate(bytes))
      throw new Error("Invalid patched clangd module")
    const compressed = gzipSync(bytes, { level: 9 })
    const version = digest(compressed).slice(0, 16)
    // This pinned build fits Cloudflare's 25 MiB static-asset limit after gzip.
    // Serve with Content-Encoding so fetch/compileStreaming use native caches.
    if (compressed.length > 25 * 1024 * 1024)
      throw new Error("clangd exceeds static asset limit")
    const wasm = `clangd-${version}.wasm`
    await writeFile(new URL(wasm, directory), compressed)
    Object.assign(legacy, {
      wasm,
      bytes: bytes.length,
      compressedBytes: compressed.length,
      sha256: digest(bytes),
      upstreamSha256: expected,
    })
  }
}
const nativeDirectory = new URL(
  "../../../../infra/language/runtime/",
  import.meta.url
)
const native = await readFile(new URL("manifest.json", nativeDirectory))
  .then((bytes) => JSON.parse(bytes))
  .catch((error) => {
    if (error.code === "ENOENT") return null
    throw error
  })
if (native) {
  const js = await readFile(new URL("clangd.js", nativeDirectory))
  const wasm = await readFile(new URL("clangd.wasm.gz", nativeDirectory))
  if (
    digest(js) !== native.jsSha256 ||
    digest(wasm) !== native.compressedSha256
  )
    throw new Error("JSPI runtime integrity check failed")
  const jsName = `clangd-jspi-${digest(js).slice(0, 16)}.js`
  const wasmName = `clangd-${digest(wasm).slice(0, 16)}.wasm`
  await writeFile(new URL(jsName, directory), js)
  await writeFile(new URL(wasmName, directory), wasm)
  manifest.jspi = { ...native, js: jsName, wasm: wasmName }
}
await writeFile(new URL("runtime.json", directory), JSON.stringify(manifest))
const sdkFiles = {}
for (const template of ["newlib", "pros", "ez-template", "vexcode"]) {
  const bytes = await readFile(
    new URL(`../../../../infra/language/sdk/${template}.zip`, import.meta.url)
  )
  const name = `${template}-${digest(bytes).slice(0, 16)}.zip`
  await writeFile(new URL(name, directory), bytes)
  sdkFiles[template] = name
}
const sdks = {
  pros: [sdkFiles.newlib, sdkFiles.pros],
  "ez-template": [sdkFiles.newlib, sdkFiles["ez-template"]],
  vexcode: [sdkFiles.vexcode],
  jar: [sdkFiles.vexcode],
}
await writeFile(new URL("sdk.json", directory), JSON.stringify(sdks))
const keep = new Set([
  "runtime.json",
  "sdk.json",
  ...Object.values(manifest).flatMap((runtime) => [runtime.js, runtime.wasm]),
  ...Object.values(sdkFiles),
])
for (const name of await readdir(directory)) {
  if (!keep.has(name)) await rm(new URL(name, directory))
}
console.log("Prepared pinned clangd browser runtime and SDKs")
