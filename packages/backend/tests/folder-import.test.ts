/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import schema from "../convex/schema"
import { api, internal } from "../convex/_generated/api"
import {
  excludedImportPath,
  validateImportPaths,
  detectImportTemplate,
  IMPORT_BATCH_BYTES,
  IMPORT_MAX_BYTES,
} from "../convex/lib/folderImport"

const modules = import.meta.glob("../convex/**/*.ts")
const repository = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  fail: false,
  commits: 0,
}))
vi.mock("@pierre/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pierre/storage")>()
  const repo = {
    defaultBranch: "main",
    listBranches: async () => ({ branches: [] }),
    createCommit: () => {
      const changes = new Map<string, Uint8Array>()
      return {
        addFile: (path: string, contents: Uint8Array) =>
          changes.set(path, contents),
        send: async () => {
          if (repository.fail) throw new Error("Temporary repository failure")
          for (const [path, bytes] of changes) repository.files.set(path, bytes)
          repository.commits++
          return { commitSha: `commit-${repository.commits}` }
        },
      }
    },
  }
  return {
    ...actual,
    GitStorage: class {
      async findOne() {
        return repo
      }
    },
  }
})
const source = (path = "src/main.cpp", text = "// my robot") => ({
  path,
  contents: new TextEncoder().encode(text).buffer as ArrayBuffer,
})
async function setup(expectedFiles = 1) {
  const t = convexTest(schema, modules)
  const user = t.withIdentity({ subject: "alice" })
  const workspaceId = await user.mutation(api.workspaces.create, {
    name: "Team",
  })
  const importId = await user.mutation(api.projects.beginFolderImport, {
    workspaceId,
    name: "My existing robot",
    template: "pros",
    expectedFiles,
  })
  return { t, user, workspaceId, importId }
}

