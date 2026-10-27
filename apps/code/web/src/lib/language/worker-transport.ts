import type { BuildSource } from "../build-program"
import type { RpcMessage } from "./protocol"

export interface LanguageTransport {
  start: (
    source: Promise<BuildSource>,
    receive: (message: RpcMessage) => void,
    failed: (error: Error) => void
  ) => Promise<string>
  send: (messages: RpcMessage[]) => void
  read: (
    uri: string,
    signal: AbortSignal
  ) => Promise<{ path: string; contents: string }>
  stop: () => void
}

/** Each tab owns its worker and unsaved buffers. Builds never carry LSP traffic. */
export class WorkerLanguageTransport implements LanguageTransport {
  private worker: Worker | null = null
  private rejectStart: ((error: Error) => void) | null = null
  private reads = new Map<
    number,
    {
      resolve: (value: { path: string; contents: string }) => void
      reject: (error: Error) => void
    }
  >()
  private nextRead = 1

  constructor(private template: string) {}

  start(
    source: Promise<BuildSource>,
    receive: (message: RpcMessage) => void,
    failed: (error: Error) => void
  ) {
    this.stop()
    const worker = new Worker(new URL("./clangd.worker.ts", import.meta.url), {
      type: "module",
    })
    this.worker = worker
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => failure(new Error("Browser language server startup timed out")),
        120_000
      )
      this.rejectStart = (error) => {
        clearTimeout(timeout)
        reject(error)
      }
      const failure = (error: Error) => {
        if (this.worker !== worker) return
        this.stop()
        reject(error)
        failed(error)
      }
      worker.onerror = (event) => {
        event.preventDefault()
        const location = event.filename
          ? ` (${event.filename}:${event.lineno}:${event.colno})`
          : ""
        failure(
          new Error(
            `${event.message.trim() || "Chrome could not load or run the clangd worker and supplied no error details"}${location}`
          )
        )
      }
      worker.onmessage = ({ data }) => {
        if (this.worker !== worker) return
        if (data.type === "ready") {
          clearTimeout(timeout)
          this.rejectStart = null
          resolve(data.root)
        } else if (data.type === "message") receive(data.message)
        else if (data.type === "error") failure(new Error(data.error))
        else if (data.type === "read") {
          const pending = this.reads.get(data.id)
          this.reads.delete(data.id)
          if (data.error) pending?.reject(new Error(data.error))
          else pending?.resolve(data.result)
        }
      }
      // Download/compile clangd and read repository source concurrently.
      worker.postMessage({ type: "start", template: this.template })
      void source
        .then((snapshot) => {
          if (this.worker !== worker) return
          // This snapshot belongs to the session. Transfer without copying on UI.
          const buffers = [
            ...new Set(
              Object.values(snapshot.files).map((bytes) => bytes.buffer)
            ),
          ].filter(
            (buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer
          )
          worker.postMessage({ type: "source", files: snapshot.files }, buffers)
        })
        .catch((error) =>
          failure(error instanceof Error ? error : new Error(String(error)))
        )
    })
  }

  send(messages: RpcMessage[]) {
    if (!this.worker) throw new Error("Browser language server is unavailable")
    this.worker.postMessage({ type: "messages", messages })
  }

  read(uri: string, signal: AbortSignal) {
    return new Promise<{ path: string; contents: string }>(
      (resolve, reject) => {
        signal.throwIfAborted()
        if (!this.worker)
          return reject(new Error("Browser language server is unavailable"))
        const id = this.nextRead++
        const abort = () => {
          this.reads.delete(id)
          reject(signal.reason)
        }
        signal.addEventListener("abort", abort, { once: true })
        this.reads.set(id, {
          resolve: (value) => {
            signal.removeEventListener("abort", abort)
            resolve(value)
          },
          reject: (error) => {
            signal.removeEventListener("abort", abort)
            reject(error)
          },
        })
        this.worker.postMessage({ type: "read", id, uri })
      }
    )
  }

  stop() {
    this.worker?.terminate()
    this.worker = null
    const error = new Error("Browser language server stopped")
    this.rejectStart?.(error)
    this.rejectStart = null
    for (const pending of this.reads.values()) pending.reject(error)
    this.reads.clear()
  }
}
