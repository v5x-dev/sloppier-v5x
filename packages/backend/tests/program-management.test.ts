/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "../convex/schema"
import { api, internal } from "../convex/_generated/api"

const modules = import.meta.glob("../convex/**/*.ts")

async function setup() {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity({ subject: "owner" })
  const outsider = t.withIdentity({ subject: "outsider" })
  const workspaceId = await owner.mutation(api.workspaces.create, {
    name: "Team",
  })
  const programId = await t.run((ctx) =>
    ctx.db.insert("programs", {
      workspaceId,
      name: "Robot",
      template: "pros",
      repositoryId: "programs/test",
      repositoryStatus: "ready",
      createdBy: "owner",
      createdAt: Date.now(),
    })
  )
  return { t, owner, outsider, workspaceId, programId }
}

describe("program management", () => {
  it("renames without changing the repository and preserves access through archive and restore", async () => {
    const { owner, workspaceId, programId } = await setup()
    await owner.mutation(api.programs.rename, {
      programId,
      name: "  Competition robot  ",
    })
    await owner.mutation(api.programs.setArchived, {
      programId,
      archived: true,
    })
    const archived = await owner.query(api.programs.get, { programId })
    expect(archived.name).toBe("Competition robot")
    expect(archived.repositoryId).toBe("programs/test")
    expect(archived.archivedAt).toEqual(expect.any(Number))
    expect(
      await owner.query(api.programs.listByWorkspace, { workspaceId })
    ).toHaveLength(1)
    await owner.mutation(api.programs.setArchived, {
      programId,
      archived: false,
    })
    expect(
      (await owner.query(api.programs.get, { programId })).archivedAt
    ).toBeUndefined()
  })

  it("allows ordinary workspace members to rename, archive, and restore", async () => {
    const { t, owner, workspaceId, programId } = await setup()
    await owner.mutation(api.workspaces.addMember, {
      workspaceId,
      userId: "member",
    })
    const member = t.withIdentity({ subject: "member" })
    await member.mutation(api.programs.rename, {
      programId,
      name: "Team robot",
    })
    await member.mutation(api.programs.setArchived, {
      programId,
      archived: true,
    })
    await member.mutation(api.programs.setArchived, {
      programId,
      archived: false,
    })
    const program = await owner.query(api.programs.get, { programId })
    expect(program.name).toBe("Team robot")
    expect(program.archivedAt).toBeUndefined()
  })

  it("rejects invalid names and prevents outsiders from changing programs", async () => {
    const { owner, outsider, programId } = await setup()
    for (const name of ["  ", "x".repeat(81)])
      await expect(
        owner.mutation(api.programs.rename, { programId, name })
      ).rejects.toThrow("1–80")
    await expect(
      outsider.mutation(api.programs.rename, { programId, name: "Stolen" })
    ).rejects.toThrow("access")
    await expect(
      outsider.mutation(api.programs.setArchived, { programId, archived: true })
    ).rejects.toThrow("access")
    expect((await owner.query(api.programs.get, { programId })).name).toBe(
      "Robot"
    )
  })
})

describe("repository provisioning recovery", () => {
  it("exposes retry when the provisioning job terminates without updating the program", async () => {
    const { t, programId } = await setup()
    const jobId = await t.run(async (ctx) => {
      const jobId = await ctx.scheduler.runAfter(
        60_000,
        internal.codeStorage.provisionProgram,
        { programId }
      )
      await ctx.scheduler.cancel(jobId)
      await ctx.db.patch(programId, {
        repositoryStatus: "provisioning",
        repositoryProvisioningJob: jobId,
      })
      return jobId
    })
    await t.mutation(internal.programs.checkProvisioning, { programId, jobId })
    const program = await t.run((ctx) => ctx.db.get(programId))
    expect(program?.repositoryStatus).toBe("failed")
    expect(program?.repositoryError).toContain("retry")
  })

  it("ignores a terminated job from an earlier attempt and completed programs", async () => {
    const { t, programId } = await setup()
    const { oldJob, newJob } = await t.run(async (ctx) => {
      const oldJob = await ctx.scheduler.runAfter(
        60_000,
        internal.codeStorage.provisionProgram,
        { programId }
      )
      const newJob = await ctx.scheduler.runAfter(
        60_000,
        internal.codeStorage.provisionProgram,
        { programId }
      )
      await ctx.scheduler.cancel(oldJob)
      await ctx.scheduler.cancel(newJob)
      await ctx.db.patch(programId, {
        repositoryStatus: "provisioning",
        repositoryProvisioningJob: newJob,
      })
      return { oldJob, newJob }
    })
    await t.mutation(internal.programs.checkProvisioning, {
      programId,
      jobId: oldJob,
    })
    expect(
      (await t.run((ctx) => ctx.db.get(programId)))?.repositoryStatus
    ).toBe("provisioning")
    await t.run((ctx) => ctx.db.patch(programId, { repositoryStatus: "ready" }))
    await t.mutation(internal.programs.checkProvisioning, {
      programId,
      jobId: newJob,
    })
    expect(
      (await t.run((ctx) => ctx.db.get(programId)))?.repositoryStatus
    ).toBe("ready")
  })
})

describe("duplicate provisioning", () => {
  it("copies ownership and template into a separate repository and checks membership", async () => {
    const { t, programId, workspaceId } = await setup()
    const sha = "a".repeat(40)
    await expect(
      t.mutation(internal.programs.createDuplicate, {
        sourceId: programId,
        userId: "outsider",
        name: "Copy",
        sha,
      })
    ).rejects.toThrow("access")
    await expect(
      t.mutation(internal.programs.createDuplicate, {
        sourceId: programId,
        userId: "owner",
        name: " ",
        sha,
      })
    ).rejects.toThrow("1–80")
    const id = await t.mutation(internal.programs.createDuplicate, {
      sourceId: programId,
      userId: "owner",
      name: "  Experiment  ",
      sha,
    })
    const copy = await t.run((ctx) => ctx.db.get(id))
    expect(copy).toMatchObject({
      workspaceId,
      name: "Experiment",
      template: "pros",
      repositoryId: `programs/${id}`,
      repositoryStatus: "provisioning",
      duplicateSource: { repositoryId: "programs/test", sha },
    })
  })
})
