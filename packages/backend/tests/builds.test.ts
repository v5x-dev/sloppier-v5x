/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import schema from "../convex/schema"
import { api, internal } from "../convex/_generated/api"
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const modules = import.meta.glob("../convex/**/*.ts")

async function setup() {
  const t = convexTest(schema, modules)
  const programId = await t.run(async (ctx) => {
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Team",
      ownerId: "alice",
      createdAt: 1,
    })
    for (const userId of ["alice", "bob"])
      await ctx.db.insert("workspaceMembers", {
        workspaceId,
        userId,
        role: "member",
        joinedAt: 1,
      })
    return await ctx.db.insert("programs", {
      workspaceId,
      name: "Robot",
      template: "pros",
      repositoryId: "repo",
      repositoryStatus: "ready",
      createdBy: "alice",
      createdAt: 1,
    })
  })
  return {
    t,
    programId,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  }
}

test("program sessions share one machine and one user leaving keeps other tabs alive", async () => {
  const { t, programId, alice, bob } = await setup()
  await alice.mutation(api.builds.heartbeat, {
    programId,
    sessionId: "alice-tab-one",
  })
  await alice.mutation(api.builds.heartbeat, {
    programId,
    sessionId: "alice-tab-two",
  })
  await bob.mutation(api.builds.heartbeat, {
    programId,
    sessionId: "bob-tab-one",
  })
  expect(
    await t.run((ctx) => ctx.db.query("buildMachines").collect())
  ).toHaveLength(1)
  await alice.mutation(api.builds.heartbeat, {
    programId,
    sessionId: "alice-tab-one",
    leave: true,
  })
  await t.mutation(internal.builds.retire, { programId })
  const state = await t.query(internal.builds.state, { programId })
  expect(state.sessions).toHaveLength(2)
  expect(state.machine).not.toBeNull()
})

test("expired sessions are removed and machine records retire after the last viewer", async () => {
  const { t, programId, alice } = await setup()
  await alice.mutation(api.builds.heartbeat, {
    programId,
    sessionId: "alice-tab-one",
  })
  const { sessions } = await t.query(internal.builds.state, { programId })
  await t.mutation(internal.builds.expireSession, { id: sessions[0]!._id })
  expect(
    (await t.query(internal.builds.state, { programId })).sessions
  ).toHaveLength(1)
  await t.run((ctx) => ctx.db.patch(sessions[0]!._id, { expiresAt: 0 }))
  await t.mutation(internal.builds.expireSession, { id: sessions[0]!._id })
  await t.mutation(internal.builds.retire, { programId })
  expect(
    (await t.query(internal.builds.state, { programId })).machine
  ).toBeNull()
})

test("membership, session ownership and stale machine updates are enforced", async () => {
  const { t, programId, alice, bob } = await setup()
  await expect(
    t.mutation(api.builds.heartbeat, { programId, sessionId: "anonymous-tab" })
  ).rejects.toThrow("Authentication")
  await expect(
    t
      .withIdentity({ subject: "outsider" })
      .query(api.builds.status, { programId })
  ).rejects.toThrow("access")
  await alice.mutation(api.builds.heartbeat, {
    programId,
    sessionId: "alice-tab-one",
  })
  await expect(
    bob.mutation(api.builds.heartbeat, {
      programId,
      sessionId: "alice-tab-one",
      leave: true,
    })
  ).rejects.toThrow("owner")
  await t.mutation(internal.builds.update, {
    programId,
    machineId: "machine-one",
    status: "ready",
  })
  await t.mutation(internal.builds.update, {
    programId,
    building: true,
    logs: "Building directly on the machine.",
  })
  await t.mutation(internal.builds.update, {
    programId,
    machineId: "machine-two",
  })
  await t.mutation(internal.builds.update, {
    programId,
    expectedMachineId: "machine-one",
    logs: "stale build",
    building: false,
  })
  expect(await alice.query(api.builds.status, { programId })).toMatchObject({
    building: true,
    logs: "Building directly on the machine.",
  })
})

