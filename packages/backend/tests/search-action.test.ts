/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { afterEach, describe, expect, it, vi } from "vitest"
import schema from "../convex/schema"
import { api, internal } from "../convex/_generated/api"

const modules = import.meta.glob("../convex/**/*.ts")

type GrepResult = {
  matches: Array<{
    path: string
    lines: Array<{ lineNumber: number; text: string }>
  }>
  hasMore: boolean
  nextCursor?: string
}

const repo = vi.hoisted(() => ({
  grep: vi.fn(async (_args: unknown): Promise<GrepResult> => ({
    matches: [],
    hasMore: false,
  })),
}))

vi.mock("@pierre/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@pierre/storage")>()),
  GitStorage: class {
    repo() {
      return repo
    }
  },
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

async function setup() {
  vi.stubEnv("PIERRE_ORG", "test")
  vi.stubEnv("PIERRE_PRIVATE_KEY", "test")
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
  return { t, programId, user: t.withIdentity({ subject: "alice" }) }
}

// Opens a live document the way the editor does: a file row, then its seed.
async function openLive(
  t: Awaited<ReturnType<typeof setup>>["t"],
  programId: Awaited<ReturnType<typeof setup>>["programId"],
  path: string,
  contents: string
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("files", {
      programId,
      path,
      origin: "user",
      createdBy: "alice",
      createdAt: 1,
      updatedAt: 1,
    })
  })
  await t.mutation(internal.crdt.initializeDocument, {
    programId,
    path,
    actorId: "alice",
    contents,
  })
}

describe("program search", () => {
  it("shows live text in place of the committed match for an open file", async () => {
    const { t, programId, user } = await setup()
    await openLive(t, programId, "src/main.cpp", "intro\nlive foo\n")
    repo.grep.mockResolvedValueOnce({
      matches: [
        {
          path: "src/main.cpp",
          lines: [{ lineNumber: 1, text: "committed foo" }],
        },
        { path: "lib/util.cpp", lines: [{ lineNumber: 2, text: "util foo" }] },
      ],
      hasMore: false,
    })

    const result = await user.action(api.codeStorage.searchProgram, {
      programId,
      query: "foo",
      matchCase: false,
    })

    expect(result.skipped).toBe(0)
    expect(result.files.map((file) => file.path)).toEqual([
      "lib/util.cpp",
      "src/main.cpp",
    ])
    // The committed match at line 1 is replaced by the live match at line 2.
    expect(
      result.files
        .find((file) => file.path === "src/main.cpp")!
        .matches.map((match) => match.line)
    ).toEqual([2])
  })

  it("replays at most 100 live documents and reports the rest as skipped", async () => {
    const { t, programId, user } = await setup()
    const paths = Array.from(
      { length: 101 },
      (_, index) => `src/f${String(index).padStart(3, "0")}.cpp`
    )
    for (const path of paths) await openLive(t, programId, path, "foo\n")
    repo.grep.mockResolvedValueOnce({ matches: [], hasMore: false })

    const result = await user.action(api.codeStorage.searchProgram, {
      programId,
      query: "foo",
      matchCase: false,
    })

    expect(result.skipped).toBe(1)
    expect(result.files).toHaveLength(100)
    expect(result.files.map((file) => file.path)).toContain("src/f099.cpp")
    expect(result.files.map((file) => file.path)).not.toContain("src/f100.cpp")
  })
})
