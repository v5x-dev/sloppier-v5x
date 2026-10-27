/** Formatting is loaded only on demand, independently of autocomplete. */
export class SourceFormatter {
  private worker?: Worker
  private id = 0
  private requests = new Map<
    number,
    { resolve: (text: string) => void; reject: (error: Error) => void }
  >()
  format(path: string, text: string, config: string, signal: AbortSignal) {
    signal.throwIfAborted()
    if (!this.worker) {
      const worker = (this.worker = new Worker(
        new URL("./format.worker.ts", import.meta.url),
        { type: "module" }
      ))
      worker.onmessage = (
        event: MessageEvent<{ id: number; text?: string; error?: string }>
      ) => {
        const pending = this.requests.get(event.data.id)
        this.requests.delete(event.data.id)
        if (event.data.error) pending?.reject(new Error(event.data.error))
        else pending?.resolve(event.data.text ?? "")
      }
      worker.onerror = () =>
        this.stop(new Error("Could not load the source formatter"))
    }
    const id = ++this.id
    return new Promise<string>((resolve, reject) => {
      const abort = () => {
        this.requests.delete(id)
        reject(new DOMException("Formatting cancelled", "AbortError"))
      }
      signal.addEventListener("abort", abort, { once: true })
      const clean = () => signal.removeEventListener("abort", abort)
      this.requests.set(id, {
        resolve: (result) => {
          clean()
          resolve(result)
        },
        reject: (error) => {
          clean()
          reject(error)
        },
      })
      try {
        this.worker!.postMessage({ id, path, text, config })
      } catch (error) {
        this.stop(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
  stop(error = new Error("Formatter stopped")) {
    this.worker?.terminate()
    this.worker = undefined
    for (const request of this.requests.values()) request.reject(error)
    this.requests.clear()
  }
}
