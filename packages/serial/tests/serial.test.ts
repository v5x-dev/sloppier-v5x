import { describe, expect, it } from "vitest"
import {
  Connection,
  NackError,
  ProtocolError,
  ReplyFramer,
  TimeoutError,
  cdc2,
  concat,
  crc16,
  crc32,
  decodeReply,
  fixedString,
  varU16,
  systemVersion,
  userData,
  fileTransferInitialize,
  FileTransferOperation,
  FileTransferOptions,
  FileTransferTarget,
  FileVendor,
  uploadFile,
  downloadFile,
  openSerial,
  openBluetooth,
  CHARACTERISTIC_PAIRING,
  CHARACTERISTIC_SYSTEM_RX,
  CHARACTERISTIC_SYSTEM_TX,
  CHARACTERISTIC_USER_TX,
  type Transport,
  type SerialPortLike,
  type CharacteristicLike,
  type BluetoothDeviceLike,
} from "../src"

function reply(
  payload: number[] = [],
  ecmd = 0x20,
  ack: number | null = 0x76
): Uint8Array {
  const body = new Uint8Array([
    ecmd,
    ...(ack === null ? [] : [ack]),
    ...payload,
  ])
  const frame = concat(
    new Uint8Array([0xaa, 0x55, 0x56]),
    varU16(body.length + 2),
    body
  )
  const crc = crc16(frame)
  return concat(frame, new Uint8Array([crc >> 8, crc & 255]))
}
class FakeTransport implements Transport {
  type: Transport["type"] = "wired"
  writes: Uint8Array[] = []
  system!: (data: Uint8Array) => void
  disconnect!: (error: Error) => void
  respond?: (data: Uint8Array) => void
  async start(
    system: (data: Uint8Array) => void,
    _user: (data: Uint8Array) => void,
    disconnected: (error: Error) => void
  ) {
    this.system = system
    this.disconnect = disconnected
  }
  async writeSystem(data: Uint8Array) {
    this.writes.push(data)
    this.respond?.(data)
  }
  async close() {}
}

describe("connection lifecycle", () => {
  it("notifies disconnection once and removes listeners", async () => {
    const transport = new FakeTransport()
    const connection = await Connection.open(transport)
    const failures: Error[] = []
    const removed: Error[] = []
    connection.onDisconnect((error) => failures.push(error))
    const unsubscribe = connection.onDisconnect((error) => removed.push(error))
    unsubscribe()
    const failure = new Error("Cable removed")
    transport.disconnect(failure)
    await connection.close()
    expect(failures).toEqual([failure])
    expect(removed).toEqual([])
    await expect(connection.request(systemVersion())).rejects.toThrow(
      "Cable removed"
    )
  })
})

