import { expect, it } from "vitest"
import { openSerial, uploadProgram } from "@v5x/serial"
import { FakeBrain } from "./fake-brain"
import { isInstalled, recordInstalled } from "../src/lib/brain-revision"
import { readBrainSlots } from "../src/lib/brain-slots-reader"

it("stores an uploaded program and reports the installed revision through real serial commands", async () => {
  const brain = new FakeBrain(0)
  const connection = await openSerial(brain)
  const progress: number[] = []
  try {
    expect(await isInstalled(connection, 1, "program", "revision")).toBe(false)
    await uploadProgram(
      connection,
      { type: "monolith", data: crypto.getRandomValues(new Uint8Array(4096)) },
      {
        slot: 1,
        name: "Test robot",
        compress: false,
        onProgress: (file, percent) => {
          if (file === "bin") progress.push(percent)
        },
      }
    )
    await recordInstalled(connection, 1, "program", "revision")
    expect(progress.length).toBeGreaterThan(1)
    expect(progress.at(-1)).toBe(100)
    expect(await isInstalled(connection, 1, "program", "revision")).toBe(true)
    expect(await isInstalled(connection, 1, "program", "other")).toBe(false)
    const slots = await readBrainSlots(connection)
    expect(slots[0]).toMatchObject({
      name: "Test robot",
      record: { programId: "program", sha: "revision" },
    })
    expect(slots[1].binary).toBeNull()
  } finally {
    await connection.close()
  }
})
