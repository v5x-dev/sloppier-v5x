import init, { format } from "@wasm-fmt/clang-format/vite"

const ready = init()
self.onmessage = async (
  event: MessageEvent<{
    id: number
    path: string
    text: string
    config: string
  }>
) => {
  const { id, path, text, config } = event.data
  try {
    await ready
    self.postMessage({ id, text: format(text, path, config) })
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
