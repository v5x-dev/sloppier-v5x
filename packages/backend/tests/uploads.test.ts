/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "../convex/schema"
import { api } from "../convex/_generated/api"

const modules = import.meta.glob("../convex/**/*.ts")

describe("upload activity", () => {
  it("shares records with members and validates access and inputs", async () => {
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
      await ctx.db.insert("userProfiles", {
        userId: "alice",
        name: "Alice",
        email: "alice@example.com",
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
    const outsider = t.withIdentity({ subject: "outsider" })
    const args = { programId, revision: "a".repeat(40), slot: 3 }
    await expect(outsider.mutation(api.uploads.record, args)).rejects.toThrow(
      "access"
    )
    await expect(
      outsider.query(api.uploads.list, { programId })
    ).rejects.toThrow("access")
    await expect(
      alice.mutation(api.uploads.record, { ...args, slot: 9 })
    ).rejects.toThrow("slot")
    await expect(
      alice.mutation(api.uploads.record, { ...args, revision: "bad" })
    ).rejects.toThrow("revision")
    await alice.mutation(api.uploads.record, args)
    const records = await bob.query(api.uploads.list, { programId })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      ...args,
      userId: "alice",
      userName: "Alice",
    })
    expect(records[0].uploadedAt).toBeGreaterThan(0)
  })
})
