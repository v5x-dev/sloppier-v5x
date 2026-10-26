/// <reference lib="webworker" />
import { unzipSync } from "fflate"
import {
  definitionPath,
  encodeMessage,
  LspOutput,
  type RpcMessage,
} from "./protocol"

declare const self: DedicatedWorkerGlobalScope

type FileSystem = {
  mkdirTree: (path: string) => void
  writeFile: (
    path: string,
    contents: string | Uint8Array,
    options?: { canOwn: boolean }
  ) => void
  readFile: (path: string) => Uint8Array
}
type Runtime = {
  FS: FileSystem
  callMain: (args: string[]) => void | Promise<void>
}
const root = "/workspace"
let memory: WebAssembly.Memory | null = null
let runtime: Runtime | null = null
let queue: Uint8Array[] = []
let queueIndex = 0
let byteIndex = 0
let wake = () => {}
let receiveSource!: (files: Record<string, Uint8Array>) => void
const sourceReady = new Promise<Record<string, Uint8Array>>((resolve) => {
  receiveSource = resolve
})
const output = new LspOutput((message) =>
  self.postMessage({ type: "message", message })
)

function stdin() {
  if (queueIndex >= queue.length) return null
  const current = queue[queueIndex]
  if (byteIndex < current.length) return current[byteIndex++]
  byteIndex = 0
  queueIndex++
  if (queueIndex === queue.length) {
    queue = []
    queueIndex = 0
  }
  return null
}
function write(path: string, contents: string | Uint8Array) {
  if (!runtime) throw new Error("clangd is not initialized")
  runtime.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")))
  runtime.FS.writeFile(path, contents, { canOwn: true })
}
async function start(data: {
  files?: Record<string, Uint8Array>
  template: string
  initialMemory?: number
  threads?: number
  debug?: boolean
  runtime?: "jspi" | "asyncify"
}) {
  if (!self.crossOriginIsolated)
    throw new Error("Browser language services require cross-origin isolation")
  const started = performance.now()
  const base = new URL("/language/", self.location.origin)
  const manifestResponse = await fetch(new URL("runtime.json", base))
  if (!manifestResponse.ok)
    throw new Error("Browser clangd assets are unavailable")
  type Artifact = {
    wasm: string
    js: string
    initialMemory: number
    kind: string
  }
  const manifest = (await manifestResponse.json()) as {
    asyncify: Artifact
    jspi?: Artifact
  }
  const nativeSuspension =
    "Suspending" in WebAssembly && "promising" in WebAssembly
  if (data.runtime === "jspi" && (!nativeSuspension || !manifest.jspi))
    throw new Error("The JSPI clangd runtime is unavailable in this browser")
  const artifact =
    data.runtime === "asyncify" || !nativeSuspension
      ? manifest.asyncify
      : (manifest.jspi ?? manifest.asyncify)
  // Native HTTP decompression streams directly into V8. A stable, hashed URL
  // also lets Chromium cache compiled Wasm code across worker sessions.
  const modulePromise = WebAssembly.compileStreaming(
    fetch(new URL(artifact.wasm, base), { cache: "force-cache" })
  )
  const sdkPromise = fetch(new URL("sdk.json", base)).then(async (response) => {
    if (!response.ok) throw new Error("Language SDK manifest unavailable")
    const sdks = (await response.json()) as Record<string, string[]>
    if (!Object.hasOwn(sdks, data.template))
      throw new Error("Unknown language SDK")
    const archives = await Promise.all(
      sdks[data.template].map(async (name) => {
        const archive = await fetch(new URL(name, base), {
          cache: "force-cache",
        })
        if (!archive.ok)
          throw new Error(`Language SDK unavailable: ${data.template}`)
        return unzipSync(new Uint8Array(await archive.arrayBuffer()))
      })
    )
    return Object.assign({}, ...archives) as Record<string, Uint8Array>
  })
  const js = new URL(artifact.js, base).href
  const [{ default: Clangd }, wasm, sdk] = await Promise.all([
    import(/* @vite-ignore */ js),
    modulePromise,
    sdkPromise,
  ])
  let stderr = ""
  runtime = await Clangd({
    thisProgram: "/usr/bin/clangd",
    mainScriptUrlOrBlob: js,
    INITIAL_MEMORY: data.initialMemory ?? artifact.initialMemory,
    v5xThreadPoolSize: data.threads ?? 8,
    instantiateWasm(
      imports: WebAssembly.Imports,
      receive: (
        instance: WebAssembly.Instance,
        module: WebAssembly.Module
      ) => void
    ) {
      memory =
        Object.values(imports)
          .flatMap((namespace) => Object.values(namespace))
          .find(
            (value): value is WebAssembly.Memory =>
              value instanceof WebAssembly.Memory
          ) ?? null
      if (!memory) throw new Error("clangd memory import is missing")
      const instance = new WebAssembly.Instance(wasm, imports)
      receive(instance, wasm)
      return instance.exports
    },
    stdin,
    stdinReady: () => {
      return queueIndex < queue.length
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            wake = resolve
          })
    },
    stdout: (byte: number) => output.push(byte),
    stderr: (byte: number) => {
      if (!data.debug) return
      if (byte === 10) {
        console.log(stderr)
        stderr = ""
      } else stderr += String.fromCharCode(byte)
    },
    onAbort: (reason: unknown) =>
      self.postMessage({ type: "error", error: String(reason) }),
  })
  for (const [path, contents] of Object.entries(sdk))
    write(`/${path}`, contents)
  const files = data.files ?? (await sourceReady)
  for (const [path, contents] of Object.entries(files)) {
    if (
      path.startsWith("/") ||
      path.split("/").includes("..") ||
      path.includes("\\")
    )
      throw new Error("Invalid program source path")
    write(`${root}/${path}`, contents)
  }
  const running = runtime!.callMain([
    "-j=1",
    "--background-index=false",
    "--pch-storage=memory",
    "--clang-tidy=false",
    "--header-insertion=never",
    "--limit-results=100",
    "--log=error",
    `--compile-commands-dir=${root}`,
  ])
  void Promise.resolve(running).catch((error) =>
    self.postMessage({ type: "error", error: String(error) })
  )
  self.postMessage({
    type: "ready",
    root,
    runtime: artifact.kind,
    startupMs: performance.now() - started,
    heapBytes: memory!.buffer.byteLength,
  })
}

self.onmessage = (event: MessageEvent) => {
  const data = event.data
  if (data.type === "start") {
    void start(data).catch((error) =>
      self.postMessage({ type: "error", error: String(error) })
    )
  } else if (data.type === "source") {
    receiveSource(data.files)
  } else if (data.type === "messages") {
    for (const message of data.messages as RpcMessage[]) {
      const frame = encodeMessage(message)
      // The upstream stdin patch waits before each header line and body. Keep
      // those reads separate so stdio read-ahead cannot wait on buffered input.
      const end = frame.indexOf(13) + 2
      queue.push(
        frame.subarray(0, end),
        frame.subarray(end, end + 2),
        frame.subarray(end + 2)
      )
    }
    wake()
  } else if (data.type === "read") {
    try {
      const path = definitionPath(data.uri)
      const bytes = runtime!.FS.readFile(path)
      if (bytes.length > 512 * 1024 || bytes.includes(0))
        throw new Error("Unsupported definition file")
      const contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      self.postMessage({
        type: "read",
        id: data.id,
        result: { path, contents },
      })
    } catch (error) {
      self.postMessage({ type: "read", id: data.id, error: String(error) })
    }
  } else if (data.type === "metrics") {
    self.postMessage({ type: "metrics", heapBytes: memory?.buffer.byteLength })
  }
}