test("cloud lifecycle creates once, keeps occupied machines alive and deletes after last leave", async () => {
  const { t, programId, alice, bob } = await setup()
  const requests: {
    path: string
    method: string
    body: Record<string, unknown> | null
  }[] = []
  vi.stubEnv("SMOL_CLOUD_TOKEN", "test-token")
  vi.stubEnv("SMOL_BUILD_IMAGE", "registry.example.com/build:test")
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      const path = new URL(input).pathname
      requests.push({
        path,
        method: init.method!,
        body: init.body ? JSON.parse(init.body as string) : null,
      })
      if (init.method === "DELETE") return new Response(null, { status: 204 })
      return Response.json(
        path === "/v1/machines"
          ? { id: "cloud-machine" }
          : { ready: true, state: "started", exitCode: 0 }
      )
    })
  )
  try {
    await alice.mutation(api.builds.heartbeat, {
      programId,
      sessionId: "alice-tab-one",
    })
    await bob.mutation(api.builds.heartbeat, {
      programId,
      sessionId: "bob-tab-one",
    })
    await t.action(internal.buildWorker.reconcile, { programId })
    await alice.mutation(api.builds.heartbeat, {
      programId,
      sessionId: "alice-tab-one",
      leave: true,
    })
    await t.action(internal.buildWorker.reconcile, { programId })
    expect(
      requests.filter((r) => r.path === "/v1/machines" && r.method === "POST")
    ).toHaveLength(1)
    expect(requests.some((r) => r.method === "DELETE")).toBe(false)
    expect(requests[0]?.body).toMatchObject({
      source: { type: "image", arch: "amd64" },
      resources: { cpus: 2, memoryMb: 2048 },
    })
    await bob.mutation(api.builds.heartbeat, {
      programId,
      sessionId: "bob-tab-one",
      leave: true,
    })
    await t.action(internal.buildWorker.reconcile, { programId })
    expect(requests.at(-1)).toMatchObject({
      path: "/v1/machines/cloud-machine",
      method: "DELETE",
    })
    expect(
      (await t.query(internal.builds.state, { programId })).machine
    ).toBeNull()
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  }
})

test("image updates wait for active builds and prevent new builds during replacement", async () => {
  const { t, programId, alice } = await setup()
  await alice.mutation(api.builds.heartbeat, {
    programId,
    sessionId: "alice-tab-one",
  })
  await t.mutation(internal.builds.update, {
    programId,
    machineId: "old-image",
    status: "ready",
    building: true,
  })
  expect(
    await t.mutation(internal.builds.refreshImage, {
      programId,
      machineId: "old-image",
    })
  ).toBe(false)
  await t.mutation(internal.builds.update, { programId, building: false })
  expect(
    await t.mutation(internal.builds.refreshImage, {
      programId,
      machineId: "old-image",
    })
  ).toBe(true)
  await t.mutation(internal.builds.refreshImage, {
    programId,
    machineId: "old-image",
    deleted: true,
  })
  expect(
    (await t.query(internal.builds.state, { programId })).machine?.machineId
  ).toBeUndefined()
})

