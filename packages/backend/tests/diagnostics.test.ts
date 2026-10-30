/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "../convex/schema"
import { api } from "../convex/_generated/api"

const modules = import.meta.glob("../convex/**/*.ts")
describe("compiler problems", () => {
  it("shares the latest completed results with members, validates input, and rejects outsiders", async () => {
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
    const outsider = t.withIdentity({ subject: "other" })
    const args = {
      programId,
      revision: "a".repeat(40),
      startedAt: 10,
      diagnostics: [
        {
          path: "src/main.cpp",
          line: 4,
          severity: "error" as const,
          message: "bad expression",
        },
      ],
    }
    await expect(outsider.mutation(api.diagnostics.save, args)).rejects.toThrow(
      "access"
    )
    await expect(
      outsider.query(api.diagnostics.get, { programId })
    ).rejects.toThrow("access")
    await expect(
      alice.mutation(api.diagnostics.save, { ...args, revision: "bad" })
    ).rejects.toThrow("Invalid")
    await alice.mutation(api.diagnostics.save, args)
    expect(await bob.query(api.diagnostics.get, { programId })).toMatchObject(
      args
    )
    await bob.mutation(api.diagnostics.save, {
      ...args,
      startedAt: 20,
      diagnostics: [],
    })
    await alice.mutation(api.diagnostics.save, args)
    expect(await bob.query(api.diagnostics.get, { programId })).toMatchObject({
      startedAt: 20,
      diagnostics: [],
    })
  })
})
