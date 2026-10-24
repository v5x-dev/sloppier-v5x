import { components } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { mutation, query, type MutationCtx } from "./_generated/server"
import { Presence } from "@convex-dev/presence"
import { ConvexError, v } from "convex/values"
import { requireProjectMembership } from "./lib/auth"

const presence = new Presence(components.presence)

const caretValidator = v.object({ anchor: v.number(), focus: v.number() })

export const joinFile = mutation({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    sessionId: v.string(),
    intervalMs: v.optional(v.number()),
  },
  handler: (ctx, args) => heartbeatFileHandler(ctx, args),
})

export const heartbeatFile = mutation({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    sessionId: v.string(),
    intervalMs: v.optional(v.number()),
  },
  handler: (ctx, args) => heartbeatFileHandler(ctx, args),
})

export const updateCarets = mutation({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    sessionId: v.string(),
    carets: v.array(caretValidator),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireProjectMembership(ctx, args.projectId)
    if (args.sessionId.length < 8 || args.sessionId.length > 128) {
      throw new ConvexError("Session ID must be between 8 and 128 characters.")
    }
    const file = await ctx.db
      .query("files")
      .withIndex("by_project_path", (q) =>
        q.eq("projectId", args.projectId).eq("path", args.path)
      )
      .unique()
    if (!file) {
      throw new ConvexError("File not found.")
    }
    const joinedSession = await ctx.db
      .query("presenceSessions")
      .withIndex("by_file_user_session", (q) =>
        q
          .eq("projectId", args.projectId)
          .eq("path", file.path)
          .eq("userId", identity.subject)
          .eq("sessionId", args.sessionId)
      )
      .unique()
    if (!joinedSession) {
      throw new ConvexError("Join this file before publishing carets.")
    }
    const roomUsers = await presence.list(ctx, joinedSession.roomToken)
    if (
      !roomUsers.some((user) => user.userId === identity.subject && user.online)
    ) {
      throw new ConvexError(
        "Your presence session has expired. Join the file again."
      )
    }
    if (args.carets.length > 10) {
      throw new ConvexError("A collaborator can publish at most 10 carets.")
    }
    if (
      args.carets.some(
        ({ anchor, focus }) =>
          !Number.isFinite(anchor) ||
          !Number.isFinite(focus) ||
          anchor < 0 ||
          focus < 0 ||
          anchor > 10_000_000 ||
          focus > 10_000_000
      )
    ) {
      throw new ConvexError(
        "Caret positions must be valid non-negative offsets."
      )
    }

    await presence.updateRoomUser(ctx, file._id.toString(), identity.subject, {
      name: identity.name ?? identity.email ?? "Collaborator",
      color: colorForUser(identity.subject),
      carets: args.carets,
    })
  },
})

export const listFile = query({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    roomToken: v.string(),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireProjectMembership(ctx, args.projectId)
    const session = await ctx.db
      .query("presenceSessions")
      .withIndex("by_file_user_room_token", (q) =>
        q
          .eq("projectId", args.projectId)
          .eq("path", args.path)
          .eq("userId", identity.subject)
          .eq("roomToken", args.roomToken)
      )
      .first()
    if (!session) {
      throw new ConvexError(
        "Join this file before subscribing to its presence."
      )
    }

    return presence.list(ctx, args.roomToken)
  },
})

export const disconnect = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const session = await ctx.db
      .query("presenceSessions")
      .withIndex("by_session_token", (q) => q.eq("sessionToken", sessionToken))
      .unique()
    if (session) {
      await presence.disconnect(ctx, sessionToken)
      await ctx.db.delete(session._id)
    }
  },
})

async function heartbeatFileHandler(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">
    path: string
    sessionId: string
    intervalMs?: number
  }
) {
  const { identity, project } = await requireProjectMembership(
    ctx,
    args.projectId
  )
  if (project.repositoryStatus !== "ready") {
    throw new ConvexError("The program repository is not ready yet.")
  }
  if (args.sessionId.length < 8 || args.sessionId.length > 128) {
    throw new ConvexError("Session ID must be between 8 and 128 characters.")
  }

  const file = await ctx.db
    .query("files")
    .withIndex("by_project_path", (q) =>
      q.eq("projectId", args.projectId).eq("path", args.path)
    )
    .unique()
  if (!file) {
    throw new ConvexError("File not found.")
  }

  const intervalMs = args.intervalMs ?? 10_000
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 4_000 ||
    intervalMs > 30_000
  ) {
    throw new ConvexError(
      "Presence heartbeat must be between 4 and 30 seconds."
    )
  }

  const tokens = await presence.heartbeat(
    ctx,
    file._id.toString(),
    identity.subject,
    args.sessionId,
    intervalMs
  )

  const previous = await ctx.db
    .query("presenceSessions")
    .withIndex("by_file_user_session", (q) =>
      q
        .eq("projectId", args.projectId)
        .eq("path", file.path)
        .eq("userId", identity.subject)
        .eq("sessionId", args.sessionId)
    )
    .unique()

  const session = {
    projectId: args.projectId,
    path: file.path,
    userId: identity.subject,
    sessionId: args.sessionId,
    roomToken: tokens.roomToken,
    sessionToken: tokens.sessionToken,
    createdAt: Date.now(),
  }

  if (previous) {
    await ctx.db.patch(previous._id, session)
  } else {
    await ctx.db.insert("presenceSessions", session)
  }

  return tokens
}

function colorForUser(userId: string) {
  const colors = [
    "#d946ef",
    "#06b6d4",
    "#f97316",
    "#22c55e",
    "#6366f1",
    "#e11d48",
    "#ca8a04",
    "#0d9488",
  ]
  let hash = 0
  for (const character of userId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return colors[hash % colors.length]
}

// Awareness is scoped to a browser session, so two tabs belonging to the same
// person keep independent selections and never overwrite one another.
export const publishAwareness = mutation({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    sessionId: v.string(),
    bytes: v.bytes(),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireProjectMembership(ctx, args.projectId)
    if (args.bytes.byteLength > 16_384)
      throw new ConvexError("Awareness payload is too large.")
    const session = await ctx.db
      .query("presenceSessions")
      .withIndex("by_file_user_session", (q) =>
        q
          .eq("projectId", args.projectId)
          .eq("path", args.path)
          .eq("userId", identity.subject)
          .eq("sessionId", args.sessionId)
      )
      .unique()
    if (!session)
      throw new ConvexError("Join the file before sharing your cursor.")
    await ctx.db.patch(session._id, { awareness: args.bytes })
  },
})

export const listAwareness = query({
  args: { projectId: v.id("projects"), path: v.string() },
  handler: async (ctx, args) => {
    await requireProjectMembership(ctx, args.projectId)
    const sessions = await ctx.db
      .query("presenceSessions")
      .withIndex("by_file_seen", (q) =>
        q
          .eq("projectId", args.projectId)
          .eq("path", args.path)
          .gt("createdAt", Date.now() - 35_000)
      )
      .collect()
    return sessions
      .filter((s) => s.createdAt > Date.now() - 35_000 && s.awareness)
      .map((s) => ({ sessionId: s.sessionId, bytes: s.awareness! }))
  },
})
