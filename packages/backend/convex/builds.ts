import { v, ConvexError } from "convex/values"
import { internal } from "./_generated/api"
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server"
import { requireProjectMembership } from "./lib/auth"

const projectArgs = { projectId: v.id("projects") }
export const heartbeat = mutation({
  args: {
    ...projectArgs,
    sessionId: v.string(),
    leave: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { identity, project } = await requireProjectMembership(
      ctx,
      args.projectId
    )
    if (project.repositoryStatus !== "ready")
      throw new ConvexError("Repository is not ready.")
    if (args.sessionId.length < 8 || args.sessionId.length > 128)
      throw new ConvexError("Invalid session.")
    const session = await ctx.db
      .query("programSessions")
      .withIndex("by_project_session", (q) =>
        q.eq("projectId", args.projectId).eq("sessionId", args.sessionId)
      )
      .unique()
    if (session && session.userId !== identity.subject)
      throw new ConvexError("Invalid session owner.")
    if (args.leave) {
      if (session) await ctx.db.delete(session._id)
    } else if (session)
      await ctx.db.patch(session._id, { expiresAt: Date.now() + 35_000 })
    else
      await ctx.db.insert("programSessions", {
        projectId: args.projectId,
        sessionId: args.sessionId,
        userId: identity.subject,
        expiresAt: Date.now() + 35_000,
      })
    const machine = await ctx.db
      .query("buildMachines")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique()
    if (!machine && !args.leave) {
      await ctx.db.insert("buildMachines", {
        projectId: args.projectId,
        status: "starting",
        logs: "Starting build machine…",
        building: false,
      })
      await ctx.scheduler.runAfter(0, internal.buildWorker.reconcile, {
        projectId: args.projectId,
      })
    }
  },
})

export const status = query({
  args: projectArgs,
  handler: async (ctx, args) => {
    await requireProjectMembership(ctx, args.projectId)
    const m = await ctx.db
      .query("buildMachines")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique()
    return m
      ? {
          machineId: m.machineId,
          status: m.status,
          logs: m.logs,
          building: m.building,
          artifactId: m.artifactId,
          artifactUrl: m.artifactId
            ? await ctx.storage.getUrl(m.artifactId)
            : null,
        }
      : null
  },
})
export const state = internalQuery({
  args: projectArgs,
  handler: async (ctx, args) => ({
    project: await ctx.db.get(args.projectId),
    machine: await ctx.db
      .query("buildMachines")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique(),
    sessions: await ctx.db
      .query("programSessions")
      .withIndex("by_project_session", (q) => q.eq("projectId", args.projectId))
      .collect(),
  }),
})
export const update = internalMutation({
  args: {
    ...projectArgs,
    machineId: v.optional(v.string()),
    expectedMachineId: v.optional(v.string()),
    artifactId: v.optional(v.id("_storage")),
    status: v.optional(v.string()),
    logs: v.optional(v.string()),
    building: v.optional(v.boolean()),
  },
  handler: async (ctx, { projectId, expectedMachineId, ...patch }) => {
    const m = await ctx.db
      .query("buildMachines")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .unique()
    if (!m || (expectedMachineId && m.machineId !== expectedMachineId)) {
      if (patch.artifactId) await ctx.storage.delete(patch.artifactId)
      return
    }
    if (patch.artifactId && m.artifactId) await ctx.storage.delete(m.artifactId)
    await ctx.db.patch(
      m._id,
      Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined)
      )
    )
  },
})

export const expireSession = internalMutation({
  args: { id: v.id("programSessions") },
  handler: async (ctx, { id }) => {
    const session = await ctx.db.get(id)
    if (session && session.expiresAt <= Date.now()) await ctx.db.delete(id)
  },
})
export const retire = internalMutation({
  args: projectArgs,
  handler: async (ctx, args) => {
    const m = await ctx.db
      .query("buildMachines")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique()
    if (!m) return
    const sessions = await ctx.db
      .query("programSessions")
      .withIndex("by_project_session", (q) => q.eq("projectId", args.projectId))
      .collect()
    if (sessions.some((s) => s.expiresAt > Date.now())) {
      await ctx.db.patch(m._id, {
        machineId: undefined,
        status: "starting",
        building: false,
      })
      await ctx.scheduler.runAfter(0, internal.buildWorker.reconcile, args)
    } else {
      if (m.artifactId) await ctx.storage.delete(m.artifactId)
      await ctx.db.delete(m._id)
    }
  },
})

// Block new builds before replacing an outdated image. Active builds finish first.
export const refreshImage = internalMutation({
  args: {
    ...projectArgs,
    machineId: v.string(),
    deleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const machine = await ctx.db
      .query("buildMachines")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique()
    if (!machine || machine.machineId !== args.machineId || machine.building)
      return false
    await ctx.db.patch(machine._id, {
      status: "starting",
      logs: "Updating the build machine image…",
      ...(args.deleted ? { machineId: undefined } : {}),
    })
    return true
  },
})
