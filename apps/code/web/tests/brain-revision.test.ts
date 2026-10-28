import { expect, test, vi } from "vitest"
import { isInstalled, recordInstalled } from "../src/lib/brain-revision"
import type { Connection } from "@workspace/serial"

vi.mock("@workspace/serial", () => ({
  fileMetadata: (name: string) => ({ name }),
  fileTransferExit: () => ({ exit: true }),
  downloadFile: async (connection: any, options: any) =>
    connection.files.get(options.fileName).data,
  uploadFile: async (connection: any, data: Uint8Array, options: any) =>
    connection.files.set(options.fileName, {
      data,
      size: data.length,
      crc: 1,
      linkedVendor: null,
    }),
  NackError: class extends Error {},
}))

test("fake Brain only skips an upload when slot, revision and installed binary match", async () => {
  const files = new Map<string, any>([
    ["slot_1.bin", { size: 12, crc: 42, linkedVendor: null }],
  ])
  const brain = {
    type: "serial",
    files,
    request: async (command: any) => files.get(command.name) ?? null,
  } as unknown as Connection
  expect(await isInstalled(brain, 1, "program", "revision")).toBe(false)
  await recordInstalled(brain, 1, "program", "revision")
  expect(await isInstalled(brain, 1, "program", "revision")).toBe(true)
  expect(await isInstalled(brain, 1, "program", "other")).toBe(false)
  expect(await isInstalled(brain, 2, "program", "revision")).toBe(false)
  files.get("slot_1.bin").crc = 43
  expect(await isInstalled(brain, 1, "program", "revision")).toBe(false)
  files.get("slot_1.bin").crc = 42
  files.get("slot_1.bin").linkedVendor = 24
  expect(await isInstalled(brain, 1, "program", "revision")).toBe(false)
})

test("a record that is valid JSON but not an object is not installed", async () => {
  const files = new Map<string, any>([
    ["slot_1.bin", { size: 12, crc: 42, linkedVendor: null }],
    [
      "v5x_1.dat",
      {
        data: new TextEncoder().encode("null"),
        size: 4,
        crc: 1,
        linkedVendor: null,
      },
    ],
  ])
  const brain = {
    type: "serial",
    files,
    request: async (command: any) => files.get(command.name) ?? null,
  } as unknown as Connection
  expect(await isInstalled(brain, 1, "program", "revision")).toBe(false)
})
