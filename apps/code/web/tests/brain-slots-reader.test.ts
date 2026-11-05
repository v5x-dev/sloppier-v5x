import { expect, it, vi } from "vitest"
import {
  readBrainSlots,
  SlotReadCancelled,
} from "../src/lib/brain-slots-reader"

it("stops between requests once the caller no longer wants the Brain read", async () => {
  let open = true
  const request = vi.fn(async () => {
    // The first request is the file count; each later one is a directory entry.
    if (request.mock.calls.length === 1) return 3
    open = false
    return { fileName: "unrelated.txt", size: 0, crc: 0 }
  })
  const connection = { request } as unknown as Parameters<
    typeof readBrainSlots
  >[0]
  await expect(
    readBrainSlots(connection, { keepReading: () => open })
  ).rejects.toBeInstanceOf(SlotReadCancelled)
  // The request in flight completes, and no further request is started.
  expect(request).toHaveBeenCalledTimes(2)
})
