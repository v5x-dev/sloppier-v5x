/** Normalize raw Wasm and gzip assets, including hosts that strip Content-Encoding. */
export async function wasmResponse(response: Response): Promise<Response> {
  if (!response.ok || !response.body)
    throw new Error(`Unable to load clangd Wasm: HTTP ${response.status}`)
  const reader = response.body.getReader()
  const prefix: Uint8Array<ArrayBuffer>[] = []
  const magic: number[] = []
  while (magic.length < 2) {
    const { value, done } = await reader.read()
    if (done) break
    prefix.push(value)
    for (const byte of value) {
      magic.push(byte)
      if (magic.length === 2) break
    }
  }
  const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      for (const chunk of prefix) controller.enqueue(chunk)
    },
    async pull(controller) {
      const { value, done } = await reader.read()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
  // fetch already decodes correctly labelled HTTP gzip. Inspect the bytes to
  // avoid decompressing twice, while retaining streaming for large modules.
  const decoded =
    magic[0] === 0x1f && magic[1] === 0x8b
      ? body.pipeThrough(new DecompressionStream("gzip"))
      : body
  return new Response(decoded, {
    headers: { "Content-Type": "application/wasm" },
  })
}
