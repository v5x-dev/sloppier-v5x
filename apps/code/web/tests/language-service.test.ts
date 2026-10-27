import * as Y from "yjs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LanguageService, RequestCancelled } from "../src/lib/language-service"
import type { BuildSource } from "../src/lib/build-program"
import type { ApiDatabase } from "../src/lib/autocomplete/types"
import vex from "../src/lib/autocomplete/data/vexcode.json"
import { positionAt } from "../src/lib/autocomplete/types"
import { SourceFormatter } from "../src/lib/autocomplete/formatter"

const encode = (files: Record<string, string>): BuildSource => ({
  sha: "snapshot",
  files: Object.fromEntries(
    Object.entries(files).map(([path, text]) => [
      path,
      new TextEncoder().encode(text),
    ])
  ),
})
const signal = () => new AbortController().signal
const cleanup: (() => void)[] = []
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn())
  vi.restoreAllMocks()
})
async function setup(files: Record<string, string> = {}) {
  let source = encode(files)
  const service = new LanguageService("vexcode", async () => source)
  cleanup.push(() => service.stop())
  await service.start()
  return {
    service,
    setSource: (nextFiles: Record<string, string>) => {
      source = encode(nextFiles)
    },
  }
}
function open(service: LanguageService, contents: string, path = "main.cpp") {
  const doc = new Y.Doc()
  const text = doc.getText("source")
  text.insert(0, contents)
  const close = service.openDocument(path, text)
  cleanup.push(() => {
    close()
    doc.destroy()
  })
  return { doc, text, close }
}

describe("local language session", () => {
  it("reports loading, readiness, failure, retry and stop", async () => {
    const load = vi
      .fn<() => Promise<ApiDatabase>>()
      .mockRejectedValueOnce(new Error("Metadata unavailable"))
      .mockResolvedValue(vex)
    const service = new LanguageService("vexcode", async () => encode({}), load)
    const statuses: string[] = [],
      ready: boolean[] = []
    service.onStatusChange(() => statuses.push(service.getStatus()))
    service.onReadyChange((value) => ready.push(value))
    await service.start()
    expect(service.error).toBe("Metadata unavailable")
    expect(service.isReady).toBe(false)
    await service.start()
    expect(service.error).toBeNull()
    service.stop()
    expect(statuses).toEqual([
      "starting",
      "error",
      "starting",
      "ready",
      "stopped",
    ])
    expect(ready).toEqual([true, false])
  })
  it("discards a startup finishing after stop", async () => {
    let finish!: (database: ApiDatabase) => void
    const service = new LanguageService(
      "vexcode",
      async () => encode({}),
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const starting = service.start()
    service.stop()
    finish(vex)
    await starting
    expect(service.getStatus()).toBe("stopped")
    expect(service.isReady).toBe(false)
  })
  it("reads open Yjs contents immediately for local and remote edits", async () => {
    const { service } = await setup({
      "main.cpp": "vex::motor thing{1}; void run() { thing. }",
    })
    const { doc, text } = open(
      service,
      "vex::brain thing; void run() { thing. }"
    )
    const query = () =>
      service.completion(
        "main.cpp",
        positionAt(text.toString(), text.toString().lastIndexOf(".") + 1),
        signal()
      )
    expect((await query()).items.map((s) => s.label)).toContain("Screen")
    const remote = new Y.Doc()
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))
    const shared = remote.getText("source")
    shared.delete(0, shared.length)
    shared.insert(0, "vex::motor thing{1}; void run() { thing. }")
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), "remote")
    expect((await query()).items.map((s) => s.label)).toContain("spin")
    expect(service.version("main.cpp")).toBeGreaterThan(1)
    remote.destroy()
  })
  it("keeps live documents over snapshots and removes deleted declarations", async () => {
    const { service, setSource } = await setup({
      "robot.hpp": "vex::motor thing{1};",
      "main.cpp": "void run() { thing. }",
    })
    const { text, close } = open(service, "vex::brain thing;", "robot.hpp")
    const at = { line: 0, character: 19 }
    expect(
      (await service.completion("main.cpp", at, signal())).items.map(
        (s) => s.label
      )
    ).toContain("Screen")
    setSource({ "main.cpp": "void run() { thing. }" })
    await service.refreshSource()
    expect(
      (await service.completion("main.cpp", at, signal())).items.map(
        (s) => s.label
      )
    ).toContain("Screen")
    close()
    text.insert(text.length, " ")
    expect((await service.completion("main.cpp", at, signal())).items).toEqual(
      []
    )
  })
  it("cancels requests before execution and after stop", async () => {
    const { service } = await setup({ "main.cpp": "vex::motor left{1};" })
    const controller = new AbortController()
    controller.abort()
    await expect(
      service.completion(
        "main.cpp",
        { line: 0, character: 0 },
        controller.signal
      )
    ).rejects.toBeInstanceOf(RequestCancelled)
    service.stop()
    await expect(
      service.hover("main.cpp", { line: 0, character: 0 }, signal())
    ).rejects.toBeInstanceOf(RequestCancelled)
  })
  it("opens program definitions and lazily reads the correct SDK header", async () => {
    const { service } = await setup({
      "main.cpp": "vex::motor left{1}; void run() { left.spin(vex::fwd); }",
    })
    const contents = "vex::motor left{1}; void run() { left.spin(vex::fwd); }"
    const definitions = await service.definition(
      "main.cpp",
      positionAt(contents, contents.indexOf("spin") + 1),
      signal()
    )
    expect(definitions[0].path).toBeNull()
    const file = await service.readDefinition(definitions[0].uri, signal())
    expect(file.path).toBe("vex_motor.h")
    expect(file.contents.split("\n")[definitions[0].position.line]).toContain(
      "spin"
    )
    expect(
      (
        await service.hover(
          "main.cpp",
          positionAt(contents, contents.indexOf("spin") + 1),
          signal()
        )
      )?.contents.value
    ).toContain("motor")
    await expect(
      service.readDefinition("sdk/../../private", signal())
    ).rejects.toThrow("Header not found")
  })
  it("formats the live text with the nearest program style and preserves edit ranges", async () => {
    const { service } = await setup({
      ".clang-format": "IndentWidth: 4",
      "src/.clang-format": "IndentWidth: 3",
      "src/main.cpp": "int x;",
    })
    const { text } = open(service, "int main(){return 0;}", "src/main.cpp")
    const format = vi
      .spyOn(SourceFormatter.prototype, "format")
      .mockResolvedValue("int main() {\n   return 0;\n}\n")
    const edits = await service.formatting("src/main.cpp", signal())
    expect(format.mock.calls[0].slice(0, 3)).toEqual([
      "src/main.cpp",
      text.toString(),
      "IndentWidth: 3",
    ])
    expect(edits[0].range.end).toEqual(positionAt(text.toString(), text.length))
    expect(edits[0].newText).toContain("   return")
  })
})

