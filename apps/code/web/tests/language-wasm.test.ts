import { gzipSync } from "node:zlib"
import { expect, it } from "vitest"
import { wasmResponse } from "../src/lib/language/wasm-response"

const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])

it("compiles gzip bytes served without Content-Encoding, as production does", async () => {
  const bytes = new Uint8Array(gzipSync(wasm))
  const response = new Response(bytes, {
    headers: { "Content-Type": "application/wasm" },
  })
  await expect(
    WebAssembly.compileStreaming(wasmResponse(response))
  ).resolves.toBeInstanceOf(WebAssembly.Module)
})

it("does not decompress Wasm already decoded by fetch", async () => {
  await expect(
    WebAssembly.compileStreaming(wasmResponse(new Response(wasm)))
  ).resolves.toBeInstanceOf(WebAssembly.Module)
})

it("handles gzip magic split across network chunks", async () => {
  const bytes = new Uint8Array(gzipSync(wasm))
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 1))
      controller.enqueue(bytes.slice(1))
      controller.close()
    },
  })
  await expect(
    WebAssembly.compileStreaming(wasmResponse(new Response(body)))
  ).resolves.toBeInstanceOf(WebAssembly.Module)
})

it("reports HTTP failures before compiling", async () => {
  await expect(
    wasmResponse(new Response("missing", { status: 404 }))
  ).rejects.toThrow("HTTP 404")
})
