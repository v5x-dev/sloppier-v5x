import {
  directoryEntry,
  directoryFileCount,
  type Connection,
} from "@v5x/serial"
import {
  downloadBrainFile,
  parseRecord,
  RECORD_MAX_SIZE,
} from "./brain-revision"
import {
  BRAIN_SLOT_COUNT,
  parseProgramName,
  type BrainSlotReading,
} from "./brain-slots"

const INI_MAX_SIZE = 1024

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