it("makes open-buffer completion ready while unopened source is still loading", async () => {
  let finish!: (source: BuildSource) => void
  const service = new LanguageService(
    "vexcode",
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
    async () => vex
  )
  cleanup.push(() => service.stop())
  const { text } = open(service, "vex::motor left{1}; void run() { left. }")
  const starting = service.start()
  await Promise.resolve()
  await Promise.resolve()
  expect(service.isReady).toBe(true)
  expect(
    (
      await service.completion(
        "main.cpp",
        positionAt(text.toString(), text.toString().indexOf(". ") + 1),
        signal()
      )
    ).items.map((s) => s.label)
  ).toContain("spin")
  finish(encode({}))
  await starting
})

it("keeps a newer file snapshot when the initial read finishes later", async () => {
  let finish!: (source: BuildSource) => void
  const prepare = vi
    .fn<() => Promise<BuildSource>>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    .mockResolvedValue(encode({ "robot.hpp": "vex::brain thing;" }))
  const service = new LanguageService("vexcode", prepare, async () => vex)
  cleanup.push(() => service.stop())
  open(service, "void run() { thing. }")
  const starting = service.start()
  await Promise.resolve()
  await service.refreshSource()
  finish(encode({ "robot.hpp": "vex::motor thing{1};" }))
  await starting
  expect(
    (
      await service.completion("main.cpp", { line: 0, character: 19 }, signal())
    ).items.map((s) => s.label)
  ).toContain("Screen")
})

it("keeps API assistance available when unopened repository files cannot be read", async () => {
  const service = new LanguageService(
    "vexcode",
    async () => {
      throw new Error("Source offline")
    },
    async () => vex
  )
  cleanup.push(() => service.stop())
  const { text } = open(service, "vex::motor left{1}; void run() { left. }")
  await service.start()
  expect(service.isReady).toBe(true)
  expect(service.error).toBe("Source offline")
  expect(
    (
      await service.completion(
        "main.cpp",
        positionAt(text.toString(), text.toString().indexOf(". ") + 1),
        signal()
      )
    ).items.map((s) => s.label)
  ).toContain("spin")
})
