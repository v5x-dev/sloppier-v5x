import { describe, expect, it, vi } from "vitest"
import type { ConvexReactClient } from "convex/react"
import { getFunctionName } from "convex/server"
import type { Id } from "@v5x/backend/dataModel"
import {
  prefetchProgramEditor,
  takePrefetchedProgramEditor,
} from "../src/lib/program-editor-prefetch"
import { WorkbenchSource } from "../src/lib/workbench-source"

const programId = "program-hover" as Id<"programs">

function fakeClient() {
  const action = vi.fn(async (reference: unknown) => {
    const name = getFunctionName(reference as never)
    if (name === "codeStorage:readFile")
      return {
        bytes: new TextEncoder().encode("int main() {}").buffer,
        contentRange: null,
        contentType: "text/plain",
      }
    throw new Error("unexpected action")
  })
  const query = vi.fn(async (_reference: unknown) => [{ path: "src/main.cpp" }])
  return {
    client: { action, query } as unknown as ConvexReactClient,
    action,
    query,
  }
}

describe("program editor prefetch", () => {
  it("starts the listing once for a hovered Program and hands it to the editor", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} })
    try {
      const { client, action, query } = fakeClient()
      prefetchProgramEditor(client, programId)
      prefetchProgramEditor(client, programId)
      expect(
        query.mock.calls.filter(
          ([reference]) =>
            getFunctionName(reference as never) === "files:listByProgram"
        )
      ).toHaveLength(1)

      const source = takePrefetchedProgramEditor(programId)
      expect(source).toBeInstanceOf(WorkbenchSource)
      expect(
        action.mock.calls.some(
          ([reference]) =>
            getFunctionName(reference as never) === "codeStorage:openLiveFile"
        )
      ).toBe(false)
      await vi.waitFor(() =>
        expect(source?.getSnapshot().paths).toEqual(["src/main.cpp"])
      )
      expect(takePrefetchedProgramEditor(programId)).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("returns nothing for a Program that was never hovered", () => {
    expect(
      takePrefetchedProgramEditor("other" as Id<"programs">)
    ).toBeUndefined()
  })
})
