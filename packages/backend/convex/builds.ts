import { v, ConvexError } from "convex/values"
import { internal } from "./_generated/api"
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server"
import { requireProgramMembership } from "./lib/auth"

const programArgs = { programId: v.id("programs") }
export const heartbeat = mutation({
  args: {
    ...programArgs,
    sessionId: v.string(),
    leave: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { identity, program } = await requireProgramMembership(
      ctx,
      args.programId
    )
    if (program.repositoryStatus !== "ready")
      throw new ConvexError("Repository is not ready.")
    if (args.sessionId.length < 8 || args.sessionId.length > 128)
      throw new ConvexError("Invalid session.")
    const session = await ctx.db
      .query("programSessions")
      .withIndex("by_program_session", (q) =>
        q.eq("programId", args.programId).eq("sessionId", args.sessionId)
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
        programId: args.programId,
        sessionId: args.sessionId,
        userId: identity.subject,
        expiresAt: Date.now() + 35_000,
      })
    const machine = await ctx.db
      .query("buildMachines")
      .withIndex("by_program", (q) => q.eq("programId", args.programId))
      .unique()
    if (!machine && !args.leave) {
      await ctx.db.insert("buildMachines", {
        programId: args.programId,
        status: "starting",
        logs: "Starting builder…",
        building: false,
      })
      await ctx.scheduler.runAfter(0, internal.buildWorker.reconcile, {
        programId: args.programId,
      })
    }
  },
})

export const status = query({
  args: programArgs,
  handler: async (ctx, args) => {
    await requireProgramMembership(ctx, args.programId)
    const m = await ctx.db
      .query("buildMachines")
      .withIndex("by_program", (q) => q.eq("programId", args.programId))
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
  args: programArgs,
  handler: async (ctx, args) => ({
    program: await ctx.db.get(args.programId),
    machine: await ctx.db
      .query("buildMachines")
      .withIndex("by_program", (q) => q.eq("programId", args.programId))
      .unique(),
    sessions: await ctx.db
      .query("programSessions")
      .withIndex("by_program_session", (q) => q.eq("programId", args.programId))
      .collect(),
  }),
})
export const update = internalMutation({
  args: {
    ...programArgs,
    machineId: v.optional(v.string()),
    expectedMachineId: v.optional(v.string()),
    artifactId: v.optional(v.id("_storage")),
    status: v.optional(v.string()),
    logs: v.optional(v.string()),
    building: v.optional(v.boolean()),
  },
  handler: async (ctx, { programId, expectedMachineId, ...patch }) => {
    const m = await ctx.db
      .query("buildMachines")
      .withIndex("by_program", (q) => q.eq("programId", programId))
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
  args: programArgs,
  handler: async (ctx, args) => {
    const m = await ctx.db
      .query("buildMachines")
      .withIndex("by_program", (q) => q.eq("programId", args.programId))
      .unique()
    if (!m) return
    const sessions = await ctx.db
      .query("programSessions")
      .withIndex("by_program_session", (q) => q.eq("programId", args.programId))
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
    ...programArgs,
    machineId: v.string(),
    deleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const machine = await ctx.db
      .query("buildMachines")
      .withIndex("by_program", (q) => q.eq("programId", args.programId))
      .unique()
    if (!machine || machine.machineId !== args.machineId || machine.building)
      return false
    await ctx.db.patch(machine._id, {
      status: "starting",
      logs: "Updating the builder image…",
      ...(args.deleted ? { machineId: undefined } : {}),
    })
    return true
  },
})
