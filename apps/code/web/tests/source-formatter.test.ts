import { afterEach, expect, it, vi } from "vitest"
import { SourceFormatter } from "../src/lib/autocomplete/formatter"
import { format } from "@wasm-fmt/clang-format"

class TestWorker {
  static instances: TestWorker[] = []
  onmessage?: (event: MessageEvent) => void
  onerror?: () => void
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() {
    TestWorker.instances.push(this)
  }
}
afterEach(() => {
  vi.unstubAllGlobals()
  TestWorker.instances = []
})

it("formats C++ with the actual standalone formatter", () => {
  expect(
    format(
      "int main(){return 0;}",
      "main.cpp",
      "{BasedOnStyle: LLVM, IndentWidth: 2}"
    )
  ).toBe("int main() { return 0; }")
})

it("loads formatting on demand, cancels results, and recovers from a failed worker", async () => {
  vi.stubGlobal("Worker", TestWorker)
  const formatter = new SourceFormatter()
  expect(TestWorker.instances).toHaveLength(0)
  const controller = new AbortController()
  const pending = formatter.format(
    "main.cpp",
    "int x;",
    "LLVM",
    controller.signal
  )
  const first = TestWorker.instances[0]
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  const next = formatter.format(
    "main.cpp",
    "int x;",
    "LLVM",
    new AbortController().signal
  )
  const rejected = expect(next).rejects.toThrow("Could not load")
  first.onerror!()
  await rejected
  expect(first.terminate).toHaveBeenCalledOnce()
  const retried = formatter.format(
    "main.cpp",
    "int y;",
    "LLVM",
    new AbortController().signal
  )
  const worker = TestWorker.instances[1]
  worker.onmessage!({
    data: { id: worker.postMessage.mock.calls[0][0].id, text: "int y;\n" },
  } as MessageEvent)
  expect(await retried).toBe("int y;\n")
  formatter.stop()
  expect(worker.terminate).toHaveBeenCalledOnce()
})
