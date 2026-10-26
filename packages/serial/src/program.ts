import type { Connection } from "./connection"
import {
  FileExitAction,
  FileVendor,
  PROS_HOT_BIN_LOAD_ADDR,
  uploadFile,
} from "./files"

export type ProgramData =
  | { type: "monolith"; data: Uint8Array }
  | { type: "hot-cold"; hot?: Uint8Array; cold?: Uint8Array }
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
  if (program.type === "hot-cold" && !program.hot && !program.cold)
    throw new Error("Supply a hot or cold binary")
  const base = `slot_${options.slot}`
  const ini = `[project]\nide=${options.programType ?? "vexide"}\n[program]\nname=${options.name}\nslot=${options.slot - 1}\nicon=${options.icon ?? "USER902x.bmp"}\niconalt=\ndescription=${options.description ?? ""}`
  await uploadFile(connection, new TextEncoder().encode(ini), {
    fileName: `${base}.ini`,
    metadata: { extension: "ini" },
    onProgress: (p) => options.onProgress?.("ini", p),
  })
  const hot = program.type === "monolith" ? program.data : program.hot
  const cold = program.type === "hot-cold" ? program.cold : undefined
  const afterUpload = options.afterUpload ?? FileExitAction.DoNothing
  if (cold)
    await uploadFile(connection, options.compress ? await gzip(cold) : cold, {
      fileName: `${base}_lib.bin`,
      metadata: { extension: "bin" },
      address: PROS_HOT_BIN_LOAD_ADDR,
      afterUpload: hot ? FileExitAction.DoNothing : afterUpload,
      onProgress: (p) => options.onProgress?.("lib", p),
    })
  if (hot)
    await uploadFile(connection, options.compress ? await gzip(hot) : hot, {
      fileName: `${base}.bin`,
      metadata: { extension: "bin" },
      linkedFile:
        program.type === "hot-cold"
          ? { fileName: `${base}_lib.bin`, vendor: FileVendor.User }
          : undefined,
      afterUpload,
      onProgress: (p) => options.onProgress?.("bin", p),
    })
}