describe("wire compatibility", () => {
  it("matches independent CRC check vectors", () => {
    const data = new TextEncoder().encode("123456789")
    expect(crc16(data)).toBe(0x31c3)
    expect(crc32(data)).toBe(0x89a1897f)
  })
  it("encodes upstream VarU16 boundaries and fixed strings", () => {
    expect([...varU16(127)]).toEqual([127])
    expect([...varU16(128)]).toEqual([0x80, 0x80])
    expect([...varU16(0xf00)]).toEqual([0x8f, 0])
    expect([...varU16(32767)]).toEqual([255, 255])
    expect(() => varU16(32768)).toThrow(RangeError)
    expect([...fixedString("a", 3)]).toEqual([97, 0, 0, 0])
    expect(() => fixedString("éé", 3)).toThrow(RangeError)
  })
  it("encodes simple commands without a length and CDC2 with payload-only length", () => {
    expect([...systemVersion().bytes]).toEqual([0xc9, 0x36, 0xb8, 0x47, 0xa4])
    const bytes = cdc2(0x20).bytes
    expect([...bytes.slice(0, 7)]).toEqual([
      0xc9, 0x36, 0xb8, 0x47, 0x56, 0x20, 0,
    ])
    expect(crc16(bytes)).toBe(0)
    const wide = cdc2(0x13, new Uint8Array(128)).bytes
    expect([...wide.slice(6, 8)]).toEqual([0x80, 0x80])
  })
  it("pads file names and FIFO writes to upstream field capacities", () => {
    const command = fileTransferInitialize({
      operation: FileTransferOperation.Write,
      target: FileTransferTarget.Qspi,
      vendor: FileVendor.User,
      options: FileTransferOptions.Overwrite,
      fileSize: 3,
      loadAddress: 0,
      crc: 0,
      metadata: { extension: "bin", timestamp: 0 },
      fileName: "a.bin",
    })
    expect(command.bytes[6]).toBe(52)
    expect([...command.bytes.slice(7, 15)]).toEqual([1, 1, 1, 1, 3, 0, 0, 0])
    expect(command.bytes.length).toBe(61)
    const fifo = userData(2, new Uint8Array([65])).bytes
    expect([...fifo.slice(6, 11)]).toEqual([0x80, 227, 2, 225, 65])
  })
  it("reassembles noise, split headers, wide lengths and multiple replies", () => {
    const framer = new ReplyFramer()
    const a = reply(),
      b = reply(new Array(200).fill(3))
    expect(framer.push(new Uint8Array([0, 99, 0xaa]))).toEqual([])
    expect(framer.push(a.slice(1, 3))).toEqual([])
    expect(framer.push(concat(a.slice(3), b.slice(0, 4)))).toEqual([a])
    expect(framer.push(b.slice(4))).toEqual([b])
  })
  it("validates CRC, bounds, NACK and ACK-free file reads", () => {
    const valid = reply([9])
    expect(decodeReply(valid).payload).toEqual(new Uint8Array([9]))
    valid[6] ^= 1
    expect(() => decodeReply(valid)).toThrow(ProtocolError)
    expect(() => decodeReply(reply().slice(0, -1))).toThrow(ProtocolError)
    expect(decodeReply(reply([0, 0, 0, 0, 7, 8], 0x14, null)).payload).toEqual(
      new Uint8Array([0, 0, 0, 0, 7, 8])
    )
    expect(decodeReply(reply([], 0x14, 0xd7)).ack).toBe(0xd7)
  })
})

describe("connection and file operations", () => {
  it("matches command IDs and serializes concurrent handshakes", async () => {
    const transport = new FakeTransport()
    const connection = await Connection.open(transport)
    transport.respond = (data) => {
      transport.system(reply([99], 0x22))
      transport.system(reply([data[5]], data[5]))
    }
    const values = await Promise.all([
      connection.request(cdc2(0x20)),
      connection.request(cdc2(0x21)),
    ])
    expect(values.map((v) => [...v])).toEqual([[0x20], [0x21]])
    await connection.close()
  })
  it("retries timeouts, propagates NACKs and rejects on disconnect", async () => {
    const transport = new FakeTransport(),
      connection = await Connection.open(transport)
    await expect(
      connection.request(cdc2(0x20), { timeout: 5, retries: 1 })
    ).rejects.toBeInstanceOf(TimeoutError)
    expect(transport.writes.length).toBe(2)
    transport.respond = () => transport.system(reply([], 0x20, 0xce))
    await expect(connection.request(cdc2(0x20))).rejects.toBeInstanceOf(
      NackError
    )
    expect(transport.writes.length).toBe(3)
    transport.respond = () => transport.disconnect(new Error("unplugged"))
    await expect(connection.request(cdc2(0x20))).rejects.toThrow("unplugged")
    await expect(connection.request(cdc2(0x20))).rejects.toThrow("unplugged")
    await connection.close()
  })
  it("uploads with CRC of unpadded bytes and four-byte padding", async () => {
    const transport = new FakeTransport(),
      connection = await Connection.open(transport)
    transport.respond = (data) =>
      transport.system(
        reply(data[5] === 0x11 ? [8, 0, 0, 0, 48, 0, 0, 0, 0, 0] : [], data[5])
      )
    const progress: number[] = []
    const source = new Uint8Array([1, 2, 3, 4, 5])
    await uploadFile(connection, source, {
      fileName: "a.bin",
      metadata: { extension: "bin", timestamp: 0 },
      onProgress: (p) => progress.push(p),
    })
    expect(transport.writes.map((d) => d[5])).toEqual([0x11, 0x13, 0x12])
    expect([...transport.writes[1].slice(11, -2)]).toEqual([
      1, 2, 3, 4, 5, 0, 0, 0,
    ])
    expect(new DataView(transport.writes[0].buffer).getUint32(19, true)).toBe(
      crc32(source)
    )
    expect(progress).toEqual([100])
    await connection.close()
  })
  it("does not wait for BLE write ACKs and keeps packets within 244 bytes", async () => {
    const transport = new FakeTransport()
    transport.type = "bluetooth"
    const connection = await Connection.open(transport)
    transport.respond = (data) => {
      if (data[5] !== 0x13)
        transport.system(
          reply(
            data[5] === 0x11 ? [0, 16, 0, 0, 48, 0, 0, 0, 0, 0] : [],
            data[5]
          )
        )
    }
    await uploadFile(connection, new Uint8Array(500), { fileName: "a.bin" })
    expect(transport.writes.filter((d) => d[5] === 0x13)).toHaveLength(3)
    expect(transport.writes.every((d) => d.length <= 244)).toBe(true)
    await connection.close()
  })
  it("downloads ACK-free chunks and removes flash data past EOF", async () => {
    const transport = new FakeTransport(),
      connection = await Connection.open(transport)
    transport.respond = (data) =>
      transport.system(
        data[5] === 0x11
          ? reply([8, 0, 3, 0, 0, 0, 0, 0, 0, 0], 0x11)
          : reply([0, 0, 0, 0, 4, 5, 6, 99], 0x14, null)
      )
    expect(
      await downloadFile(connection, { fileName: "a.bin", size: 3 })
    ).toEqual(new Uint8Array([4, 5, 6]))
    await connection.close()
  })
})

