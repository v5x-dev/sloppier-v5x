/** Wire protocol ported from vexide/vex-v5-serial, MIT licensed. */
export class ProtocolError extends Error {
  override name = "ProtocolError"
}
export class NackError extends ProtocolError {
  override name = "NackError"
  constructor(public readonly ack: number) {
    super(
      `Device rejected command with NACK 0x${ack.toString(16).padStart(2, "0")}`
    )
  }
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}
export function uint(value: number, bytes: 1 | 2 | 4): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(value) || value < 0 || value > 2 ** (bytes * 8) - 1)
    throw new RangeError(`Value ${value} does not fit in u${bytes * 8}`)
  const data = new Uint8Array(bytes)
  const view = new DataView(data.buffer)
  if (bytes === 1) view.setUint8(0, value)
  else if (bytes === 2) view.setUint16(0, value, true)
  else view.setUint32(0, value, true)
  return data
}
export function readUint(
  data: Uint8Array,
  offset: number,
  bytes: 1 | 2 | 4
): number {
  if (offset < 0 || offset + bytes > data.length)
    throw new ProtocolError("Truncated payload")
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return bytes === 1
    ? view.getUint8(offset)
    : bytes === 2
      ? view.getUint16(offset, true)
      : view.getUint32(offset, true)
}
/** NUL-terminated UTF-8 with a maximum byte length, not a padded field. */
export function string(
  value: string,
  capacity: number
): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(value)
  if (value.includes("\0") || encoded.length > capacity)
    throw new RangeError(
      `String must contain at most ${capacity} UTF-8 bytes and no NUL`
    )
  return concat(encoded, new Uint8Array([0]))
}
export function varU16(value: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(value) || value < 0 || value > 0x7fff)
    throw new RangeError("VarU16 must fit in 15 bits")
  return new Uint8Array(
    value < 128 ? [value] : [(value >> 8) | 0x80, value & 255]
  )
}
export function crc16(data: Uint8Array): number {
  let crc = 0
  for (const byte of data) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++)
      crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff
  }
  return crc
}
export function crc32(data: Uint8Array): number {
  let crc = 0
  for (const byte of data) {
    crc ^= byte << 24
    for (let i = 0; i < 8; i++)
      crc = (crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0)
  }
  return crc >>> 0
}

export interface Command<T = Uint8Array> {
  cmd: number
  ecmd?: number
  bytes: Uint8Array
  decode(payload: Uint8Array): T
}
const header = new Uint8Array([0xc9, 0x36, 0xb8, 0x47])
/** Omit payload entirely for simple commands that have no length field. */
export function cdc<T = Uint8Array>(
  cmd: number,
  payload?: Uint8Array,
  decode: (data: Uint8Array) => T = (data) => data as T
): Command<T> {
  return {
    cmd,
    bytes: concat(
      header,
      uint(cmd, 1),
      ...(payload === undefined ? [] : [varU16(payload.length), payload])
    ),
    decode,
  }
}
/** CDC2 command lengths count payload only. CRC16 is big endian. */
export function cdc2<T = Uint8Array>(
  ecmd: number,
  payload: Uint8Array = new Uint8Array(0),
  decode: (data: Uint8Array) => T = (data) => data as T,
  cmd = 0x56
): Command<T> {
  const frame = concat(
    header,
    uint(cmd, 1),
    uint(ecmd, 1),
    varU16(payload.length),
    payload
  )
  const crc = crc16(frame)
  return {
    cmd,
    ecmd,
    bytes: concat(frame, new Uint8Array([crc >> 8, crc & 255])),
    decode,
  }
}
export interface Reply {
  cmd: number
  ecmd?: number
  payload: Uint8Array
  ack?: number
}
export function decodeReply(frame: Uint8Array): Reply {
  if (frame[0] !== 0xaa || frame[1] !== 0x55 || frame.length < 4)
    throw new ProtocolError("Invalid reply header")
  const wide = (frame[3] & 0x80) !== 0
  if (wide && frame.length < 5) throw new ProtocolError("Truncated length")
  const start = wide ? 5 : 4
  const size = wide ? ((frame[3] & 0x7f) << 8) | frame[4] : frame[3]
  if (frame.length !== start + size)
    throw new ProtocolError("Invalid reply length")
  const cmd = frame[2]
  if (![0x56, 0x57, 0x58].includes(cmd))
    return { cmd, payload: frame.slice(start) }
  if (size < 4) throw new ProtocolError("Truncated CDC2 reply")
  const checksum = (frame[frame.length - 2] << 8) | frame[frame.length - 1]
  if (crc16(frame.subarray(0, -2)) !== checksum)
    throw new ProtocolError("Invalid reply CRC16")
  const ecmd = frame[start]
  // FILE_READ omits ACK on success; a one-byte body is a NACK.
  if (cmd === 0x56 && ecmd === 0x14) {
    const body = frame.slice(start + 1, -2)
    if (body.length === 1)
      return { cmd, ecmd, ack: body[0], payload: new Uint8Array() }
    if (body.length < 4) throw new ProtocolError("Truncated file read address")
    return { cmd, ecmd, payload: body }
  }
  return {
    cmd,
    ecmd,
    ack: frame[start + 1],
    payload: frame.slice(start + 2, -2),
  }
}

/** Reassembles fragmented and coalesced replies, dropping noise before AA 55. */
export class ReplyFramer {
  private buffer: Uint8Array = new Uint8Array()
  push(chunk: Uint8Array): Uint8Array[] {
    this.buffer = concat(this.buffer, chunk)
    const frames: Uint8Array[] = []
    while (this.buffer.length >= 2) {
      if (this.buffer[0] !== 0xaa || this.buffer[1] !== 0x55) {
        this.buffer = this.buffer.slice(1)
        continue
      }
      if (this.buffer.length < 4) break
      const wide = !!(this.buffer[3] & 0x80)
      if (wide && this.buffer.length < 5) break
      const size = wide
        ? ((this.buffer[3] & 127) << 8) | this.buffer[4]
        : this.buffer[3]
      const length = (wide ? 5 : 4) + size
      if (this.buffer.length < length) break
      frames.push(this.buffer.slice(0, length))
      this.buffer = this.buffer.slice(length)
    }
    return frames
  }
}
/** FixedString<N> occupies N + 1 bytes on the wire. */
export function fixedString(
  value: string,
  capacity: number
): Uint8Array<ArrayBuffer> {
  const encoded = string(value, capacity)
  const result = new Uint8Array(capacity + 1)
  result.set(encoded)
  return result
}
