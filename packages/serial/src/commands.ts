import type { Connection } from "./connection"
import {
  cdc,
  cdc2,
  concat,
  readUint,
  string,
  uint,
  ProtocolError,
} from "./protocol"

export interface Version {
  major: number
  minor: number
  build: number
  beta: number
}
export function decodeVersion(data: Uint8Array, offset = 0): Version {
  return {
    major: readUint(data, offset, 1),
    minor: readUint(data, offset + 1, 1),
    build: readUint(data, offset + 2, 1),
    beta: readUint(data, offset + 3, 1),
  }
}
export const systemVersion = () =>
  cdc(0xa4, undefined, (data) => ({
    version: decodeVersion(data),
    productType: readUint(data, 5, 1),
    flags: readUint(data, 6, 1),
  }))
export const systemAlive = () =>
  cdc(0x21, undefined, (data) => ({
    version1: readUint(data, 0, 4),
    version2: readUint(data, 4, 4),
    bootSource: readUint(data, 8, 1),
    count: readUint(data, 9, 1),
  }))
export const systemFlags = () =>
  cdc2(0x20, new Uint8Array(), (data) => ({
    flags: readUint(data, 0, 4),
    byte1: readUint(data, 4, 1),
    byte2: readUint(data, 5, 1),
    currentProgram: readUint(data, 6, 1),
  }))
export const systemStatus = () =>
  cdc2(0x22, new Uint8Array(), (data) => {
    const version = decodeVersion(data, 1)
    return {
      reserved: readUint(data, 0, 1),
      systemVersion: Object.values(version).every((value) => value === 0)
        ? null
        : version,
      cpu0Version: decodeVersion(data, 5),
      cpu1Version: decodeVersion(data, 9),
      touchVersion: decodeVersion(data.slice(13, 17).reverse()),
      details:
        data.length < 33
          ? null
          : {
              ssn: readUint(data, 17, 4),
              bootFlags: readUint(data, 21, 4),
              systemFlags: readUint(data, 25, 4),
              goldenVersion: decodeVersion(data, 29),
              nxpVersion: data.length >= 37 ? decodeVersion(data, 33) : null,
            },
    }
  })
export const deviceStatus = () => cdc2(0x21)
export const screenCapture = (layer?: number) =>
  cdc2(0x28, layer === undefined ? new Uint8Array() : uint(layer, 1))
export const dashTouch = (x: number, y: number, pressed: boolean) =>
  cdc2(0x2a, concat(uint(x, 2), uint(y, 2), uint(Number(pressed), 2)))
export const keyValueLoad = (key: string) => cdc2(0x2e, string(key, 31))
export const keyValueSave = (key: string, value: string) =>
  cdc2(0x2f, concat(string(key, 31), string(value, 255)))

export function userData(channel = 1, write?: Uint8Array) {
  if (write && (write.length > 224 || write.includes(0)))
    throw new RangeError(
      "CDC stdio writes require at most 224 bytes without NUL"
    )
  return cdc2(
    0x27,
    concat(
      uint(channel, 1),
      uint(write ? 225 : 0, 1),
      ...(write ? [concat(write, new Uint8Array(225 - write.length))] : [])
    ),
    (data) => {
      if (!data.length) throw new ProtocolError("Missing stdio channel")
      const end = data.indexOf(0, 1)
      return {
        channel: data[0],
        data: data.slice(1, end < 0 ? undefined : end),
      }
    }
  )
}
/** Read a single FIFO response when no separate serial user port is open. */
export async function readUser(connection: Connection): Promise<Uint8Array> {
  return (await connection.request(userData(), { timeout: 100, retries: 1 }))
    .data
}
export async function writeUser(
  connection: Connection,
  data: Uint8Array
): Promise<void> {
  if (connection.transport.writeUser) return connection.writeUser(data)
  if (data.includes(0))
    throw new RangeError(
      "CDC stdio does not support NUL bytes; select a separate user port for binary stdio"
    )
  for (let offset = 0; offset < data.length; offset += 224)
    await connection.request(userData(2, data.subarray(offset, offset + 224)), {
      timeout: 100,
      retries: 1,
    })
}
export async function mockTouch(
  connection: Connection,
  x: number,
  y: number,
  pressed: boolean
) {
  await connection.request(dashTouch(x, y, pressed), { timeout: 100 })
}
export async function mockTap(connection: Connection, x: number, y: number) {
  await mockTouch(connection, x, y, true)
  await mockTouch(connection, x, y, false)
}

/** VEXos recorded event log. Field meanings remain undocumented upstream. */
export interface BrainLogEntry {
  code: number
  type: number
  description: number
  spare: number
  time: number
}
export const logStatus = () =>
  cdc2(0x24, new Uint8Array(), (data) => ({
    count: readUint(data, 1, 4),
  }))
export function logRead(offset: number, count: number) {
  for (const value of [offset, count])
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
      throw new RangeError(
        "Log offset and count must be unsigned 32-bit integers"
      )
  return cdc2(0x25, concat(uint(offset, 4), uint(count, 4)), (data) => {
    const size = readUint(data, 0, 1)
    const returnedOffset = readUint(data, 1, 4)
    const length = readUint(data, 5, 2)
    if (size !== 8 || data.length !== 7 + length * size)
      throw new ProtocolError("Invalid brain log entry size or payload length")
    const entries: BrainLogEntry[] = []
    for (let index = 0; index < length; index++) {
      const start = 7 + index * size
      entries.push({
        code: data[start],
        type: data[start + 1],
        description: data[start + 2],
        spare: data[start + 3],
        time: readUint(data, start + 4, 4),
      })
    }
    return { offset: returnedOffset, entries }
  })
}
