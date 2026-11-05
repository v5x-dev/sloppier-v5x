import { unzipSync } from "fflate"
import { describe, expect, it, vi } from "vitest"
import type { BuildRequest } from "../src/lib/build-program"
import {
  BuildSpeculation,
  clangFormatConfig,
} from "../src/lib/build-speculation"
import {
  decodeSourceText,
  encodeSourceText,
  sourceHash,
  type SourceFiles,
} from "../src/lib/build-source"

// A Builder that speaks the /upload, /build and /status protocol and hashes what it extracts
// the way infra/build/v5x-server does. Non-OK responses throw, as program-connection's request does.
function fakeBuilder() {
  const uploads = new Map<string, number[]>()
  const builds: Array<{ commit: string; speculative: boolean; hash: string }> =
    []
  const requests: string[] = []
  const status = {
    logs: "Build machine is ready.",
    building: false,
    startedAt: null as number | null,
    artifactId: null as string | null,
    speculative: false,
    sourceHash: null as string | null,
  }
  let builds_ = 0
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json" },
    })
  const request: BuildRequest = async (path, body) => {
    requests.push(path)
    if (path === "/upload") {
      const { id, data } = body as { id: string; data: string }
      const bytes = [...atob(data)].map((char) => char.charCodeAt(0))
      uploads.set(id, [...(uploads.get(id) ?? []), ...bytes])
      return json({})
    }
    if (path === "/build") {
      const { id, commit, speculative } = body as {
        id: string
        commit: string
        speculative?: boolean
      }
      if (status.building && !status.speculative) {
        throw new Error("The Builder didn't respond (409). Try again.")
      }
      const files = unzipSync(new Uint8Array(uploads.get(id) ?? []))
      const hash = await sourceHash(files)
      builds.push({ commit, speculative: speculative === true, hash })
      const number = ++builds_
      Object.assign(status, {
        building: true,
        speculative: speculative === true,
        sourceHash: null,
        logs: `Building ${speculative ? "speculative " : "commit "}${commit}\n`,
      })
      setTimeout(() => {
        Object.assign(status, {
          building: false,
          logs: status.logs + "Build succeeded.",
          sourceHash: hash,
          artifactId: `artifact-${number}`,
        })
      }, 5)
      return json({})
    }
    if (path === "/status") return json({ ...status })
    throw new Error(`unexpected ${path}`)
  }
  return { request, builds, requests, status }
}

const sources = (main: string): SourceFiles => ({
  "src/main.cpp": encodeSourceText(main),
  Makefile: encodeSourceText("all:"),
})

