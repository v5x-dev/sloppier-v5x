/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import schema from "../convex/schema"
import { api } from "../convex/_generated/api"
import { restoreUpdate, visibleHistoryPath } from "../convex/lib/history"

const modules = import.meta.glob("../convex/**/*.ts")

describe("history restore", () => {
  it("replaces known live text while preserving edits that arrive concurrently", () => {
    const original = new Y.Doc()
    const collaborator = new Y.Doc()
    original.getText("source").insert(0, "old program")
    const snapshot = Y.encodeStateAsUpdate(original).buffer as ArrayBuffer
    Y.applyUpdate(collaborator, new Uint8Array(snapshot))
    const restore = restoreUpdate([snapshot], "restored program")
    collaborator
      .getText("source")
      .insert(collaborator.getText("source").length, "\n// teammate's new edit")
    Y.applyUpdate(collaborator, new Uint8Array(restore))
    Y.applyUpdate(original, Y.encodeStateAsUpdate(collaborator))
    expect(original.getText("source").toString()).toContain("restored program")
    expect(original.getText("source").toString()).toContain(
      "teammate's new edit"
    )
    expect(original.getText("source").toString()).not.toContain("old program")
    expect(collaborator.getText("source").toString()).toBe(
      original.getText("source").toString()
    )
    original.destroy()
    collaborator.destroy()
  })
  it("supports empty-file restoration and hides only reserved backup paths", () => {
    const doc = new Y.Doc()
    doc.getText("source").insert(0, "remove me")
    const snapshot = Y.encodeStateAsUpdate(doc).buffer as ArrayBuffer
    Y.applyUpdate(doc, new Uint8Array(restoreUpdate([snapshot], "")))
    expect(doc.getText("source").toString()).toBe("")
    expect(visibleHistoryPath(".v5x/backup.bin")).toBe(false)
    expect(visibleHistoryPath("src/main.cpp")).toBe(true)
    expect(visibleHistoryPath("src/.v5x/helper.cpp")).toBe(true)
    doc.destroy()
  })
  it("rejects nonmembers before accessing repository history or restoring files", async () => {
    vi.useFakeTimers()
    try {
      const t = convexTest(schema, modules)
      const projectId = await t.run(async (ctx) => {
        const workspaceId = await ctx.db.insert("workspaces", {
          name: "Team",
          ownerId: "alice",
          createdAt: 1,
        })
        return ctx.db.insert("projects", {
          workspaceId,
          name: "Robot",
          template: "pros",
          repositoryId: "repo",
          repositoryStatus: "ready",
          createdBy: "alice",
          createdAt: 1,
        })
      })
      const outsider = t.withIdentity({ subject: "mallory" })
      await expect(
        outsider.action(api.codeStorage.history, { projectId })
      ).rejects.toThrow("You do not have access to this program.")
      await expect(
        outsider.action(api.codeStorage.historyFiles, {
          projectId,
          sha: "a".repeat(40),
        })
      ).rejects.toThrow("You do not have access to this program.")
      await expect(
        outsider.action(api.codeStorage.historyDiff, {
          projectId,
          sha: "a".repeat(40),
          path: "src/main.cpp",
        })
      ).rejects.toThrow("You do not have access to this program.")
      await expect(
        outsider.action(api.codeStorage.restoreHistoryFile, {
          projectId,
          sha: "a".repeat(40),
          path: "src/main.cpp",
        })
      ).rejects.toThrow("You do not have access to this program.")
    } finally {
      vi.useRealTimers()
    }
  })
})
