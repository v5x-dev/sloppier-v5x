import { afterEach, expect, test, vi } from "vitest"
import { zipSync } from "fflate"
import {
  prepareUploadBuild,
  waitForSourceSync,
  type BuildRequest,
  type BuildStatus,
} from "../src/lib/build-program"

const source = {
  sha: "new-commit",
  files: { "src/main.cpp": new TextEncoder().encode("int main() {}") },
}
const success: BuildStatus = {
  logs: "Building commit new-commit\nBuild succeeded.",
  building: false,
  artifactId: "new-artifact",
}
const empty: BuildStatus = { logs: "Ready", building: false, artifactId: null }
function setup(statuses: BuildStatus[]) {
  const events: string[] = []
  let last = statuses[0]
  const request: BuildRequest = async (path, body) => {
    events.push(path)
    if (path === "/status") {
      last = statuses.shift() ?? last
      return Response.json(last)
    }
    if (path === "/artifact")
      return new Response(
        zipSync({ "bin/program.bin": new Uint8Array([1, 2, 3]) })
      )
    if (path === "/build") expect(body).toMatchObject({ commit: "new-commit" })
    return Response.json({})
  }
  const options = {
    request,
    signal: new AbortController().signal,
    commitChanges: vi.fn(async () => {
      events.push("commit")
    }),
    prepareSource: vi.fn(async () => {
      events.push("snapshot")
      return source
    }),
    onStage: vi.fn(),
  }
  return { events, options }
}
afterEach(() => vi.useRealTimers())

test("commits before snapshot, builds missing output, then downloads fresh binaries", async () => {
  const { events, options } = setup([empty, success, success])
  expect(await prepareUploadBuild(options)).toEqual({
    type: "monolith",
    data: new Uint8Array([1, 2, 3]),
  })
  expect(events).toEqual([
    "commit",
    "snapshot",
    "/status",
    "/upload",
    "/build",
    "/status",
    "/artifact",
    "/status",
  ])
})
test("reuses a successful build only for the committed source revision", async () => {
  const { events, options } = setup([success, success])
  await prepareUploadBuild(options)
  expect(events).not.toContain("/build")
  expect(options.commitChanges).toHaveBeenCalledOnce()
  const stale = setup([
    {
      ...success,
      artifactId: "old-artifact",
      logs: "Building commit old-commit\nBuild succeeded.",
    },
    success,
    success,
  ])
  await prepareUploadBuild(stale.options)
  expect(stale.events).toContain("/build")
})
test("waits for compilation before downloading", async () => {
  vi.useFakeTimers()
  const { events, options } = setup([
    empty,
    { ...empty, building: true },
    success,
    success,
  ])
  const pending = prepareUploadBuild(options)
  await vi.advanceTimersByTimeAsync(500)
  await pending
  expect(events.indexOf("/artifact")).toBeGreaterThan(events.indexOf("/build"))
  expect(events.filter((event) => event === "/status")).toHaveLength(4)
})
test("commit failure prevents builds and downloads", async () => {
  const { events, options } = setup([empty])
  options.commitChanges.mockRejectedValueOnce(new Error("Commit rejected"))
  await expect(prepareUploadBuild(options)).rejects.toThrow("Commit rejected")
  expect(events).toEqual([])
})
test("failed builds cannot fall back to previous artifacts", async () => {
  const { events, options } = setup([
    { ...success, logs: "Old build" },
    { ...success, logs: "Building commit new-commit\nBuild failed (exit 2)." },
  ])
  await expect(prepareUploadBuild(options)).rejects.toThrow("Build failed")
  expect(events).not.toContain("/artifact")
})
test("rejects artifacts replaced during download", async () => {
  const { options } = setup([
    success,
    { ...success, artifactId: "another-build" },
  ])
  await expect(prepareUploadBuild(options)).rejects.toThrow("build changed")
})
test("aborting a pending build prevents downloading and uploading", async () => {
  vi.useFakeTimers()
  const { events, options } = setup([{ ...empty, building: true }])
  const controller = new AbortController()
  options.signal = controller.signal
  const pending = prepareUploadBuild(options)
  const rejected = expect(pending).rejects.toThrow()
  await vi.advanceTimersByTimeAsync(0)
  controller.abort()
  await rejected
  expect(events).not.toContain("/artifact")
  expect(events).not.toContain("/build")
})

test("waits for live edits to sync before committing", async () => {
  vi.useFakeTimers()
  let synced = false
  let finished = false
  const pending = waitForSourceSync(
    () => synced,
    new AbortController().signal
  ).then(() => {
    finished = true
  })
  await vi.advanceTimersByTimeAsync(500)
  expect(finished).toBe(false)
  synced = true
  await vi.advanceTimersByTimeAsync(500)
  await pending
  expect(finished).toBe(true)
})
