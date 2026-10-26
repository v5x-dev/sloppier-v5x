/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "../convex/schema"
import { api } from "../convex/_generated/api"

const modules = import.meta.glob("../convex/**/*.ts")

async function setup() {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity({ subject: "owner" })
  const outsider = t.withIdentity({ subject: "outsider" })
  const workspaceId = await owner.mutation(api.workspaces.create, {
    name: "Team",
  })
  const projectId = await t.run((ctx) =>
    ctx.db.insert("projects", {
      workspaceId,
      name: "Robot",
      template: "pros",
      repositoryId: "programs/test",
      repositoryStatus: "ready",
      createdBy: "owner",
      createdAt: Date.now(),
    })
  )
  return { t, owner, outsider, workspaceId, projectId }
}

describe("program management", () => {
  it("renames without changing the repository and preserves access through archive and restore", async () => {
    const { owner, workspaceId, projectId } = await setup()
    await owner.mutation(api.projects.rename, {
      projectId,
      name: "  Competition robot  ",
    })
    await owner.mutation(api.projects.setArchived, {
      projectId,
      archived: true,
    })
    const archived = await owner.query(api.projects.get, { projectId })
    expect(archived.name).toBe("Competition robot")
    expect(archived.repositoryId).toBe("programs/test")
    expect(archived.archivedAt).toEqual(expect.any(Number))
    expect(
      await owner.query(api.projects.listByWorkspace, { workspaceId })
    ).toHaveLength(1)
    await owner.mutation(api.projects.setArchived, {
      projectId,
      archived: false,
    })
    expect(
      (await owner.query(api.projects.get, { projectId })).archivedAt
    ).toBeUndefined()
  })

  it("allows ordinary workspace members to rename, archive, and restore", async () => {
    const { t, owner, workspaceId, projectId } = await setup()
    await owner.mutation(api.workspaces.addMember, {
      workspaceId,
      userId: "member",
    })
    const member = t.withIdentity({ subject: "member" })
    await member.mutation(api.projects.rename, {
      projectId,
      name: "Team robot",
    })
    await member.mutation(api.projects.setArchived, {
      projectId,
      archived: true,
    })
    await member.mutation(api.projects.setArchived, {
      projectId,
      archived: false,
    })
    const program = await owner.query(api.projects.get, { projectId })
    expect(program.name).toBe("Team robot")
    expect(program.archivedAt).toBeUndefined()
  })

  it("rejects invalid names and prevents outsiders from changing programs", async () => {
    const { owner, outsider, projectId } = await setup()
    for (const name of ["  ", "x".repeat(81)])
      await expect(
        owner.mutation(api.projects.rename, { projectId, name })
      ).rejects.toThrow("1–80")
    await expect(
      outsider.mutation(api.projects.rename, { projectId, name: "Stolen" })
    ).rejects.toThrow("access")
    await expect(
      outsider.mutation(api.projects.setArchived, { projectId, archived: true })
    ).rejects.toThrow("access")
    expect((await owner.query(api.projects.get, { projectId })).name).toBe(
      "Robot"
    )
  })
})
