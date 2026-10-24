import { describe, expect, test } from "bun:test"
import { applyRepositoryChanges } from "../packages/backend/convex/files"

type Row = {
  _id: string
  projectId: string
  path: string
  [key: string]: unknown
}
function repositoryContext(initial: Record<string, Row[]>) {
  const tables = new Map(
    Object.entries(initial).map(([name, rows]) => [
      name,
      rows.map((row) => ({ ...row })),
    ])
  )
  const scheduled: unknown[] = []
  const ctx = {
    db: {
      query(table: string) {
        const filters: [string, unknown][] = []
        return {
          withIndex(_index: string, filter: (query: unknown) => unknown) {
            const query = {
              eq(field: string, value: unknown) {
                filters.push([field, value])
                return query
              },
            }
            filter(query)
            return {
              async unique() {
                return (
                  tables
                    .get(table)
                    ?.find((row) =>
                      filters.every(([field, value]) => row[field] === value)
                    ) ?? null
                )
              },
            }
          },
        }
      },
      async delete(id: string) {
        for (const [name, rows] of tables)
          tables.set(
            name,
            rows.filter((row) => row._id !== id)
          )
      },
      async patch(id: string, fields: Record<string, unknown>) {
        for (const rows of tables.values()) {
          const row = rows.find((entry) => entry._id === id)
          if (row) Object.assign(row, fields)
        }
      },
      async insert(table: string, fields: Omit<Row, "_id">) {
        const rows = tables.get(table) ?? []
        const id = `new-${table}-${rows.length}`
        rows.push({ _id: id, ...fields } as Row)
        tables.set(table, rows)
        return id
      },
    },
    scheduler: {
      async runAfter(...args: unknown[]) {
        scheduled.push(args)
      },
    },
  }
  return { ctx, tables, scheduled }
}
const apply = (
  applyRepositoryChanges as unknown as {
    _handler: (ctx: unknown, args: unknown) => Promise<void>
  }
)._handler

describe("Explorer moves and live documents", () => {
  test("a rename preserves the live document ID and all unsaved updates", async () => {
    const { ctx, tables, scheduled } = repositoryContext({
      files: [{ _id: "file", projectId: "project", path: "src/main.cpp" }],
      crdtDocuments: [
        {
          _id: "live",
          projectId: "project",
          path: "src/main.cpp",
          lastSequence: 7,
        },
      ],
      crdtUpdates: [
        {
          _id: "update",
          projectId: "project",
          path: "",
          documentId: "live",
          bytes: "unsaved edits",
        },
      ],
    })
    await apply(ctx, {
      projectId: "project",
      actorId: "user",
      changes: [
        { operation: "put", path: "lib/main.cpp" },
        { operation: "delete", path: "src/main.cpp" },
      ],
      moves: [{ from: "src/main.cpp", to: "lib/main.cpp" }],
    })
    expect(tables.get("files")?.map((row) => row.path)).toEqual([
      "lib/main.cpp",
    ])
    expect(tables.get("crdtDocuments")).toEqual([
      expect.objectContaining({
        _id: "live",
        path: "lib/main.cpp",
        lastSequence: 7,
      }),
    ])
    expect(tables.get("crdtUpdates")?.[0].bytes).toBe("unsaved edits")
    expect(scheduled).toEqual([])
  })

  test("deleting a file removes its live document and schedules update cleanup", async () => {
    const { ctx, tables, scheduled } = repositoryContext({
      files: [{ _id: "file", projectId: "project", path: "main.cpp" }],
      crdtDocuments: [{ _id: "live", projectId: "project", path: "main.cpp" }],
    })
    await apply(ctx, {
      projectId: "project",
      actorId: "user",
      changes: [{ operation: "delete", path: "main.cpp" }],
    })
    expect(tables.get("files")).toEqual([])
    expect(tables.get("crdtDocuments")).toEqual([])
    expect(scheduled).toHaveLength(1)
  })
})
