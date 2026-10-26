"use node"

import { v } from "convex/values"
import { internal } from "./_generated/api"
import { internalAction } from "./_generated/server"

export async function cloud<T>(
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET"
): Promise<T> {
  const token = process.env.SMOL_CLOUD_TOKEN
  if (!token) throw new Error("Set SMOL_CLOUD_TOKEN on the Convex deployment.")
  const response = await fetch(`https://api.smolmachines.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(330_000),
  })
  if (method === "DELETE" && response.status === 404) return undefined as T
  if (!response.ok)
    throw new Error(
      `Smolmachines request failed (${response.status}, request ${response.headers.get("x-request-id") ?? "unknown"}).`
    )
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T)
}
const programArgs = { programId: v.id("programs") }
export const reconcile = internalAction({
  args: programArgs,
  handler: async (ctx, args) => {
    const state = await ctx.runQuery(internal.builds.state, args)
    if (!state.machine) return
    let machineId = state.machine.machineId
    let again = true
    try {
      for (const session of state.sessions) {
        if (session.expiresAt <= Date.now())
          await ctx.runMutation(internal.builds.expireSession, {
            id: session._id,
          })
      }
      const hasJoiningViewers = state.sessions.some(
        (s) => s.expiresAt > Date.now()
      )
      if (!hasJoiningViewers) {
        let viewers = 0
        if (machineId) {
          const health = await cloud<{ stdout?: string; exitCode?: number }>(
            `/machines/${encodeURIComponent(machineId)}/exec?output=text`,
            {
              command: [
                "python3",
                "-c",
                "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=5).read().decode())",
              ],
              timeoutSeconds: 10,
            }
          )
          if (health.exitCode === 0 && health.stdout)
            viewers = Number(JSON.parse(health.stdout).viewers) || 0
        }
        if (!viewers) {
          if (machineId)
            await cloud(
              `/machines/${encodeURIComponent(machineId)}`,
              undefined,
              "DELETE"
            )
          await ctx.runMutation(internal.builds.retire, args)
          again = false
          return
        }
      }
      if (!machineId) {
        const image = process.env.SMOL_BUILD_IMAGE
        if (!image)
          throw new Error(
            "Set SMOL_BUILD_IMAGE to the V5 build toolchain image."
          )
        const machine = await cloud<{ id: string }>("/machines", {
          name: `v5x-${args.programId}`,
          source: { type: "image", reference: image, arch: "amd64" },
          resources: { cpus: 2, memoryMb: 2048 },
          network: { mode: "open" },
          autoStopSeconds: 120,
          ports: [{ port: 8080 }],
          public: false,
          env: { V5X_TEMPLATE: state.program!.template },
          labels: { program: args.programId },
        })
        machineId = machine.id
        await ctx.runMutation(internal.builds.update, {
          ...args,
          machineId,
          status: "starting",
          logs: "Waiting for build machine…",
        })
      }
      const machine = await cloud<{
        ready: boolean
        state: string
        source?: { reference: string }
      }>(`/machines/${encodeURIComponent(machineId)}`)
      if (
        machine.source &&
        machine.source.reference !== process.env.SMOL_BUILD_IMAGE
      ) {
        const drain = await cloud<{ stdout?: string; exitCode?: number }>(
          `/machines/${encodeURIComponent(machineId)}/exec?output=text`,
          {
            command: [
              "python3",
              "-c",
              "import pathlib,urllib.request; pathlib.Path('/home/builder/workspace/draining').touch(); print(urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=5).read().decode())",
            ],
            timeoutSeconds: 10,
          }
        )
        if (drain.exitCode === 0 && drain.stdout) {
          const building = Boolean(JSON.parse(drain.stdout).building)
          await ctx.runMutation(internal.builds.update, { ...args, building })
          if (building) return
        }
        const refresh = await ctx.runMutation(internal.builds.refreshImage, {
          ...args,
          machineId,
        })
        if (refresh) {
          await cloud(
            `/machines/${encodeURIComponent(machineId)}`,
            undefined,
            "DELETE"
          )
          await ctx.runMutation(internal.builds.refreshImage, {
            ...args,
            machineId,
            deleted: true,
          })
          return
        }
      }
      if (machine.state === "stopped")
        await cloud(`/machines/${encodeURIComponent(machineId)}/start`, {})
      if (machine.state === "error")
        throw new Error("Build machine failed to start.")
      if (machine.ready) {
        // Keep occupied machines alive and sample only build lifecycle metadata.
        const health = await cloud<{ stdout?: string; exitCode?: number }>(
          `/machines/${encodeURIComponent(machineId)}/exec?output=text`,
          {
            command: [
              "python3",
              "-c",
              "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=5).read().decode())",
            ],
            timeoutSeconds: 10,
          }
        )
        const building =
          health.exitCode === 0 && health.stdout
            ? Boolean(JSON.parse(health.stdout).building)
            : state.machine.building
        await ctx.runMutation(internal.builds.update, {
          ...args,
          building,
          status: "ready",
          ...(!state.machine.building && state.machine.status !== "ready"
            ? {
                logs: "Build machine is ready. Commit changes, then select Build.",
              }
            : {}),
        })
      }
    } catch (error) {
      await ctx.runMutation(internal.builds.update, {
        ...args,
        status: "error",
        logs:
          error instanceof Error ? error.message : "Machine request failed.",
      })
    } finally {
      if (again)
        await ctx.scheduler.runAfter(
          10_000,
          internal.buildWorker.reconcile,
          args
        )
    }
  },
})
