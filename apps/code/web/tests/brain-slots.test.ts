import { expect, test, vi } from "vitest"
import type { Connection } from "@v5x/serial"
import {
  matchBrainSlot,
  parseProgramName,
  type BrainSlotReading,
} from "../src/lib/brain-slots"
import { readBrainSlots } from "../src/lib/brain-slots-reader"

vi.mock("@v5x/serial", () => ({
  directoryFileCount: () => ({ command: "count" }),
  directoryEntry: (index: number) => ({ command: "entry", index }),
  fileTransferExit: () => ({ command: "exit" }),
  downloadFile: async (connection: any, options: any) =>
    connection.files.get(options.fileName).data,
}))

const text = (value: string, crc = 1) => ({
  data: new TextEncoder().encode(value),
  crc,
})
const binary = (size: number, crc: number) => ({
  data: new Uint8Array(size),
  crc,
})
const ini = (name: string) =>
  `[project]\nide=vexide\n[program]\nname=${name}\nslot=0\n`
const record = (value: object) => text(JSON.stringify(value))

// A fake Brain whose user directory lists the given files in order.
function fakeBrain(files: Map<string, { data: Uint8Array; crc: number }>) {
  const entries = [...files]
  return {
    type: "serial",
    files,
    request: async (command: any) => {
      if (command.command === "count") return entries.length
      if (command.command === "exit") return null
      if (command.command === "entry") {
        const [fileName, file] = entries[command.index]
        return {
          index: command.index,
          fileName,
          size: file.data.length,
          crc: file.crc,
        }
      }
      throw new Error(`Unexpected command ${JSON.stringify(command)}`)
    },
  } as unknown as Connection
}

const target = { programId: "program", revision: "head" }

test("reads every slot's name and match status from the directory", async () => {
  const brain = fakeBrain(
    new Map([
      ["slot_1.ini", text(ini("Auton Skills"))],
      ["slot_1.bin", binary(1200, 7)],
      [
        "v5x_1.dat",
        record({ programId: "program", sha: "head", size: 1200, crc: 7 }),
      ],
      ["slot_2.ini", text(ini("Driver"))],
      ["slot_2.bin", binary(900, 8)],
      [
        "v5x_2.dat",
        record({ programId: "program", sha: "old", size: 900, crc: 8 }),
      ],
      ["slot_3.ini", text(ini("Skills"))],
      ["slot_3.bin", binary(300, 9)],
      [
        "v5x_3.dat",
        record({ programId: "other", sha: "head", size: 300, crc: 9 }),
      ],
      ["slot_4.ini", text(ini("VEXcode demo"))],
      ["slot_4.bin", binary(400, 10)],
      ["slot_5.bin", binary(500, 11)],
      ["slot_6.ini", text(ini("Orphan name"))],
      ["slot_9.bin", binary(10, 12)],
      ["notes.txt", text("ignored")],
    ])
  )
  const readings = await readBrainSlots(brain)
  expect(readings.map((reading) => reading.slot)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8,
  ])
  expect(readings.map((reading) => reading.name)).toEqual([
    "Auton Skills",
    "Driver",
    "Skills",
    "VEXcode demo",
    null,
    "Orphan name",
    null,
    null,
  ])
  expect(readings.map((reading) => matchBrainSlot(reading, target))).toEqual([
    "current",
    "other-revision",
    "other-program",
    "untracked",
    "untracked",
    "empty",
    "empty",
    "empty",
  ])
})

test("an unreadable record leaves its binary untracked", async () => {
  const brain = fakeBrain(
    new Map([
      ["slot_1.bin", binary(12, 3)],
      ["v5x_1.dat", text("not json")],
    ])
  )
  const [first] = await readBrainSlots(brain)
  expect(first.record).toBeNull()
  expect(matchBrainSlot(first, target)).toBe("untracked")
})

test("parses the program name from the [program] section only", () => {
  expect(
    parseProgramName(
      "[project]\r\nname=Wrong\r\n[program]\r\nname=Auton = Skills\r\nslot=0\r\n"
    )
  ).toBe("Auton = Skills")
  expect(parseProgramName("[program]\nslot=0\n")).toBeNull()
  expect(parseProgramName("name=Loose\n")).toBeNull()
  expect(parseProgramName("[program]\nname=   \n")).toBeNull()
})

test("matches a slot only when program, revision, and binary agree", () => {
  const slot = (
    recordValue: BrainSlotReading["record"],
    binaryValue: BrainSlotReading["binary"] = { size: 10, crc: 1 }
  ): BrainSlotReading => ({
    slot: 1,
    name: "Auton",
    binary: binaryValue,
    record: recordValue,
  })
  expect(matchBrainSlot(slot(null, null), target)).toBe("empty")
  expect(
    matchBrainSlot(
      slot({ programId: "program", sha: "head", size: 10, crc: 1 }),
      target
    )
  ).toBe("current")
  expect(
    matchBrainSlot(
      slot({ programId: "program", sha: "old", size: 10, crc: 1 }),
      target
    )
  ).toBe("other-revision")
  expect(
    matchBrainSlot(
      slot({ programId: "other", sha: "head", size: 10, crc: 1 }),
      target
    )
  ).toBe("other-program")
  expect(
    matchBrainSlot(
      slot({ programId: "program", sha: "head", size: 10, crc: 2 }),
      target
    )
  ).toBe("untracked")
  expect(
    matchBrainSlot(slot({ programId: "program", sha: "head" }), target)
  ).toBe("untracked")
  // Without a known head, no record can claim to be the current revision.
  expect(
    matchBrainSlot(slot({ programId: "program", size: 10, crc: 1 }), {
      programId: "program",
    })
  ).toBe("other-revision")
})
