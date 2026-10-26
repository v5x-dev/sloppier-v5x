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
  const projectId = await t.run(async (ctx) => {
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
    return await ctx.db.insert("projects", {
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
    projectId,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  }
}

test("program sessions share one machine and one user leaving keeps other tabs alive", async () => {
  const { t, projectId, alice, bob } = await setup()
  await alice.mutation(api.builds.heartbeat, {
    projectId,
    sessionId: "alice-tab-one",
  })
  await alice.mutation(api.builds.heartbeat, {
    projectId,
    sessionId: "alice-tab-two",
  })
  await bob.mutation(api.builds.heartbeat, {
    projectId,
    sessionId: "bob-tab-one",
  })
  expect(
    await t.run((ctx) => ctx.db.query("buildMachines").collect())
  ).toHaveLength(1)
  await alice.mutation(api.builds.heartbeat, {
    projectId,
    sessionId: "alice-tab-one",
    leave: true,
  })
  await t.mutation(internal.builds.retire, { projectId })
  const state = await t.query(internal.builds.state, { projectId })
  expect(state.sessions).toHaveLength(2)
  expect(state.machine).not.toBeNull()
})

test("expired sessions are removed and machine records retire after the last viewer", async () => {
  const { t, projectId, alice } = await setup()
  await alice.mutation(api.builds.heartbeat, {
    projectId,
    sessionId: "alice-tab-one",
  })
  const { sessions } = await t.query(internal.builds.state, { projectId })
  await t.mutation(internal.builds.expireSession, { id: sessions[0]!._id })
  expect(
    (await t.query(internal.builds.state, { projectId })).sessions
  ).toHaveLength(1)
  await t.run((ctx) => ctx.db.patch(sessions[0]!._id, { expiresAt: 0 }))
  await t.mutation(internal.builds.expireSession, { id: sessions[0]!._id })
  await t.mutation(internal.builds.retire, { projectId })
  expect(
    (await t.query(internal.builds.state, { projectId })).machine
  ).toBeNull()
})

test("membership, session ownership and stale machine updates are enforced", async () => {
  const { t, projectId, alice, bob } = await setup()
  await expect(
    t.mutation(api.builds.heartbeat, { projectId, sessionId: "anonymous-tab" })
  ).rejects.toThrow("Authentication")
  await expect(
    t
      .withIdentity({ subject: "outsider" })
      .query(api.builds.status, { projectId })
  ).rejects.toThrow("access")
  await alice.mutation(api.builds.heartbeat, {
    projectId,
    sessionId: "alice-tab-one",
  })
  await expect(
    bob.mutation(api.builds.heartbeat, {
      projectId,
      sessionId: "alice-tab-one",
      leave: true,
    })
  ).rejects.toThrow("owner")
  await t.mutation(internal.builds.update, {
    projectId,
    machineId: "machine-one",
    status: "ready",
  })
  await t.mutation(internal.builds.update, {
    projectId,
    building: true,
    logs: "Building directly on the machine.",
  })
  await t.mutation(internal.builds.update, {
    projectId,
    machineId: "machine-two",
  })
  await t.mutation(internal.builds.update, {
    projectId,
    expectedMachineId: "machine-one",
    logs: "stale build",
    building: false,
  })
  expect(await alice.query(api.builds.status, { projectId })).toMatchObject({
    building: true,
    logs: "Building directly on the machine.",
  })
})

test("cloud lifecycle creates once, keeps occupied machines alive and deletes after last leave", async () => {
  const { t, projectId, alice, bob } = await setup()
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
      projectId,
      sessionId: "alice-tab-one",
    })
    await bob.mutation(api.builds.heartbeat, {
      projectId,
      sessionId: "bob-tab-one",
    })
    await t.action(internal.buildWorker.reconcile, { projectId })
    await alice.mutation(api.builds.heartbeat, {
      projectId,
      sessionId: "alice-tab-one",
      leave: true,
    })
    await t.action(internal.buildWorker.reconcile, { projectId })
    expect(
      requests.filter((r) => r.path === "/v1/machines" && r.method === "POST")
    ).toHaveLength(1)
    expect(requests.some((r) => r.method === "DELETE")).toBe(false)
    expect(requests[0]?.body).toMatchObject({
      source: { type: "image", arch: "amd64" },
      resources: { cpus: 2, memoryMb: 2048 },
    })
    await bob.mutation(api.builds.heartbeat, {
      projectId,
      sessionId: "bob-tab-one",
      leave: true,
    })
    await t.action(internal.buildWorker.reconcile, { projectId })
    expect(requests.at(-1)).toMatchObject({
      path: "/v1/machines/cloud-machine",
      method: "DELETE",
    })
    expect(
      (await t.query(internal.builds.state, { projectId })).machine
    ).toBeNull()
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  }
})

test("image updates wait for active builds and prevent new builds during replacement", async () => {
  const { t, projectId, alice } = await setup()
  await alice.mutation(api.builds.heartbeat, {
    projectId,
    sessionId: "alice-tab-one",
  })
  await t.mutation(internal.builds.update, {
    projectId,
    machineId: "old-image",
    status: "ready",
    building: true,
  })
  expect(
    await t.mutation(internal.builds.refreshImage, {
      projectId,
      machineId: "old-image",
    })
  ).toBe(false)
  await t.mutation(internal.builds.update, { projectId, building: false })
  expect(
    await t.mutation(internal.builds.refreshImage, {
      projectId,
      machineId: "old-image",
    })
  ).toBe(true)
  await t.mutation(internal.builds.refreshImage, {
    projectId,
    machineId: "old-image",
    deleted: true,
  })
  expect(
    (await t.query(internal.builds.state, { projectId })).machine?.machineId
  ).toBeUndefined()
})

test("direct handshake checks membership and mints only a short-lived single-port token", async () => {
  const { t, projectId, alice } = await setup()
  const fetchMock = vi.fn(async () =>
    Response.json({ token: "scoped-token", expiresAt: "2026-10-25T12:00:00Z" })
  )
  vi.stubGlobal("fetch", fetchMock)
  vi.stubEnv("SMOL_CLOUD_TOKEN", "server-only-key")
  try {
    await expect(
      t
        .withIdentity({ subject: "outsider" })
        .action(api.buildConnection.connect, { projectId })
    ).rejects.toThrow("access")
    await expect(
      alice.action(api.buildConnection.connect, { projectId })
    ).rejects.toThrow("not ready")
    expect(fetchMock).not.toHaveBeenCalled()
    await alice.mutation(api.builds.heartbeat, {
      projectId,
      sessionId: "alice-direct-tab",
    })
    await t.mutation(internal.builds.update, {
      projectId,
      machineId: "direct-machine",
      status: "ready",
    })
    const result = await alice.action(api.buildConnection.connect, {
      projectId,
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
  const { t, projectId, alice } = await setup()
  await alice.mutation(api.builds.heartbeat, {
    projectId,
    sessionId: "direct-viewer-tab",
  })
  await t.mutation(internal.builds.update, {
    projectId,
    machineId: "direct-machine",
    status: "ready",
  })
  const state = await t.query(internal.builds.state, { projectId })
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
    await t.action(internal.buildWorker.reconcile, { projectId })
    expect(calls).not.toContain("DELETE")
    expect(
      (await t.query(internal.builds.state, { projectId })).machine
    ).not.toBeNull()
    viewers = 0
    await t.action(internal.buildWorker.reconcile, { projectId })
    expect(calls).toContain("DELETE")
    expect(
      (await t.query(internal.builds.state, { projectId })).machine
    ).toBeNull()
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  }
})
