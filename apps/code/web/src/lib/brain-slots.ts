import {
  directoryEntry,
  directoryFileCount,
  type Connection,
} from "@v5x/serial"
import {
  downloadBrainFile,
  parseRecord,
  RECORD_MAX_SIZE,
  type InstalledRecord,
} from "./brain-revision"

export const BRAIN_SLOT_COUNT = 8
const INI_MAX_SIZE = 1024

export interface BrainSlotReading {
  slot: number
  /** The `[program] name=` value from the slot's INI, when it has one. */
  name: string | null
  binary: { size: number; crc: number } | null
  /** The v5x record for this slot, when it can be read. */
  record: InstalledRecord | null
}

export type BrainSlotMatch =
  "empty" | "current" | "other-revision" | "other-program" | "untracked"

/** Compares a slot's installed binary with the Program and revision open in the editor. */
export function matchBrainSlot(
  reading: BrainSlotReading,
  target: { programId: string; revision?: string }
): BrainSlotMatch {
  const { binary, record } = reading
  if (!binary) return "empty"
  // A record describes only the binary it was written with. Any other binary,
  // such as one uploaded from VEXcode, is untracked.
  if (!record || record.size !== binary.size || record.crc !== binary.crc)
    return "untracked"
  if (record.programId !== target.programId) return "other-program"
  return target.revision !== undefined && record.sha === target.revision
    ? "current"
    : "other-revision"
}

export function parseProgramName(ini: string): string | null {
  let section = ""
  for (const line of ini.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]*)\]\s*$/.exec(line)
    if (header) {
      section = header[1].trim()
      continue
    }
    if (section !== "program") continue
    const separator = line.indexOf("=")
    if (separator === -1 || line.slice(0, separator).trim() !== "name") continue
    return line.slice(separator + 1).trim() || null
  }
  return null
}

/** Reads every slot's name and v5x record through the Brain's user directory. */
export async function readBrainSlots(
  connection: Connection
): Promise<BrainSlotReading[]> {
  const count = await connection.request(directoryFileCount())
  const files = new Map<string, { size: number; crc: number }>()
  for (let index = 0; index < count; index++) {
    const entry = await connection.request(directoryEntry(index))
    files.set(entry.fileName, { size: entry.size, crc: entry.crc })
  }
  const readings: BrainSlotReading[] = []
  for (let slot = 1; slot <= BRAIN_SLOT_COUNT; slot++) {
    const ini = files.get(`slot_${slot}.ini`)
    const binary = files.get(`slot_${slot}.bin`) ?? null
    const recordFile = files.get(`v5x_${slot}.dat`)
    const name =
      ini && ini.size <= INI_MAX_SIZE
        ? parseProgramName(
            new TextDecoder().decode(
              await downloadBrainFile(connection, `slot_${slot}.ini`, ini.size)
            )
          )
        : null
    const record =
      binary && recordFile && recordFile.size <= RECORD_MAX_SIZE
        ? parseRecord(
            await downloadBrainFile(
              connection,
              `v5x_${slot}.dat`,
              recordFile.size
            )
          )
        : null
    readings.push({ slot, name, binary, record })
  }
  return readings
}