describe("folder imports", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv("PIERRE_ORG", "test")
    vi.stubEnv("PIERRE_PRIVATE_KEY", "test")
    repository.files.clear()
    repository.fail = false
    repository.commits = 0
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it("imports multiple batches exactly, preserves binary bytes, and cleans staging data", async () => {
    const { t, user, workspaceId, importId } = await setup(2)
    const binary = {
      path: "assets/robot.dat",
      contents: Uint8Array.of(0, 255, 128, 4).buffer,
    }
    await user.mutation(api.projects.appendFolderImport, {
      importId,
      sequence: 0,
      files: [source()],
    })
    await user.mutation(api.projects.appendFolderImport, {
      importId,
      sequence: 1,
      files: [binary],
    })
    const projectId = await user.mutation(api.projects.finishFolderImport, {
      importId,
    })
    expect(
      await user.mutation(api.projects.finishFolderImport, { importId })
    ).toBe(projectId)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect([...repository.files.keys()]).toEqual([
      "src/main.cpp",
      "assets/robot.dat",
    ])
    expect(new TextDecoder().decode(repository.files.get("src/main.cpp"))).toBe(
      "// my robot"
    )
    expect([...repository.files.get("assets/robot.dat")!]).toEqual([
      0, 255, 128, 4,
    ])
    expect(await user.query(api.projects.get, { projectId })).toMatchObject({
      name: "My existing robot",
      repositoryStatus: "ready",
      repositoryHeadSha: "commit-2",
    })
    expect(await t.run((ctx) => ctx.db.get(importId))).toBeNull()
    expect(
      await t.run((ctx) => ctx.db.query("programImportBatches").collect())
    ).toEqual([])
    const files = await t.run((ctx) => ctx.db.query("files").collect())
    expect(files.every((file) => file.origin === "user")).toBe(true)
    expect(
      await user.query(api.projects.listByWorkspace, { workspaceId })
    ).toHaveLength(1)
  })

  it("retains original source on provisioning failure and retries without starter files", async () => {
    const { t, user, importId } = await setup()
    await user.mutation(api.projects.appendFolderImport, {
      importId,
      sequence: 0,
      files: [source()],
    })
    repository.fail = true
    const projectId = await user.mutation(api.projects.finishFolderImport, {
      importId,
    })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await user.query(api.projects.get, { projectId })).toMatchObject({
      repositoryStatus: "failed",
    })
    expect(await t.run((ctx) => ctx.db.get(importId))).not.toBeNull()
    repository.fail = false
    await user.mutation(api.projects.retryProvisioning, { projectId })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await user.query(api.projects.get, { projectId })).toMatchObject({
      repositoryStatus: "ready",
    })
    expect([...repository.files.keys()]).toEqual(["src/main.cpp"])
  })

  it("keeps unfinished uploads off the dashboard and expires their data", async () => {
    const { t, user, workspaceId, importId } = await setup(2)
    await user.mutation(api.projects.appendFolderImport, {
      importId,
      sequence: 0,
      files: [source()],
    })
    await expect(
      user.mutation(api.projects.finishFolderImport, { importId })
    ).rejects.toThrow("all folder files")
    expect(
      await user.query(api.projects.listByWorkspace, { workspaceId })
    ).toEqual([])
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await t.run((ctx) => ctx.db.get(importId))).toBeNull()
    expect(
      await t.run((ctx) => ctx.db.query("programImportBatches").collect())
    ).toEqual([])
  })

  it("allows exact batch retries but rejects changed bytes, ordering, and conflicting paths", async () => {
    const { t, user, importId } = await setup(3)
    const batch = { importId, sequence: 0, files: [source("src", "one")] }
    await user.mutation(api.projects.appendFolderImport, batch)
    await user.mutation(api.projects.appendFolderImport, batch)
    await expect(
      user.mutation(api.projects.appendFolderImport, {
        ...batch,
        files: [source("src", "two")],
      })
    ).rejects.toThrow("same files")
    await expect(
      user.mutation(api.projects.appendFolderImport, {
        importId,
        sequence: 2,
        files: [source()],
      })
    ).rejects.toThrow("in order")
    await expect(
      user.mutation(api.projects.appendFolderImport, {
        importId,
        sequence: 1,
        files: [source("src-other"), source()],
      })
    ).rejects.toThrow("Conflicting file path")
    expect((await t.run((ctx) => ctx.db.get(importId)))?.paths).toEqual(["src"])
    await t.finishAllScheduledFunctions(vi.runAllTimers)
  })

  it("enforces membership and uploader ownership on every upload step", async () => {
    const { t, user, workspaceId, importId } = await setup()
    const teammate = t.withIdentity({ subject: "bob" })
    await user.mutation(api.workspaces.addMember, {
      workspaceId,
      userId: "bob",
    })
    await expect(
      teammate.mutation(api.projects.appendFolderImport, {
        importId,
        sequence: 0,
        files: [source()],
      })
    ).rejects.toThrow("another user")
    await expect(
      teammate.mutation(api.projects.finishFolderImport, { importId })
    ).rejects.toThrow("another user")
    await expect(
      t.mutation(api.projects.beginFolderImport, {
        workspaceId,
        name: "Bad",
        template: "pros",
        expectedFiles: 1,
      })
    ).rejects.toThrow("Authentication required")
    const outsider = t.withIdentity({ subject: "outsider" })
    await expect(
      outsider.mutation(api.projects.appendFolderImport, {
        importId,
        sequence: 0,
        files: [source()],
      })
    ).rejects.toThrow("do not have access")
    await t.finishAllScheduledFunctions(vi.runAllTimers)
  })

  it("enforces file counts, byte limits, and server-side exclusions", async () => {
    const { t, user, workspaceId, importId } = await setup()
    await expect(
      user.mutation(api.projects.beginFolderImport, {
        workspaceId,
        name: "Empty",
        template: "pros",
        expectedFiles: 0,
      })
    ).rejects.toThrow("between 1 and 1000")
    for (const path of [
      "include/pros/api.h",
      "firmware/v5.ld",
      ".vscode/settings.json",
      "compile_commands.json",
      "README.md",
      "EZ-Template@3.2.2.zip",
    ]) {
      await expect(
        user.mutation(api.projects.appendFolderImport, {
          importId,
          sequence: 0,
          files: [source(path)],
        })
      ).rejects.toThrow("excluded")
    }
    await expect(
      user.mutation(api.projects.appendFolderImport, {
        importId,
        sequence: 0,
        files: [source("../escape.cpp")],
      })
    ).rejects.toThrow("normalized relative")
    await expect(
      user.mutation(api.projects.appendFolderImport, {
        importId,
        sequence: 0,
        files: [
          {
            path: "big.txt",
            contents: new ArrayBuffer(IMPORT_BATCH_BYTES + 1),
          },
        ],
      })
    ).rejects.toThrow("384 KiB")
    await expect(
      user.mutation(api.projects.appendFolderImport, {
        importId,
        sequence: 0,
        files: [source("a.cpp"), source("b.cpp")],
      })
    ).rejects.toThrow("more files than expected")
    await t.run((ctx) =>
      ctx.db.patch(importId, { totalBytes: IMPORT_MAX_BYTES })
    )
    await expect(
      user.mutation(api.projects.appendFolderImport, {
        importId,
        sequence: 0,
        files: [source()],
      })
    ).rejects.toThrow("16 MiB")
    await t.finishAllScheduledFunctions(vi.runAllTimers)
  })

  it("does not delete a live upload during an early cleanup call", async () => {
    const { t, importId } = await setup()
    await t.mutation(internal.projects.cleanupFolderImport, { importId })
    expect(await t.run((ctx) => ctx.db.get(importId))).not.toBeNull()
    await t.finishAllScheduledFunctions(vi.runAllTimers)
  })
})

it("detects supported project types and validates path collisions and local exclusions", () => {
  expect(
    detectImportTemplate(["project.pros", "include/EZ-Template/api.hpp"])
  ).toBe("ez-template")
  expect(detectImportTemplate(["include/JAR-Template/drive.h"])).toBe("jar")
  expect(detectImportTemplate(["project.pros"])).toBe("pros")
  expect(detectImportTemplate(["include/vex.h"])).toBe("vexcode")
  expect(detectImportTemplate(["unknown.txt"])).toBeNull()
  for (const path of [
    ".git/config",
    ".v5x/update.bin",
    ".env",
    "nested/.env.local",
    "bin/output.bin",
    "firmware/lib.a",
    "include/pros/api.h",
    "common.mk",
  ])
    expect(excludedImportPath("pros", path)).not.toBeNull()
  expect(excludedImportPath("pros", "src/robot.cpp")).toBeNull()
  for (const paths of [
    ["a", "a-b", "a/file.cpp"],
    ["same", "same"],
    ["a\u0000.cpp"],
    ["/absolute"],
    ["../outside"],
  ])
    expect(() => validateImportPaths(paths)).toThrow()
  expect(() =>
    validateImportPaths(["src/a.cpp", "src/b.cpp", "README.md"])
  ).not.toThrow()
})
