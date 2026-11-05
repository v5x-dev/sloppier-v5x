import { describe, expect, test, vi } from "vitest"
import type { Repo } from "@pierre/storage"
import {
  commitChanges,
  LIVE_BACKUP_AUTHOR,
  snapshotParentSha,
} from "../convex/lib/codeStorage/repository"

const backup = LIVE_BACKUP_AUTHOR.email
const user = "student@example.com"

// Newest first, as listCommits returns the branch.
function history(
  ...commits: Array<[sha: string, parent: string | undefined, author: string]>
) {
  return {
    commits: commits.map(([sha, parent, authorEmail]) => ({
      sha,
      parentShas: parent ? [parent] : [],
      authorEmail,
    })),
  }
}

describe("snapshotParentSha", () => {
  test("uses the recorded head when only live-edit backups sit above it", () => {
    const log = history(
      ["b2", "b1", backup],
      ["b1", "r", backup],
      ["r", "x", user]
    )
    expect(snapshotParentSha(log, "b2", "r")).toBe("r")
  })

  test("returns the branch head when the recorded head is the branch head", () => {
    expect(snapshotParentSha(history(["r", "x", user]), "r", "r")).toBe("r")
  })

  test("returns the branch head when a user commit sits above the recorded head", () => {
    const log = history(
      ["b2", "u1", backup],
      ["u1", "r", user],
      ["r", "x", user]
    )
    expect(snapshotParentSha(log, "b2", "r")).toBe("b2")
  })

  test("returns the branch head when the branch moved after the history was read", () => {
    const log = history(
      ["b3", "b2", backup],
      ["b2", "r", backup],
      ["r", "x", user]
    )
    expect(snapshotParentSha(log, "b2", "r")).toBe("b2")
  })

  test("returns the branch head when the recorded head is not in the listed history", () => {
    const log = history(["b2", "b1", backup], ["b1", "y", backup])
    expect(snapshotParentSha(log, "b2", "r")).toBe("b2")
  })

  test("returns the branch head when the listed commits are not a chain", () => {
    // b1's parent is not the next listed commit, so the walk cannot prove what lies between.
    const log = history(
      ["b2", "b1", backup],
      ["z", "r", backup],
      ["r", "x", user]
    )
    expect(snapshotParentSha(log, "b2", "r")).toBe("b2")
  })

  test("returns the branch head when a merge commit sits above the recorded head", () => {
    const log = {
      commits: [
        { sha: "b2", parentShas: ["b1", "m"], authorEmail: backup },
        { sha: "b1", parentShas: ["r"], authorEmail: backup },
        { sha: "r", parentShas: ["x"], authorEmail: user },
      ],
    }
    expect(snapshotParentSha(log, "b2", "r")).toBe("b2")
  })

  test("falls back to the branch head without a recorded head", () => {
    expect(snapshotParentSha(history(["b2", "r", backup]), "b2", null)).toBe(
      "b2"
    )
  })
})

describe("commitChanges parent", () => {
  function fakeRepo(log: ReturnType<typeof history>, headSha: string) {
    return {
      defaultBranch: "main",
      listBranches: vi.fn(async () => ({
        branches: [{ name: "main", headSha }],
      })),
      listCommits: vi.fn(async () => ({ ...log, hasMore: false })),
      createCommit: vi.fn(() => ({
        addFile: vi.fn(),
        deletePath: vi.fn(),
        send: vi.fn(async () => ({ commitSha: "new" })),
      })),
    } as unknown as Repo
  }

  test("reports the recorded head as the parent when only backups were added since", async () => {
    const log = history(
      ["b2", "b1", backup],
      ["b1", "r", backup],
      ["r", "x", user]
    )
    const result = await commitChanges(
      fakeRepo(log, "b2"),
      [{ operation: "put", path: "src/main.cpp", contents: "int x;" }],
      "Update",
      { name: "A", email: user },
      [],
      "r"
    )
    expect(result).toEqual({ commitSha: "new", parentSha: "r" })
  })

  test("keeps the branch head as the parent when no recorded head is given", async () => {
    const log = history(["b2", "b1", backup], ["b1", "r", backup])
    const result = await commitChanges(
      fakeRepo(log, "b2"),
      [{ operation: "put", path: "src/main.cpp", contents: "int x;" }],
      "Update",
      { name: "A", email: user }
    )
    expect(result).toEqual({ commitSha: "new", parentSha: "b2" })
  })
})
