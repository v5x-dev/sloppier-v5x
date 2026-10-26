import type { Connection } from "./connection"
import {
  cdc2,
  concat,
  crc32,
  fixedString,
  readUint,
  uint,
  ProtocolError,
} from "./protocol"
import { decodeVersion, screenCapture, type Version } from "./commands"

export enum FileTransferOperation {
  Write = 1,
  Read = 2,
}
export enum FileTransferOptions {
  None = 0,
  Overwrite = 1,
  EraseAll = 0x80,
}
export enum FileTransferTarget {
  Ddr = 0,
  Qspi = 1,
  Cbuf = 2,
  Vbuf = 3,
  Ddrc = 4,
  Ddre = 5,
  Flash = 6,
  Radio = 7,
  A1 = 13,
  B1 = 14,
  B2 = 15,
}
export enum FileVendor {
  User = 1,
  VexAirFirmware = 2,
  VexAirVm = 3,
  VexAirMissions = 4,
  Sys = 0x0f,
  Dev1 = 0x10,
  Dev2 = 0x18,
  Pros = 0x18,
  Dev3 = 0x20,
  Dev4 = 0x28,
  Dev5 = 0x30,
  Dev6 = 0x38,
  VexVm = 0x40,
  AimImage = 0x80,
  AimSound = 0x88,
  Vex = 0xf0,
  Undefined = 0xf1,
  AimRadio = 0xfc,
}
export enum ExtensionType {
  Binary = 0,
  Vm = 0x61,
  EncryptedBinary = 0x73,
  Zipped = 0x7a,
}
export enum FileExitAction {
  DoNothing = 0,
  RunProgram = 1,
  Halt = 2,
  ShowRunScreen = 3,
}
export enum FileLoadAction {
  Run = 0,
  Stop = 128,
}
export const J2000_EPOCH = 946684800
export const PROS_HOT_BIN_LOAD_ADDR = 0x07800000
export const USER_PROGRAM_LOAD_ADDR = 0x03800000
export const j2000Timestamp = () => Math.floor(Date.now() / 1000) - J2000_EPOCH
export interface FileMetadata {
  extension: string
  extensionType?: ExtensionType
  timestamp?: number
  version?: Version
}
export function encodeMetadata(metadata: FileMetadata): Uint8Array {
  const extension = new TextEncoder().encode(metadata.extension)
  if (extension.length > 3 || metadata.extension.includes("\0"))
    throw new RangeError("Extension must fit in three bytes")
  const result = new Uint8Array(12)
  result.set(extension)
  result[3] = metadata.extensionType ?? ExtensionType.Binary
  const timestamp = metadata.timestamp ?? j2000Timestamp()
  if (
    !Number.isInteger(timestamp) ||
    timestamp < -0x80000000 ||
    timestamp > 0x7fffffff
  )
    throw new RangeError("Timestamp must fit in i32")
  new DataView(result.buffer).setInt32(4, timestamp, true)
  const version = metadata.version ?? { major: 1, minor: 0, build: 0, beta: 0 }
  result.set(
    concat(
      uint(version.major, 1),
      uint(version.minor, 1),
      uint(version.build, 1),
      uint(version.beta, 1)
    ),
    8
  )
  return result
}
export function decodeMetadata(data: Uint8Array, offset = 0): FileMetadata {
  readUint(data, offset + 8, 4)
  return {
    extension: new TextDecoder()
      .decode(data.subarray(offset, offset + 3))
      .replace(/\0+$/, ""),
    extensionType: data[offset + 3],
    timestamp: new DataView(data.buffer, data.byteOffset).getInt32(
      offset + 4,
      true
    ),
    version: decodeVersion(data, offset + 8),
  }
}
export interface TransferInitialize {
  operation: FileTransferOperation
  target: FileTransferTarget
  vendor: FileVendor
  options: FileTransferOptions
  fileSize: number
  loadAddress: number
  crc: number
  metadata: FileMetadata
  fileName: string
}
export const fileTransferInitialize = (options: TransferInitialize) =>
  cdc2(
    0x11,
    concat(
      uint(options.operation, 1),
      uint(options.target, 1),
      uint(options.vendor, 1),
      uint(options.options, 1),
      uint(options.fileSize, 4),
      uint(options.loadAddress, 4),
      uint(options.crc, 4),
      encodeMetadata(options.metadata),
      fixedString(options.fileName, 23)
    ),
    (data) => {
      readUint(data, 6, 4)
      return {
        windowSize: readUint(data, 0, 2),
        fileSize: readUint(data, 2, 4),
        crc: new DataView(data.buffer, data.byteOffset).getUint32(6, false),
      }
    }
  )
