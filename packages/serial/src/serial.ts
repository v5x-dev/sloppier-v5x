import {
  Connection,
  DisconnectedError,
  type Transport,
  type ConnectionType,
} from "./connection"
import { serialApi, type SerialApi, type SerialPortLike } from "./browser-types"

export const VEX_USB_VID = 0x2888
export const V5_BRAIN_USB_PID = 0x0501
export const V5_CONTROLLER_USB_PID = 0x0503
export const V5_SERIAL_BAUDRATE = 115200
export const VEX_USB_PRODUCTS = [
  0x0501, 0x0503, 0x0600, 0x0a00, 0x0a10, 0x0700, 0x0800,
] as const
export interface SerialOptions {
  userPort?: SerialPortLike
  baudRate?: number
  type?: "wired" | "controller"
}

export class SerialTransport implements Transport {
  readonly type: ConnectionType
  private readonly readers: ReadableStreamDefaultReader<Uint8Array>[] = []
  private readonly writers: WritableStreamDefaultWriter<Uint8Array>[] = []
  private readonly opened: SerialPortLike[] = []
  private readonly tasks: Promise<void>[] = []
  private closing = false
  constructor(
    readonly port: SerialPortLike,
    private readonly options: SerialOptions = {}
  ) {
    if (port === options.userPort)
      throw new Error("System and user ports must be different")
    this.type =
      options.type ??
      (port.getInfo().usbProductId === V5_CONTROLLER_USB_PID
        ? "controller"
        : "wired")
  }
  async start(
    system: (data: Uint8Array) => void,
    user: (data: Uint8Array) => void,
    disconnected: (error: Error) => void
  ) {
    const ports = [
      this.port,
      ...(this.options.userPort ? [this.options.userPort] : []),
    ]
    for (const [index, port] of ports.entries()) {
      await port.open({
        baudRate: this.options.baudRate ?? V5_SERIAL_BAUDRATE,
        bufferSize: 65536,
      })
      this.opened.push(port)
      if (!port.readable || !port.writable)
        throw new Error("Serial port has no readable or writable stream")
      const reader = port.readable.getReader()
      this.readers.push(reader)
      this.writers.push(port.writable.getWriter())
      this.tasks.push(
        (async () => {
          try {
            while (!this.closing) {
              const { value, done } = await reader.read()
              if (done) {
                if (!this.closing) disconnected(new DisconnectedError())
                break
              }
              if (value) (index === 0 ? system : user)(value)
            }
          } catch (error) {
            if (!this.closing)
              disconnected(
                error instanceof Error ? error : new Error(String(error))
              )
          } finally {
            reader.releaseLock()
          }
        })()
      )
    }
  }
  async writeSystem(data: Uint8Array) {
    await this.writers[0].write(data)
  }
  // The property is absent when stdio must go through CDC2 USER_READ instead.
  get writeUser(): ((data: Uint8Array) => Promise<void>) | undefined {
    return this.options.userPort
      ? async (data) => {
          await this.writers[1].write(data)
        }
      : undefined
  }
  async close() {
    if (this.closing) return
    this.closing = true
    await Promise.allSettled(this.readers.map((reader) => reader.cancel()))
    await Promise.allSettled(this.tasks)
    for (const writer of this.writers) writer.releaseLock()
    const results = await Promise.allSettled(
      this.opened.map((port) => port.close())
    )
    const failed = results.find((result) => result.status === "rejected")
    if (failed?.status === "rejected") throw failed.reason
  }
}
export async function openSerial(
  port: SerialPortLike,
  options?: SerialOptions
): Promise<Connection> {
  return Connection.open(new SerialTransport(port, options))
}
/** Must be called from a user gesture. Select the brain's system interface. */
export async function requestSerial(
  options?: SerialOptions,
  api: SerialApi = serialApi()
): Promise<Connection> {
  const port = await api.requestPort({
    filters: VEX_USB_PRODUCTS.map((usbProductId) => ({
      usbVendorId: VEX_USB_VID,
      usbProductId,
    })),
  })
  return openSerial(port, options)
}
export async function getSerialPorts(
  api: SerialApi = serialApi()
): Promise<SerialPortLike[]> {
  return (await api.getPorts()).filter((port) => {
    const info = port.getInfo()
    return (
      info.usbVendorId === VEX_USB_VID &&
      VEX_USB_PRODUCTS.some((pid) => pid === info.usbProductId)
    )
  })
}