describe("BuildSpeculation", () => {
  it("builds the draft source and claims the artifact for its exact hash", async () => {
    const builder = fakeBuilder()
    const files = sources("int main() {}")
    const hash = await sourceHash(files)
    const speculation = new BuildSpeculation({
      prepare: async () => ({ files: { ...files }, dirty: [] }),
      request: builder.request,
      warm: () => true,
      delay: 0,
    })
    speculation.schedule()
    await vi.waitFor(async () =>
      expect((await speculation.claimOrWait(hash))?.artifactId).toBe(
        "artifact-1"
      )
    )
    expect(builder.builds).toEqual([
      { commit: `speculative ${hash}`, speculative: true, hash },
    ])
    expect(
      await speculation.claimOrWait(
        await sourceHash(sources("int main() { return 1; }"))
      )
    ).toBeNull()
  })

  it("claimOrWait waits for a draft build that is still running, so Upload does not build the same source again", async () => {
    const builder = fakeBuilder()
    const files = sources("int main() { return 3; }")
    const hash = await sourceHash(files)
    const speculation = new BuildSpeculation({
      prepare: async () => ({ files: { ...files }, dirty: [] }),
      request: builder.request,
      warm: () => true,
    })
    // Upload starts the draft build with no debounce, then the commit finishes while the build runs.
    speculation.schedule(0)
    expect((await speculation.claimOrWait(hash))?.artifactId).toBe("artifact-1")
    expect(builder.builds).toHaveLength(1)
  })

  it("formats dirty language files as the commit would, without changing the draft", async () => {
    const builder = fakeBuilder()
    const draft = sources("int  main(){}")
    const formatted = sources("int main() {}")
    const formatHash = await sourceHash(formatted)
    const format = vi.fn(async (_path: string, text: string) =>
      text === "int  main(){}" ? "int main() {}" : text
    )
    const speculation = new BuildSpeculation({
      prepare: async () => ({ files: { ...draft }, dirty: ["src/main.cpp"] }),
      request: builder.request,
      warm: () => true,
      delay: 0,
      format,
    })
    speculation.schedule()
    await vi.waitFor(async () =>
      expect((await speculation.claimOrWait(formatHash))?.artifactId).toBe(
        "artifact-1"
      )
    )
    expect(format).toHaveBeenCalledWith(
      "src/main.cpp",
      "int  main(){}",
      expect.any(String),
      expect.any(AbortSignal)
    )
    expect(decodeSourceText(draft["src/main.cpp"])).toBe("int  main(){}")
  })

  it("does not rebuild content it already built", async () => {
    const builder = fakeBuilder()
    const files = sources("int main() {}")
    const hash = await sourceHash(files)
    const speculation = new BuildSpeculation({
      prepare: async () => ({ files: { ...files }, dirty: [] }),
      request: builder.request,
      warm: () => true,
      delay: 0,
    })
    speculation.schedule()
    await vi.waitFor(async () =>
      expect((await speculation.claimOrWait(hash))?.artifactId).toBe(
        "artifact-1"
      )
    )
    speculation.schedule()
    // Resolves once the run this schedule started has settled; the same content must not build again.
    await speculation.claimOrWait(hash)
    expect(builder.builds).toHaveLength(1)
  })

  it("keeps watching the build in flight when the same content is scheduled again", async () => {
    const builder = fakeBuilder()
    const files = sources("int main() {}")
    const hash = await sourceHash(files)
    const speculation = new BuildSpeculation({
      prepare: async () => ({ files: { ...files }, dirty: [] }),
      request: builder.request,
      warm: () => true,
      delay: 0,
    })
    speculation.schedule()
    await vi.waitFor(() => expect(builder.builds).toHaveLength(1))
    // A keystroke that leaves the content unchanged must not abandon the build already running.
    speculation.schedule()
    await vi.waitFor(async () =>
      expect((await speculation.claimOrWait(hash))?.artifactId).toBe(
        "artifact-1"
      )
    )
    expect(builder.builds).toHaveLength(1)
  })

  it("leaves a running normal build alone and retries the same content later", async () => {
    const builder = fakeBuilder()
    const files = sources("int main() {}")
    const hash = await sourceHash(files)
    builder.status.building = true
    builder.status.speculative = false
    const speculation = new BuildSpeculation({
      prepare: async () => ({ files: { ...files }, dirty: [] }),
      request: builder.request,
      warm: () => true,
      delay: 0,
    })
    speculation.schedule()
    expect(await speculation.claimOrWait(hash)).toBeNull()
    expect(builder.builds).toHaveLength(0)

    builder.status.building = false
    speculation.schedule()
    await vi.waitFor(async () =>
      expect((await speculation.claimOrWait(hash))?.artifactId).toBe(
        "artifact-1"
      )
    )
  })

  it("never provisions or contacts a Builder that is not connected", async () => {
    const builder = fakeBuilder()
    const speculation = new BuildSpeculation({
      prepare: async () => ({ files: sources("int main() {}"), dirty: [] }),
      request: builder.request,
      warm: () => false,
      delay: 0,
    })
    speculation.schedule()
    // Nothing is scheduled to build, so the pending run settles with no claim and no request.
    expect(await speculation.claimOrWait("unbuilt")).toBeNull()
    expect(builder.requests).toEqual([])
  })

  it("stops without starting work after stop()", async () => {
    vi.useFakeTimers()
    try {
      const builder = fakeBuilder()
      const speculation = new BuildSpeculation({
        prepare: async () => ({ files: sources("int main() {}"), dirty: [] }),
        request: builder.request,
        warm: () => true,
        delay: 50,
      })
      speculation.schedule()
      speculation.stop()
      // Advance past the debounce: a timer that stop() failed to clear would fire here.
      await vi.advanceTimersByTimeAsync(100)
      expect(builder.requests).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("clangFormatConfig", () => {
  it("uses the nearest .clang-format and falls back to the language service default", () => {
    const files: SourceFiles = {
      ".clang-format": encodeSourceText("BasedOnStyle: LLVM"),
      "src/.clang-format": encodeSourceText("BasedOnStyle: Google"),
    }
    expect(clangFormatConfig(files, "src/nested/main.cpp")).toBe(
      "BasedOnStyle: Google"
    )
    expect(clangFormatConfig(files, "include/main.h")).toBe(
      "BasedOnStyle: LLVM"
    )
    expect(clangFormatConfig({}, "src/main.cpp")).toBe(
      "{BasedOnStyle: LLVM, IndentWidth: 2, ColumnLimit: 120}"
    )
  })
})
