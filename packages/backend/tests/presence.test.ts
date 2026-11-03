/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import schema from "../convex/schema"
import { api } from "../convex/_generated/api"

const modules = import.meta.glob("../convex/**/*.ts")

const sessionId = "alice-session"

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
    const programId = await ctx.db.insert("programs", {
      workspaceId,
      name: "Robot",
      template: "pros",
      repositoryId: "repo",
      repositoryStatus: "ready",
      createdBy: "alice",
      createdAt: 1,
    })
    await ctx.db.insert("files", {
      programId,
      path: "main.cpp",
      origin: "template",
      createdBy: "alice",
      createdAt: 1,
      updatedAt: 1,
    })
    // Alice joined main.cpp in this browser session. Bob has not joined.
    await ctx.db.insert("presenceSessions", {
      programId,
      path: "main.cpp",
      userId: "alice",
      sessionId,
      roomToken: "room-token",
      sessionToken: "session-token",
      createdAt: Date.now(),
    })
    return programId
  })
  return {
    t,
    programId,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
    stranger: t.withIdentity({ subject: "stranger" }),
  }
}

const bytes = () => new Uint8Array([1, 2, 3]).buffer as ArrayBuffer

describe("presence awareness", () => {
  test("a joined member publishes awareness on their own session", async () => {
    const { t, programId, alice } = await setup()
    await alice.mutation(api.presence.publishAwareness, {
      programId,
      path: "main.cpp",
      sessionId,
      bytes: bytes(),
    })
    const session = await t.run((ctx) =>
      ctx.db
        .query("presenceSessions")
        .withIndex("by_session_token", (q) =>
          q.eq("sessionToken", "session-token")
        )
        .unique()
    )
    expect(session?.awareness).toBeDefined()
  })

  test("publishing requires identity, membership, and a joined session", async () => {
    const { programId, alice, bob, stranger, t } = await setup()
    const args = { programId, path: "main.cpp", sessionId, bytes: bytes() }

    await expect(
      t.mutation(api.presence.publishAwareness, args)
    ).rejects.toThrow("Authentication")
    await expect(
      stranger.mutation(api.presence.publishAwareness, args)
    ).rejects.toThrow("access")
    // A member cannot publish through someone else's browser session.
    await expect(
      bob.mutation(api.presence.publishAwareness, args)
    ).rejects.toThrow("Join the file before sharing your cursor.")
    await expect(
      alice.mutation(api.presence.publishAwareness, {
        ...args,
        bytes: new Uint8Array(16_385).buffer as ArrayBuffer,
      })
    ).rejects.toThrow("too large")
  })
})

describe("presence carets", () => {
  test("caret publishing reports a missing file before checking the session", async () => {
    const { programId, alice } = await setup()
    await expect(
      alice.mutation(api.presence.updateCarets, {
        programId,
        path: "missing.cpp",
        sessionId,
        carets: [],
      })
    ).rejects.toThrow("File not found.")
  })

  test("caret publishing requires a joined session for the file", async () => {
    const { programId, bob, stranger } = await setup()
    const args = {
      programId,
      path: "main.cpp",
      sessionId,
      carets: [{ anchor: 0, focus: 0 }],
    }
    await expect(bob.mutation(api.presence.updateCarets, args)).rejects.toThrow(
      "Join this file before publishing carets."
    )
    await expect(
      stranger.mutation(api.presence.updateCarets, args)
    ).rejects.toThrow("access")
  })
})
