import * as Y from "yjs"
import { describe, expect, it, vi } from "vitest"
import { LanguageClient, type LspRange } from "../src/lib/language-client"

const range: LspRange = {
  start: { line: 7, character: 3 },
  end: { line: 7, character: 9 },
}
function setup(result: unknown) {
  const client = new LanguageClient(
    () => null,
    async () => {
      throw new Error("unused")
    }
  )
  // Isolate response normalization from the long-poll transport.
  const internals = client as unknown as {
    root: string
    call: (...args: unknown[]) => Promise<unknown>
  }
  internals.root = "/home/builder/language/session"
  const call = vi.spyOn(internals, "call").mockResolvedValue(result)
  return { client, call }
}

describe("language navigation", () => {
  it("normalizes a single definition location and decodes repository paths", async () => {
    const { client, call } = setup({
      uri: "file:///home/builder/language/session/include/my%20robot.hpp",
      range,
    })
    const signal = new AbortController().signal
    expect(
      await client.definition("src/main.cpp", { line: 0, character: 2 }, signal)
    ).toEqual([
      {
        uri: "file:///home/builder/language/session/include/my%20robot.hpp",
        path: "include/my robot.hpp",
        position: range.start,
      },
    ])
    expect(call).toHaveBeenCalledWith(
      "textDocument/definition",
      {
        textDocument: {
          uri: "file:///home/builder/language/session/src/main.cpp",
        },
        position: { line: 0, character: 2 },
      },
      signal
    )
  })
  it("uses LocationLink selection ranges and distinguishes toolchain paths from source paths", async () => {
    const { client } = setup([
      {
        targetUri: "file:///opt/v5x/deps/pros/include/api.h",
        targetSelectionRange: range,
      },
      { uri: "file:///home/builder/language/session-other/private.h", range },
      { uri: "https://example.com/header", range },
    ])
    const targets = await client.definition(
      "main.cpp",
      range.start,
      new AbortController().signal
    )
    expect(targets).toHaveLength(2)
    expect(targets.map((target) => target.path)).toEqual([null, null])
    expect(targets[0]?.position).toEqual(range.start)
  })
  it("handles missing definitions and forwards hover documentation", async () => {
    const { client, call } = setup(null)
    const signal = new AbortController().signal
    expect(await client.definition("main.cpp", range.start, signal)).toEqual([])
    call.mockResolvedValue({
      contents: { kind: "plaintext", value: "Robot documentation" },
    })
    expect(await client.hover("main.cpp", range.start, signal)).toEqual({
      contents: { kind: "plaintext", value: "Robot documentation" },
    })
  })
})

describe("document formatting", () => {
  it("requests formatting for the open document and handles no edits", async () => {
    const { client, call } = setup(null)
    const doc = new Y.Doc()
    const close = client.openDocument("src/my robot.cpp", doc.getText("source"))
    // The transport is isolated above; mark the initialized session ready.
    const internals = client as unknown as { ready: boolean }
    internals.ready = true
    const signal = new AbortController().signal
    expect(await client.formatting("src/my robot.cpp", signal)).toEqual([])
    expect(call).toHaveBeenCalledWith(
      "textDocument/formatting",
      {
        textDocument: {
          uri: "file:///home/builder/language/session/src/my%20robot.cpp",
        },
        options: { tabSize: 2, insertSpaces: true },
      },
      signal
    )
    internals.ready = false
    close()
    doc.destroy()
  })

  it("does not queue formatting before initialization or for closed files", async () => {
    const { client, call } = setup([])
    const signal = new AbortController().signal
    await expect(client.formatting("main.cpp", signal)).rejects.toThrow()
    ;(client as unknown as { ready: boolean }).ready = true
    await expect(client.formatting("main.cpp", signal)).rejects.toThrow()
    expect(call).not.toHaveBeenCalled()
  })
})