export const fileTransferExit = (action = FileExitAction.DoNothing) =>
  cdc2(0x12, uint(action, 1))
export function fileDataWrite(address: number, data: Uint8Array) {
  if (data.length % 4)
    throw new RangeError("File writes must be four-byte aligned")
  return cdc2(0x13, concat(uint(address, 4), data))
}
export const fileDataRead = (address: number, size: number) =>
  cdc2(0x14, concat(uint(address, 4), uint(size, 2)), (data) => ({
    address: readUint(data, 0, 4),
    data: data.slice(4),
  }))
export const fileLink = (fileName: string, vendor = FileVendor.User) =>
  cdc2(0x15, concat(uint(vendor, 1), uint(0, 1), fixedString(fileName, 23)))
export const directoryFileCount = (vendor = FileVendor.User) =>
  cdc2(0x16, concat(uint(vendor, 1), uint(0, 1)), (data) =>
    readUint(data, 0, 2)
  )
export const directoryEntry = (index: number) =>
  cdc2(0x17, concat(uint(index, 1), uint(0, 1)), (data) => {
    readUint(data, 25, 1)
    return {
      index: data[0],
      size: readUint(data, 1, 4),
      loadAddress: readUint(data, 5, 4),
      crc: readUint(data, 9, 4),
      metadata: data[13] === 255 ? null : decodeMetadata(data, 13),
      fileName: new TextDecoder().decode(data.subarray(25)).split("\0")[0],
    }
  })
export const fileLoadAction = (
  fileName: string,
  action = FileLoadAction.Run,
  vendor = FileVendor.User
) =>
  cdc2(
    0x18,
    concat(uint(vendor, 1), uint(action, 1), fixedString(fileName, 23))
  )
export const fileMetadata = (fileName: string, vendor = FileVendor.User) =>
  cdc2(
    0x19,
    concat(uint(vendor, 1), uint(0, 1), fixedString(fileName, 23)),
    (data) => {
      const linkedVendor = readUint(data, 0, 1)
      if (linkedVendor === 255) return null
      const size = readUint(data, 1, 4)
      if (size === 0xffffffff) return null
      return {
        linkedVendor: linkedVendor || null,
        size,
        loadAddress: readUint(data, 5, 4),
        crc: readUint(data, 9, 4),
        metadata: decodeMetadata(data, 13),
      }
    }
  )
export const fileMetadataSet = (
  fileName: string,
  metadata: FileMetadata,
  loadAddress: number,
  vendor = FileVendor.User,
  options = 0
) =>
  cdc2(
    0x1a,
    concat(
      uint(vendor, 1),
      uint(options, 1),
      uint(loadAddress, 4),
      encodeMetadata(metadata),
      fixedString(fileName, 23)
    )
  )
export const fileErase = (fileName: string, vendor = FileVendor.User) =>
  cdc2(0x1b, concat(uint(vendor, 1), uint(0, 1), fixedString(fileName, 23)))
export const fileCleanUp = () => cdc2(0x1e)
export const radioChannel = (channel: "pit" | "download") =>
  cdc2(0x10, new Uint8Array([1, channel === "download" ? 1 : 0]))

