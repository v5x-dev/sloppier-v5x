/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { expect, test } from "vitest"
import schema from "../convex/schema"
import { api } from "../convex/_generated/api"
import * as facade from "../convex/codeStorage"
const modules = import.meta.glob("../convex/**/*.ts")

test("keeps the deployed Code Storage API facade stable", () => {
  expect(Object.keys(facade).sort()).toEqual(
    [
      "buildManifest",
      "commitFiles",
      "createCheckpoint",
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
