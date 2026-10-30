import type { InstalledRecord } from "./brain-revision"

export const BRAIN_SLOT_COUNT = 8
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
