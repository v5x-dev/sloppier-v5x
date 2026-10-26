import type { Connection } from "./connection"
import { crc32, NackError } from "./protocol"
import { systemVersion } from "./commands"
import {
  FileExitAction,
  FileVendor,
  FileLoadAction,
  fileLoadAction,
  fileMetadata,
  PROS_HOT_BIN_LOAD_ADDR,
  USER_PROGRAM_LOAD_ADDR,
  uploadFile,
  radioChannel,
} from "./files"

export type ProgramData =
  | { type: "monolith"; data: Uint8Array }
  | { type: "hot-cold"; hot: Uint8Array; cold: Uint8Array }
export interface UploadProgramOptions {
  slot: number
  name: string
  description?: string
  programType?: string
  icon?: string
  compress?: boolean
  afterUpload?: FileExitAction
  onProgress?: (file: "ini" | "bin" | "lib", percent: number) => void
}
async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
export async function uploadProgram(
  connection: Connection,
  program: ProgramData,
  options: UploadProgramOptions
): Promise<void> {
  if (!Number.isInteger(options.slot) || options.slot < 1 || options.slot > 8)
    throw new RangeError("V5 program slot must be between 1 and 8")
  for (const value of [
    options.name,
    options.description,
    options.programType,
    options.icon,
  ])
    if (value && /[\r\n\0]/.test(value))
      throw new RangeError("Program metadata must be a single line without NUL")
  if (
    program.type === "hot-cold" &&
    (!program.hot?.length || !program.cold?.length)
  )
    throw new Error("Supply both non-empty hot and cold binaries")
  if (connection.type !== "controller") {
    await uploadProgramFiles(connection, program, options)
    return
  }
  const info = await connection.request(systemVersion())
  if (!(info.flags & 2))
    throw new Error("Connect the V5 controller to a V5 Brain before uploading.")
  await connection.request(radioChannel("download"), { timeout: 2000 })
  let failed = false
  try {
    // Changing channels briefly disconnects the controller from the Brain.
    const deadline = Date.now() + 5000
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const status = await connection.request(systemVersion())
      if (status.flags & 2) break
      if (Date.now() >= deadline)
        throw new Error(
          "The V5 controller did not reconnect on the download channel."
        )
    }
    await uploadProgramFiles(connection, program, options)
  } catch (error) {
    failed = true
    throw error
  } finally {
    try {
      await connection.request(radioChannel("pit"), { timeout: 2000 })
    } catch (error) {
      if (!failed) throw error
    }
  }
}

async function uploadProgramFiles(
  connection: Connection,
  program: ProgramData,
  options: UploadProgramOptions
): Promise<void> {
  const base = `slot_${options.slot}`
  const hot = program.type === "monolith" ? program.data : program.hot
  const cold = program.type === "hot-cold" ? program.cold : undefined
  const compress = options.compress ?? true
  const afterUpload = options.afterUpload ?? FileExitAction.DoNothing
  // Content identity allows safe library reuse across programs and slots.
  const libraryName = cold
    ? btoa(
        String.fromCharCode(
          ...new Uint8Array(
            await crypto.subtle.digest("SHA-256", new Uint8Array(cold))
          ).slice(0, 16)
        )
      )
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "")
    : undefined
  if (cold && libraryName) {
    const data = compress ? await gzip(cold) : cold
    let existing: { size: number; crc: number } | null | undefined
    try {
      existing = await connection.request(
        fileMetadata(libraryName, FileVendor.Pros)
      )
    } catch (error) {
      // PROS also treats a missing-library NACK as a cache miss.
      if (!(error instanceof NackError)) throw error
    }
    if (existing?.size !== data.length || existing.crc !== crc32(data))
      await uploadFile(connection, data, {
        fileName: libraryName,
        vendor: FileVendor.Pros,
        metadata: { extension: "bin" },
        address: USER_PROGRAM_LOAD_ADDR,
        onProgress: (p) => options.onProgress?.("lib", p),
      })
    else options.onProgress?.("lib", 100)
  }
  if (program.type === "hot-cold")
    await connection.request(fileLoadAction("", FileLoadAction.Stop))
  const ini = `[project]\nide=${options.programType ?? "vexide"}\n[program]\nname=${options.name}\nslot=${options.slot - 1}\nicon=${options.icon ?? "USER902x.bmp"}\niconalt=\ndescription=${options.description ?? ""}`
  await uploadFile(connection, new TextEncoder().encode(ini), {
    fileName: `${base}.ini`,
    address: USER_PROGRAM_LOAD_ADDR,
    metadata: { extension: "ini" },
    onProgress: (p) => options.onProgress?.("ini", p),
  })
  if (hot)
    await uploadFile(connection, compress ? await gzip(hot) : hot, {
      fileName: `${base}.bin`,
      address:
        program.type === "hot-cold"
          ? PROS_HOT_BIN_LOAD_ADDR
          : USER_PROGRAM_LOAD_ADDR,
      metadata: { extension: "bin" },
      linkedFile:
        program.type === "hot-cold"
          ? { fileName: libraryName!, vendor: FileVendor.Pros }
          : undefined,
      afterUpload,
      onProgress: (p) => options.onProgress?.("bin", p),
    })
}