export function maxChunkSize(
  connection: Connection,
  windowSize: number
): number {
  let size =
    connection.type === "bluetooth"
      ? Math.min(244, Math.floor(windowSize / 2)) - 14
      : Math.min(windowSize || 4096, 4096)
  size -= size % 4
  if (size < 4) throw new ProtocolError("Device transfer window is too small")
  return size
}
export interface FileOptions {
  fileName: string
  vendor?: FileVendor
  target?: FileTransferTarget
  address?: number
  onProgress?: (percent: number) => void
}
export interface UploadFileOptions extends FileOptions {
  metadata?: FileMetadata
  linkedFile?: { fileName: string; vendor?: FileVendor }
  afterUpload?: FileExitAction
}
/** Do not interleave other file operations while a transfer is in progress. */
export async function uploadFile(
  connection: Connection,
  data: Uint8Array,
  options: UploadFileOptions
): Promise<void> {
  const address = options.address ?? 0
  const requestOptions =
    connection.type === "controller" ? { timeout: 2000 } : {}
  const initialized = await connection.request(
    fileTransferInitialize({
      operation: FileTransferOperation.Write,
      target: options.target ?? FileTransferTarget.Qspi,
      vendor: options.vendor ?? FileVendor.User,
      options: FileTransferOptions.Overwrite,
      fileSize: data.length,
      loadAddress: address,
      crc: crc32(data),
      metadata: options.metadata ?? {
        extension: options.fileName.split(".").pop() ?? "bin",
      },
      fileName: options.fileName,
    }),
    requestOptions
  )
  if (options.linkedFile)
    await connection.request(
      fileLink(options.linkedFile.fileName, options.linkedFile.vendor),
      requestOptions
    )
  const chunkSize = maxChunkSize(connection, initialized.windowSize)
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const chunk = data.subarray(offset, offset + chunkSize)
    const padded = new Uint8Array(Math.ceil(chunk.length / 4) * 4)
    padded.set(chunk)
    const command = fileDataWrite(address + offset, padded)
    if (connection.type === "bluetooth") await connection.send(command)
    else await connection.request(command, requestOptions)
    options.onProgress?.(
      Math.min(100, ((offset + chunk.length) / data.length) * 100)
    )
  }
  await connection.request(fileTransferExit(options.afterUpload), {
    timeout: connection.type === "controller" ? 2000 : 1000,
  })
  if (!data.length) options.onProgress?.(100)
}
export async function downloadFile(
  connection: Connection,
  options: FileOptions & { size: number }
): Promise<Uint8Array> {
  const address = options.address ?? 0
  const initialized = await connection.request(
    fileTransferInitialize({
      operation: FileTransferOperation.Read,
      target: options.target ?? FileTransferTarget.Qspi,
      vendor: options.vendor ?? FileVendor.User,
      options: FileTransferOptions.None,
      fileSize: options.size,
      loadAddress: address,
      crc: 0,
      metadata: {
        extension: "ini",
        extensionType: ExtensionType.EncryptedBinary,
        timestamp: 0,
      },
      fileName: options.fileName,
    })
  )
  const result = new Uint8Array(initialized.fileSize)
  const size = maxChunkSize(connection, initialized.windowSize)
  let offset = 0
  while (offset < result.length) {
    const reply = await connection.request(fileDataRead(address + offset, size))
    if (reply.address !== address + offset || !reply.data.length)
      throw new ProtocolError("Invalid file read address or empty chunk")
    const chunk = reply.data.subarray(0, result.length - offset)
    result.set(chunk, offset)
    offset += chunk.length
    options.onProgress?.((offset / result.length) * 100)
  }
  if (!result.length) options.onProgress?.(100)
  return result
}
export async function captureScreen(
  connection: Connection
): Promise<{ width: 480; height: 272; data: Uint8ClampedArray }> {
  await connection.request(screenCapture(), { timeout: 100 })
  const raw = await downloadFile(connection, {
    fileName: "screen",
    size: 512 * 272 * 4,
    vendor: FileVendor.Sys,
    target: FileTransferTarget.Cbuf,
  })
  if (raw.length !== 512 * 272 * 4)
    throw new ProtocolError("Unexpected screen buffer size")
  const data = new Uint8ClampedArray(480 * 272 * 4)
  for (let y = 0; y < 272; y++)
    for (let x = 0; x < 480; x++) {
      const src = (y * 512 + x) * 4,
        dst = (y * 480 + x) * 4
      data.set([raw[src + 2], raw[src + 1], raw[src], 255], dst)
    }
  return { width: 480, height: 272, data }
}
export const fileFormat = () =>
  cdc2(0x1f, new Uint8Array([0x44, 0x43, 0x42, 0x41]))
export const programStatus = (fileName: string, vendor = FileVendor.User) =>
  cdc2(
    0x1c,
    concat(uint(vendor, 1), uint(0, 1), fixedString(fileName, 23)),
    (data) => ({
      slot: readUint(data, 0, 1),
      requestedSlot: readUint(data, 1, 1),
    })
  )
