/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { expect, test } from "vitest"
import schema from "../convex/schema"
import { api, internal } from "../convex/_generated/api"
import * as facade from "../convex/codeStorage"
const modules = import.meta.glob("../convex/**/*.ts")

test("keeps the deployed Code Storage API facade stable", () => {
  expect(Object.keys(facade).sort()).toEqual(
    [
      "buildManifest",
      "commitFiles",
      "createCheckpoint",
      "deleteProgram",
      "duplicateProgram",
      "fileHistory",
      "history",
      "historyDiff",
      "historyFiles",
      "listFiles",
      "openLiveFile",
      "persistCrdtUpdate",
      "persistProgramUpdates",
      "provisionProgram",
      "readFile",
      "restoreHistoryCommit",
      "restoreHistoryFile",
      "searchProgram",
    ].sort()
  )
})

test("source operations reject nonmembers before contacting external storage", async () => {
  const t = convexTest(schema, modules)
  const programId = await t.run(async (ctx) => {
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Private",
      ownerId: "owner",
      createdAt: 1,
    })
    return ctx.db.insert("programs", {
      workspaceId,
      name: "Robot",
      template: "pros",
      repositoryId: "private-repo",
      repositoryStatus: "ready",
      createdBy: "owner",
      createdAt: 1,
    })
  })
  const outsider = t.withIdentity({ subject: "outsider" })
  await expect(
    outsider.action(api.codeStorage.buildManifest, { programId })
  ).rejects.toThrow("You do not have access to this program.")
  await expect(
    outsider.action(api.codeStorage.listFiles, { programId })
  ).rejects.toThrow("You do not have access to this program.")
  await expect(
    outsider.action(api.codeStorage.readFile, {
      programId,
      path: "src/main.cpp",
    })
  ).rejects.toThrow("You do not have access to this program.")
  await expect(
    outsider.action(api.codeStorage.commitFiles, {
      programId,
      message: "edit",
      changes: [
        { operation: "put", path: "src/main.cpp", contents: "private" },
      ],
    })
  ).rejects.toThrow("You do not have access to this program.")
  await expect(
    outsider.action(api.codeStorage.openLiveFile, {
      programId,
      path: "src/main.cpp",
    })
  ).rejects.toThrow("You do not have access to this program.")
  await expect(
    outsider.action(api.codeStorage.searchProgram, {
      programId,
      query: "private",
      matchCase: false,
    })
  ).rejects.toThrow("You do not have access to this program.")
})

test("the editor file index waits for provisioning and tracks repository changes", async () => {
  const t = convexTest(schema, modules)
  const programId = await t.run(async (ctx) => {
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Team",
      ownerId: "owner",
      createdAt: 1,
    })
    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId: "owner",
      role: "member",
      joinedAt: 1,
    })
    return ctx.db.insert("programs", {
      workspaceId,
      name: "Robot",
      template: "pros",
      repositoryId: "repo",
      repositoryStatus: "provisioning",
      createdBy: "owner",
      createdAt: 1,
    })
  })
  const owner = t.withIdentity({ subject: "owner" })
  await expect(
    owner.query(api.files.listByProgram, { programId })
  ).rejects.toThrow("not ready")
  await t.mutation(internal.programs.markRepositoryReady, {
    programId,
    headSha: "head",
    files: ["src/main.cpp", "include/robot.h"],
  })
  expect(
    (await owner.query(api.files.listByProgram, { programId }))
      .map((file) => file.path)
      .sort()
  ).toEqual(["include/robot.h", "src/main.cpp"])
  await t.mutation(internal.files.applyRepositoryChanges, {
    programId,
    actorId: "owner",
    changes: [
      { operation: "delete", path: "include/robot.h" },
      { operation: "put", path: "src/new.cpp" },
    ],
  })
  expect(
    (await owner.query(api.files.listByProgram, { programId }))
      .map((file) => file.path)
      .sort()
  ).toEqual(["src/main.cpp", "src/new.cpp"])
  await expect(
    t
      .withIdentity({ subject: "outsider" })
      .query(api.files.listByProgram, { programId })
  ).rejects.toThrow("access")
})
