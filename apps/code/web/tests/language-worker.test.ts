import * as Y from "yjs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LanguageClient, RequestCancelled } from "../src/lib/language-client"
import {
  definitionPath,
  encodeMessage,
  LspOutput,
  type RpcMessage,
} from "../src/lib/language/protocol"
import {
  WorkerLanguageTransport,
  type LanguageTransport,
} from "../src/lib/language/worker-transport"

class TestWorker {
  static instances: TestWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() {
    TestWorker.instances.push(this)
  }
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }
}
const source = {
  sha: "snapshot",
  files: { "src/main.cpp": new TextEncoder().encode("// 🤖\n") },
}

afterEach(() => {
  vi.unstubAllGlobals()
  TestWorker.instances = []
})

describe("worker definition paths", () => {
  it("reads source and SDK URIs with escaped paths", () => {
    expect(definitionPath("file:///workspace/include/my%20robot.hpp")).toBe(
      "/workspace/include/my robot.hpp"
    )
    expect(
      definitionPath("file:///usr/include/newlib/c++/13.2.1/vector")
    ).toContain("/newlib/")
  })
  it("rejects remote URIs and traversal including encoded directory separators", () => {
    for (const uri of [
      "https://example.com/header",
      "file://other/workspace/main.cpp",
      "file:///workspace/../private.h",
      "file:///workspace/%2e%2e%2fproc/self/fd/0",
      "file:///workspace/main.cpp?token=ignored",
    ])
      expect(() => definitionPath(uri)).toThrow()
  })
})

describe("worker LSP framing", () => {
  it("uses UTF-8 byte lengths and preserves adjacent messages with Unicode and JSON escapes", () => {
    const received: RpcMessage[] = []
    const output = new LspOutput((message) => received.push(message))
    const messages = [
      { id: 1, result: { text: 'π 🤖 {\\"}\n' } },
      { id: 2, result: null },
    ]
    for (const message of messages)
      for (const byte of encodeMessage(message)) output.push(byte)
    expect(received).toEqual(messages)
  })
  it("rejects oversized messages before allocating the body", () => {
    const output = new LspOutput(vi.fn())
    expect(() => {
      for (const byte of new TextEncoder().encode(
        "Content-Length: 999999999\r\n\r\n"
      ))
        output.push(byte)
    }).toThrow("Invalid LSP message length")
  })
})

describe("browser language transport", () => {
  it("starts from local source, forwards LSP, and reads SDK definitions without HTTP requests", async () => {
    vi.stubGlobal("Worker", TestWorker)
    const receive = vi.fn(),
      failed = vi.fn()
    const transport = new WorkerLanguageTransport("pros")
    const starting = transport.start(Promise.resolve(source), receive, failed)
    const worker = TestWorker.instances[0]
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "start",
      template: "pros",
    })
    await Promise.resolve()
    expect(worker.postMessage).toHaveBeenCalledWith(
      { type: "source", files: source.files },
      [source.files["src/main.cpp"].buffer]
    )
    worker.emit({ type: "ready", root: "/workspace" })
    expect(await starting).toBe("/workspace")
    worker.emit({ type: "message", message: { id: 1, result: true } })
    expect(receive).toHaveBeenCalledWith({ id: 1, result: true })
    const signal = new AbortController().signal
    const reading = transport.read(
      "file:///workspace/include/pros/motors.hpp",
      signal
    )
    const request = worker.postMessage.mock.lastCall![0]
    worker.emit({
      type: "read",
      id: request.id,
      result: { path: "motors.hpp", contents: "class Motor {};" },
    })
    expect(await reading).toEqual({
      path: "motors.hpp",
      contents: "class Motor {};",
    })
    expect(source.files["src/main.cpp"].byteLength).toBeGreaterThan(0)
    transport.stop()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it("terminates a failed worker and rejects reads when the session stops", async () => {
    vi.stubGlobal("Worker", TestWorker)
    const failed = vi.fn()
    const transport = new WorkerLanguageTransport("pros")
    const starting = transport.start(Promise.resolve(source), vi.fn(), failed)
    const worker = TestWorker.instances[0]
    worker.emit({ type: "ready", root: "/workspace" })
    await starting
    const reading = transport.read(
      "file:///workspace/main.cpp",
      new AbortController().signal
    )
    const rejection = expect(reading).rejects.toThrow("stopped")
    worker.emit({ type: "error", error: "out of memory" })
    await rejection
    expect(failed).toHaveBeenCalledWith(new Error("out of memory"))
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it("starts the runtime before source arrives and discards a stopped session's late source", async () => {
    vi.stubGlobal("Worker", TestWorker)
    let finish!: (value: typeof source) => void
    const snapshot = new Promise<typeof source>((resolve) => {
      finish = resolve
    })
    const transport = new WorkerLanguageTransport("pros")
    const first = transport.start(snapshot, vi.fn(), vi.fn())
    const rejection = expect(first).rejects.toThrow("stopped")
    expect(TestWorker.instances[0].postMessage).toHaveBeenCalledWith({
      type: "start",
      template: "pros",
    })
    const second = transport.start(Promise.resolve(source), vi.fn(), vi.fn())
    TestWorker.instances[1].emit({ type: "ready", root: "/workspace" })
    await second
    finish(source)
    await rejection
    await Promise.resolve()
    expect(TestWorker.instances[0].postMessage).toHaveBeenCalledTimes(1)
    expect(TestWorker.instances[1].terminate).not.toHaveBeenCalled()
    transport.stop()
  })
})

describe("local language session", () => {
  it("orders collaborative edits before completion and cancels an outstanding request", async () => {
    let receive!: (message: RpcMessage) => void
    const messages: RpcMessage[] = []
    const transport: LanguageTransport = {
      start: vi.fn(async (_source, callback) => {
        receive = callback
        return "/workspace"
      }),
      send: (batch) => {
        messages.push(...batch)
        for (const message of batch)
          if (message.method === "initialize")
            receive({ id: message.id, result: { capabilities: {} } })
      },
      read: vi.fn(),
      stop: vi.fn(),
    }
    const client = new LanguageClient(transport, async () => source)
    const doc = new Y.Doc()
    const text = doc.getText("source")
    text.insert(0, "void probe() {}")
    client.openDocument("src/main.cpp", text)
    await client.start()
    text.insert(13, "π")
    const controller = new AbortController()
    const completion = client.completion(
      "src/main.cpp",
      { line: 0, character: 14 },
      { triggerKind: 1 },
      controller.signal
    )
    await Promise.resolve()
    const methods = messages.map((message) => message.method)
    expect(methods.indexOf("textDocument/didChange")).toBeLessThan(
      methods.indexOf("textDocument/completion")
    )
    controller.abort()
    await expect(completion).rejects.toBeInstanceOf(RequestCancelled)
    client.stop()
    doc.destroy()
  })
})