class FakePort implements SerialPortLike {
  controller!: ReadableStreamDefaultController<Uint8Array>
  readable = new ReadableStream<Uint8Array>({
    start: (controller) => {
      this.controller = controller
    },
  })
  writes: Uint8Array[] = []
  writable = new WritableStream<Uint8Array>({
    write: (data) => {
      this.writes.push(data)
      this.controller.enqueue(
        new Uint8Array([0xaa, 0x55, 0xa4, 7, 1, 2, 3, 4, 0, 0x10, 6])
      )
    },
  })
  opened = false
  closed = false
  getInfo() {
    return { usbVendorId: 0x2888, usbProductId: 0x501 }
  }
  async open() {
    this.opened = true
  }
  async close() {
    this.closed = true
  }
}
class FakeCharacteristic extends EventTarget implements CharacteristicLike {
  value = new DataView(new Uint8Array([1, 2, 3, 4]).buffer)
  writes: Uint8Array[] = []
  subscribed = false
  async readValue() {
    return this.value
  }
  async writeValueWithoutResponse(data: Uint8Array<ArrayBuffer>) {
    this.writes.push(data)
    this.value = new DataView(data.buffer)
  }
  async startNotifications() {
    this.subscribed = true
  }
  async stopNotifications() {
    this.subscribed = false
  }
  emit(data: Uint8Array) {
    this.value = new DataView(new Uint8Array(data).buffer)
    this.dispatchEvent(new Event("characteristicvaluechanged"))
  }
}

describe("browser transports", () => {
  it("opens Web Serial streams and releases their locks on close", async () => {
    const port = new FakePort(),
      connection = await openSerial(port)
    expect(await connection.request(systemVersion())).toEqual({
      version: { major: 1, minor: 2, build: 3, beta: 4 },
      productType: 0x10,
      flags: 6,
    })
    expect(port.opened).toBe(true)
    await connection.close()
    expect(port.closed).toBe(true)
    expect(port.readable.locked).toBe(false)
    expect(port.writable.locked).toBe(false)
  })
  it("cleans up already-opened serial ports when opening the user port fails", async () => {
    const port = new FakePort(),
      userPort = new FakePort()
    userPort.open = async () => {
      throw new Error("busy")
    }
    await expect(openSerial(port, { userPort })).rejects.toThrow("busy")
    expect(port.closed).toBe(true)
    expect(port.readable.locked).toBe(false)
  })
  it("uses V5 BLE characteristics for pairing, notifications and writes", async () => {
    const characteristics = new Map<string, FakeCharacteristic>()
    const get = (uuid: string) => {
      if (!characteristics.has(uuid))
        characteristics.set(uuid, new FakeCharacteristic())
      return characteristics.get(uuid)!
    }
    let disconnected = false
    const device: BluetoothDeviceLike = Object.assign(new EventTarget(), {
      id: "brain",
      gatt: {
        connected: false,
        connect: async () => ({
          getPrimaryService: async () => ({
            getCharacteristic: async (uuid: string) => get(uuid),
          }),
        }),
        disconnect: () => {
          disconnected = true
        },
      },
    })
    const bluetooth = await openBluetooth(device)
    get(CHARACTERISTIC_PAIRING).value = new DataView(
      new Uint8Array([0xde, 0xad, 0xfa, 0xce]).buffer
    )
    expect(await bluetooth.isPaired()).toBe(false)
    await expect(bluetooth.connection.send(cdc2(0x20))).rejects.toThrow(
      "pairing"
    )
    await bluetooth.requestPairing()
    expect([...get(CHARACTERISTIC_PAIRING).writes[0]]).toEqual([
      255, 255, 255, 255,
    ])
    await bluetooth.authenticatePairing(new Uint8Array([1, 2, 3, 4]))
    expect(await bluetooth.isPaired()).toBe(true)
    await bluetooth.connection.send(cdc2(0x20))
    expect(get(CHARACTERISTIC_SYSTEM_RX).writes).toHaveLength(1)
    const received: Uint8Array[] = []
    bluetooth.connection.onUserData((data) => received.push(data))
    get(CHARACTERISTIC_USER_TX).emit(new Uint8Array([7, 8]))
    expect(received).toEqual([new Uint8Array([7, 8])])
    expect(get(CHARACTERISTIC_SYSTEM_TX).subscribed).toBe(true)
    await bluetooth.connection.close()
    expect(disconnected).toBe(true)
    expect(get(CHARACTERISTIC_SYSTEM_TX).subscribed).toBe(false)
  })
})

