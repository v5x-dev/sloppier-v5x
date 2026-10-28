/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "../convex/schema"
import { api, internal } from "../convex/_generated/api"

const modules = import.meta.glob("../convex/**/*.ts")

describe("Program checkpoints", () => {
  it("shares checkpoints with members and rejects outsiders and invalid names", async () => {
    const t = convexTest(schema, modules)
    const programId = await t.run(async (ctx) => {
      const workspaceId = await ctx.db.insert("workspaces", {
        name: "Team",
        ownerId: "alice",
        createdAt: 1,
      })
      await ctx.db.insert("workspaceMembers", {
        workspaceId,
        userId: "alice",
        role: "admin",
        joinedAt: 1,
      })
      await ctx.db.insert("workspaceMembers", {
        workspaceId,
        userId: "bob",
        role: "member",
        joinedAt: 1,
      })
      return ctx.db.insert("programs", {
        workspaceId,
        name: "Robot",
        template: "pros",
        repositoryId: "repo",
        repositoryStatus: "ready",
        createdBy: "alice",
        createdAt: 1,
      })
    })
    const alice = t.withIdentity({ subject: "alice" })
    const bob = t.withIdentity({ subject: "bob" })
    const outsider = t.withIdentity({ subject: "mallory" })
    const args = {
      programId,
      sha: "a".repeat(40),
      name: "  Skills run  ",
      message: "Save",
      author: "Alice",
      date: "2026-01-01T00:00:00.000Z",
    }
    await expect(
      alice.mutation(internal.checkpoints.save, { ...args, name: "  " })
    ).rejects.toThrow("Checkpoint name")
    await expect(
      outsider.mutation(internal.checkpoints.save, args)
    ).rejects.toThrow("access")
    const checkpointId = await alice.mutation(internal.checkpoints.save, args)
    expect(
      (await bob.query(api.checkpoints.list, { programId }))[0]?.name
    ).toBe("Skills run")
    await expect(
      outsider.query(api.checkpoints.list, { programId })
    ).rejects.toThrow("access")
    await expect(
      outsider.mutation(api.checkpoints.remove, { checkpointId })
    ).rejects.toThrow("access")
    await bob.mutation(api.checkpoints.remove, { checkpointId })
    expect(await alice.query(api.checkpoints.list, { programId })).toEqual([])
  })
})
