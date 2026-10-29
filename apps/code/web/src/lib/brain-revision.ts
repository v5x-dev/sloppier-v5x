import {
  downloadFile,
  fileMetadata,
  fileTransferExit,
  uploadFile,
  NackError,
  type Connection,
} from "@v5x/serial"

export const RECORD_MAX_SIZE = 1024

export interface InstalledRecord {
  programId?: string
  sha?: string
  size?: number
  crc?: number
}

export function parseRecord(data: Uint8Array): InstalledRecord | null {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(data))
  } catch {
    return null
  }
  return typeof value === "object" && value !== null ? value : null
}

/** Downloads a small Brain file and closes the transfer session. */
export async function downloadBrainFile(
  connection: Connection,
  fileName: string,
  size: number
) {
  const data = await downloadFile(connection, { fileName, size })
  await connection.request(fileTransferExit())
  return data
}

// A record is written only after the binary transfer finishes. Compare it with
// the Brain's current binary metadata before trusting the recorded revision.
export async function isInstalled(
  connection: Connection,
  slot: number,
  programId: string,
  sha: string
) {
  if (connection.type === "controller") return false
  try {
    const record = await connection.request(fileMetadata(`v5x_${slot}.dat`))
    const binary = await connection.request(fileMetadata(`slot_${slot}.bin`))
    if (
      !record ||
      !binary ||
      binary.linkedVendor !== null ||
      record.size > RECORD_MAX_SIZE
    )
      return false
    const value = parseRecord(
      await downloadBrainFile(connection, `v5x_${slot}.dat`, record.size)
    )
    if (!value) return false
    return (
      value.programId === programId &&
      value.sha === sha &&
      value.size === binary.size &&
      value.crc === binary.crc
    )
  } catch (error) {
    if (error instanceof NackError) return false
    throw error
  }
}

export async function recordInstalled(
  connection: Connection,
  slot: number,
  programId: string,
  sha: string
) {
  const binary = await connection.request(fileMetadata(`slot_${slot}.bin`))
  if (!binary) return
  const data = new TextEncoder().encode(
    JSON.stringify({ programId, sha, size: binary.size, crc: binary.crc })
  )
  await uploadFile(connection, data, {
    fileName: `v5x_${slot}.dat`,
    metadata: { extension: "dat" },
  })
}