test("direct handshake checks membership and mints only a short-lived single-port token", async () => {
  const { t, programId, alice } = await setup()
  const fetchMock = vi.fn(async () =>
    Response.json({ token: "scoped-token", expiresAt: "2026-10-25T12:00:00Z" })
  )
  vi.stubGlobal("fetch", fetchMock)
  vi.stubEnv("SMOL_CLOUD_TOKEN", "server-only-key")
  try {
    await expect(
      t
        .withIdentity({ subject: "outsider" })
        .action(api.buildConnection.connect, { programId })
    ).rejects.toThrow("access")
    await expect(
      alice.action(api.buildConnection.connect, { programId })
    ).rejects.toThrow("not ready")
    expect(fetchMock).not.toHaveBeenCalled()
    await alice.mutation(api.builds.heartbeat, {
      programId,
      sessionId: "alice-direct-tab",
    })
    await t.mutation(internal.builds.update, {
      programId,
      machineId: "direct-machine",
      status: "ready",
    })
    const result = await alice.action(api.buildConnection.connect, {
      programId,
    })
    expect(result).toMatchObject({
      token: "scoped-token",
      baseUrl:
        "https://api.smolmachines.com/v1/machines/direct-machine/connect/8080",
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toContain("/direct-machine/connect-token")
    expect(JSON.parse(init.body as string)).toEqual({
      port: 8080,
      includeDescendants: false,
      ttlSeconds: 900,
    })
    expect(JSON.stringify(result)).not.toContain("server-only-key")
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  }
})

test("direct viewer heartbeats keep the machine alive after Convex join sessions expire", async () => {
  const { t, programId, alice } = await setup()
  await alice.mutation(api.builds.heartbeat, {
    programId,
    sessionId: "direct-viewer-tab",
  })
  await t.mutation(internal.builds.update, {
    programId,
    machineId: "direct-machine",
    status: "ready",
  })
  const state = await t.query(internal.builds.state, { programId })
  await t.run((ctx) => ctx.db.delete(state.sessions[0]!._id))
  let viewers = 1
  const calls: string[] = []
  vi.stubEnv("SMOL_CLOUD_TOKEN", "test-token")
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      calls.push(init.method!)
      if (init.method === "DELETE") return new Response(null, { status: 204 })
      return Response.json(
        input.includes("/exec")
          ? {
              exitCode: 0,
              stdout: JSON.stringify({ viewers, building: false }),
            }
          : { ready: true, state: "started" }
      )
    })
  )
  try {
    await t.action(internal.buildWorker.reconcile, { programId })
    expect(calls).not.toContain("DELETE")
    expect(
      (await t.query(internal.builds.state, { programId })).machine
    ).not.toBeNull()
    viewers = 0
    await t.action(internal.buildWorker.reconcile, { programId })
    expect(calls).toContain("DELETE")
    expect(
      (await t.query(internal.builds.state, { programId })).machine
    ).toBeNull()
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  }
})

test("ephemeral requests authorize and share one bounded checkpoint restore without viewers", async () => {
  const { t, programId, alice, bob } = await setup()
  vi.stubEnv("SMOL_CLOUD_TOKEN", "test-token")
  vi.stubEnv("SMOL_BUILD_CHECKPOINT", "startup-checkpoint")
  const calls: string[] = []
  let logs = "Builder ready"
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`)
      if (init.method === "DELETE") return new Response(null, { status: 204 })
      if (url.includes("/restore"))
        return Response.json({ id: "ephemeral-machine" })
      return Response.json({
        exitCode: 0,
        stdout: JSON.stringify({
          building: false,
          completed: logs.startsWith("Building commit "),
          key: logs,
        }),
      })
    })
  )
  try {
    await expect(
      t
        .withIdentity({ subject: "outsider" })
        .mutation(api.builds.start, { programId })
    ).rejects.toThrow("access")
    expect(calls).toHaveLength(0)
    await alice.mutation(api.builds.start, { programId })
    await bob.mutation(api.builds.start, { programId })
    await t.action(internal.buildWorker.reconcile, { programId })
    expect(calls.filter((c) => c.includes("/restore"))).toHaveLength(1)
    expect(await alice.query(api.builds.status, { programId })).toMatchObject({
      status: "ready",
      machineId: "ephemeral-machine",
    })
    logs = "Building commit abc\nBuild succeeded."
    await t.action(internal.buildWorker.reconcile, { programId })
    expect(calls.some((c) => c.startsWith("DELETE"))).toBe(false)
    vi.setSystemTime(Date.now() + 31_000)
    await t.action(internal.buildWorker.reconcile, { programId })
    expect(calls.at(-1)).toContain("DELETE")
    expect(await alice.query(api.builds.status, { programId })).toBeNull()
    await alice.mutation(api.builds.start, { programId })
    await t.action(internal.buildWorker.reconcile, { programId })
    expect(calls.filter((c) => c.includes("/restore"))).toHaveLength(2)
    vi.setSystemTime(Date.now() + 361_000)
    await t.action(internal.buildWorker.reconcile, { programId })
    expect(await alice.query(api.builds.status, { programId })).toBeNull()
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  }
})