describe("program uploads", () => {
  it("uploads ini, cold library, link, and hot binary in order with gzip", async () => {
    const { uploadProgram, FileExitAction } = await import("../src")
    const transport = new FakeTransport(),
      connection = await Connection.open(transport)
    transport.respond = (data) =>
      transport.system(
        reply(data[5] === 0x11 ? [0, 16, 0, 0, 48, 0, 0, 0, 0, 0] : [], data[5])
      )
    const hot = new Uint8Array([1, 2, 3]),
      cold = new Uint8Array([8, 9])
    await uploadProgram(
      connection,
      { type: "hot-cold", hot, cold },
      {
        slot: 2,
        name: "Robot",
        compress: true,
        afterUpload: FileExitAction.RunProgram,
      }
    )
    const init = transport.writes.filter((data) => data[5] === 0x11)
    const names = init.map(
      (data) => new TextDecoder().decode(data.slice(35, 59)).split("\0")[0]
    )
    expect(names).toEqual(["slot_2.ini", "slot_2_lib.bin", "slot_2.bin"])
    expect(transport.writes.map((data) => data[5])).toEqual([
      0x11, 0x13, 0x12, 0x11, 0x13, 0x12, 0x11, 0x15, 0x13, 0x12,
    ])
    expect(
      transport.writes.filter((data) => data[5] === 0x12).map((data) => data[7])
    ).toEqual([0, 0, 1])
    const chunks = transport.writes.filter((data) => data[5] === 0x13)
    const ini = new TextDecoder().decode(chunks[0].slice(11, -2))
    expect(ini).toContain("slot=1")
    expect(ini).toContain("name=Robot")
    for (const [index, original] of [
      [1, cold],
      [2, hot],
    ] as const) {
      const fileSize = new DataView(init[index].buffer).getUint32(11, true)
      const gzip = chunks[index].slice(11, 11 + fileSize)
      expect([...gzip.slice(0, 2)]).toEqual([0x1f, 0x8b])
      const decompressed = await new Response(
        new Blob([gzip]).stream().pipeThrough(new DecompressionStream("gzip"))
      ).arrayBuffer()
      expect(new Uint8Array(decompressed)).toEqual(original)
    }
    await connection.close()
  })
  it("rejects invalid program metadata before sending any packets", async () => {
    const { uploadProgram } = await import("../src")
    const transport = new FakeTransport(),
      connection = await Connection.open(transport)
    await expect(
      uploadProgram(
        connection,
        { type: "monolith", data: new Uint8Array() },
        { slot: 0, name: "Robot" }
      )
    ).rejects.toThrow("slot")
    await expect(
      uploadProgram(
        connection,
        { type: "monolith", data: new Uint8Array() },
        { slot: 1, name: "Robot\nslot=2" }
      )
    ).rejects.toThrow("single line")
    expect(transport.writes).toHaveLength(0)
    await connection.close()
  })
})
