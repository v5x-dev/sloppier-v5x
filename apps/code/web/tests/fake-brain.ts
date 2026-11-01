// Web Serial fixture implementing the V5 commands used by the editor.
import { concat, crc16, crc32, uint, varU16 } from "@v5x/serial"

type File = {
  data: Uint8Array
  crc: number
  address: number
  metadata: Uint8Array
  linked: number
}
type Transfer = File & { name: string; vendor: number; write: boolean }
const stringAt = (data: Uint8Array, offset: number) =>
  new TextDecoder().decode(data.subarray(offset)).split("\0")[0]
const numberAt = (data: Uint8Array, offset: number, length: 2 | 4) =>
  length === 2
    ? new DataView(data.buffer, data.byteOffset).getUint16(offset, true)
    : new DataView(data.buffer, data.byteOffset).getUint32(offset, true)
export class FakeBrain {
  readonly files = new Map<string, File>()
  readonly values = new Map<string, string>([["teamnumber", "1234"]])
  private transfer?: Transfer
  private controller?: ReadableStreamDefaultController<Uint8Array>
  readable: ReadableStream<Uint8Array> | null = null
  writable: WritableStream<Uint8Array> | null = null
  constructor(readonly writeDelay = 25) {}
  getInfo() {
    return { usbVendorId: 0x2888, usbProductId: 0x0501 }
  }
  async open() {
    this.readable = new ReadableStream({
      start: (controller) => {
        this.controller = controller
      },
    })
    this.writable = new WritableStream({ write: (data) => this.write(data) })
  }
  async close() {
    this.controller = undefined
    this.readable = null
    this.writable = null
  }
  private key(vendor: number, name: string) {
    return `${vendor}:${name}`
  }
  private response(
    command: number,
    payload: Uint8Array = new Uint8Array(),
    ack: number | null = 0x76
  ) {
    const body = concat(
      Uint8Array.of(command),
      ack === null ? new Uint8Array() : Uint8Array.of(ack),
      payload
    )
    const frame = concat(
      Uint8Array.of(0xaa, 0x55, 0x56),
      varU16(body.length + 2),
      body
    )
    const crc = crc16(frame)
    this.controller?.enqueue(concat(frame, Uint8Array.of(crc >> 8, crc & 255)))
  }
  private async write(data: Uint8Array) {
    if (data[4] === 0xa4) {
      this.controller?.enqueue(
        Uint8Array.of(0xaa, 0x55, 0xa4, 7, 1, 0, 0, 0, 0, 0x10, 2)
      )
      return
    }
    const command = data[5],
      payload = data.subarray(data[6] & 0x80 ? 8 : 7, -2)
    let out: Uint8Array = new Uint8Array()
    switch (command) {
      case 0x2e:
        out = new TextEncoder().encode(
          (this.values.get(stringAt(payload, 0)) ?? "") + "\0"
        )
        break
      case 0x2f: {
        const key = stringAt(payload, 0)
        this.values.set(key, stringAt(payload, key.length + 1))
        break
      }
      case 0x27:
        out = Uint8Array.of(1, 0)
        break
      case 0x16:
        out = uint(
          [...this.files.keys()].filter((k) => k.startsWith(`${payload[0]}:`))
            .length,
          2
        )
        break
      case 0x17: {
        const entries = [...this.files.entries()].filter(([key]) =>
          key.startsWith("1:")
        )
        if (payload[0] >= entries.length) {
          this.response(command, out, 0xd7)
          return
        }
        const [key, file] = entries[payload[0]]
        out = concat(
          Uint8Array.of(payload[0]),
          uint(file.data.length, 4),
          uint(file.address, 4),
          uint(file.crc, 4),
          file.metadata,
          new TextEncoder().encode(key.slice(2) + "\0")
        )
        break
      }
      case 0x19: {
        const file = this.files.get(this.key(payload[0], stringAt(payload, 2)))
        out = file
          ? concat(
              Uint8Array.of(file.linked),
              uint(file.data.length, 4),
              uint(file.address, 4),
              uint(file.crc, 4),
              file.metadata
            )
          : Uint8Array.of(255)
        break
      }
      case 0x11: {
        const name = stringAt(payload, 28),
          vendor = payload[2],
          write = payload[0] === 1
        const file = this.files.get(this.key(vendor, name))
        if (!write && !file) {
          this.response(command, out, 0xd7)
          return
        }
        const size = write ? numberAt(payload, 4, 4) : file!.data.length
        this.transfer = {
          name,
          vendor,
          write,
          data: write ? new Uint8Array(size) : file!.data,
          crc: write ? numberAt(payload, 12, 4) : file!.crc,
          address: numberAt(payload, 8, 4),
          metadata: payload.slice(16, 28),
          linked: 0,
        }
        out = concat(uint(256, 2), uint(size, 4), uint(0, 4))
        break
      }
      case 0x15:
        if (this.transfer) this.transfer.linked = payload[0]
        break
      case 0x13: {
        if (!this.transfer?.write) throw new Error("No active write")
        const offset = numberAt(payload, 0, 4) - this.transfer.address
        this.transfer.data.set(
          payload.subarray(
            4,
            4 + Math.min(payload.length - 4, this.transfer.data.length - offset)
          ),
          offset
        )
        await new Promise((resolve) => setTimeout(resolve, this.writeDelay))
        break
      }
      case 0x14: {
        if (!this.transfer || this.transfer.write)
          throw new Error("No active read")
        const address = numberAt(payload, 0, 4),
          offset = address - this.transfer.address
        out = concat(
          uint(address, 4),
          this.transfer.data.slice(offset, offset + numberAt(payload, 4, 2))
        )
        this.response(command, out, null)
        return
      }
      case 0x12: {
        if (this.transfer?.write) {
          const {
            vendor,
            name,
            data: fileData,
            address,
            metadata,
            linked,
          } = this.transfer
          this.files.set(this.key(vendor, name), {
            data: fileData,
            crc: crc32(fileData),
            address,
            metadata,
            linked,
          })
        }
        this.transfer = undefined
        break
      }
      case 0x18:
        break
      default:
        throw new Error(
          `Fake Brain: unsupported command 0x${command.toString(16)}`
        )
    }
    this.response(command, out)
  }
}
/** Install only from a test or an explicitly initiated local demo session. */
export function installFakeBrain(writeDelay = 25) {
  const brain = new FakeBrain(writeDelay)
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: { requestPort: async () => brain, getPorts: async () => [brain] },
  })
  return brain
}
