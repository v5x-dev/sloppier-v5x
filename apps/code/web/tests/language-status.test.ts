import { expect, it, vi } from "vitest"
import { LanguageClient } from "../src/lib/language-client"
import type { LanguageTransport } from "../src/lib/language/worker-transport"

it("reports startup, readiness, worker failure, restart, and stop", async () => {
  let failWorker: (error: Error) => void = () => {}
  const transport: LanguageTransport = {
    start: vi.fn(async (_source, _receive, failed) => {
      failWorker = failed
      return "/workspace"
    }),
    send: vi.fn(),
    read: vi.fn(),
    stop: vi.fn(),
  }
  const client = new LanguageClient(transport, async () => ({
    sha: "test",
    files: {},
  }))
  const internals = client as unknown as { call: () => Promise<unknown> }
  vi.spyOn(internals, "call").mockResolvedValue({ capabilities: {} })
  const states: string[] = []
  const unsubscribe = client.onStatusChange(() =>
    states.push(client.getStatus())
  )

  expect(client.getStatus()).toBe("stopped")
  const starting = client.start()
  expect(client.getStatus()).toBe("starting")
  await starting
  expect(client.getStatus()).toBe("ready")
  failWorker(new Error("Worker crashed"))
  expect(client.getStatus()).toBe("error")
  expect(client.error).toBe("Worker crashed")
  await client.start()
  expect(client.error).toBeNull()
  client.stop()
  expect(states).toEqual([
    "starting",
    "ready",
    "error",
    "starting",
    "ready",
    "stopped",
  ])
  unsubscribe()
})

it("reports a failed startup", async () => {
  const client = new LanguageClient(
    {
      start: vi.fn().mockRejectedValue(new Error("Startup failed")),
      send: vi.fn(),
      read: vi.fn(),
      stop: vi.fn(),
    },
    async () => ({ sha: "test", files: {} })
  )
  await client.start()
  expect(client.getStatus()).toBe("error")
  expect(client.error).toBe("Startup failed")
})
