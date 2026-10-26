import { Connection, DisconnectedError, type Transport } from "./connection"
import {
  bluetoothApi,
  type BluetoothApi,
  type BluetoothDeviceLike,
  type CharacteristicLike,
} from "./browser-types"
import { concat } from "./protocol"

export const V5_SERVICE = "08590f7e-db05-467e-8757-72f6faeb13d5"
export const CHARACTERISTIC_SYSTEM_TX = "08590f7e-db05-467e-8757-72f6faeb1306"
export const CHARACTERISTIC_SYSTEM_RX = "08590f7e-db05-467e-8757-72f6faeb13f5"
export const CHARACTERISTIC_USER_TX = "08590f7e-db05-467e-8757-72f6faeb1316"
export const CHARACTERISTIC_USER_RX = "08590f7e-db05-467e-8757-72f6faeb1326"
export const CHARACTERISTIC_PAIRING = "08590f7e-db05-467e-8757-72f6faeb13e5"
export const MAX_BLUETOOTH_PACKET_SIZE = 244
export const UNPAIRED_MAGIC = 0xdeadface

export class BluetoothTransport implements Transport {
  readonly type = "bluetooth" as const
  private systemRx?: CharacteristicLike
  private userRx?: CharacteristicLike
  private pairing?: CharacteristicLike
  private readonly subscriptions: {
    characteristic: CharacteristicLike
    listener: EventListener
  }[] = []
  private disconnectListener?: EventListener
  private userWrites: Promise<void> = Promise.resolve()
  constructor(readonly device: BluetoothDeviceLike) {}
  async start(
    system: (data: Uint8Array) => void,
    user: (data: Uint8Array) => void,
    disconnected: (error: Error) => void
  ) {
    if (!this.device.gatt) throw new Error("Device has no GATT server")
    this.disconnectListener = () => disconnected(new DisconnectedError())
    this.device.addEventListener(
      "gattserverdisconnected",
      this.disconnectListener
    )
    const server = await this.device.gatt.connect()
    const service = await server.getPrimaryService(V5_SERVICE)
    this.systemRx = await service.getCharacteristic(CHARACTERISTIC_SYSTEM_RX)
    this.userRx = await service.getCharacteristic(CHARACTERISTIC_USER_RX)
    this.pairing = await service.getCharacteristic(CHARACTERISTIC_PAIRING)
    for (const [uuid, receive] of [
      [CHARACTERISTIC_SYSTEM_TX, system],
      [CHARACTERISTIC_USER_TX, user],
    ] as const) {
      const characteristic = await service.getCharacteristic(uuid)
      const listener: EventListener = () => {
        const value = characteristic.value
        if (value)
          receive(
            new Uint8Array(
              value.buffer,
              value.byteOffset,
              value.byteLength
            ).slice()
          )
      }
      characteristic.addEventListener("characteristicvaluechanged", listener)
      this.subscriptions.push({ characteristic, listener })
      await characteristic.startNotifications()
    }
  }
  async isPaired(): Promise<boolean> {
    const value = await this.requirePairing().readValue()
    if (value.byteLength < 4)
      throw new Error("Truncated Bluetooth pairing state")
    return value.getUint32(0, false) !== UNPAIRED_MAGIC
  }
  async requestPairing() {
    await this.requirePairing().writeValueWithoutResponse(
      new Uint8Array([255, 255, 255, 255])
    )
  }
  /** Pass the four PIN bytes displayed by the brain, e.g. Uint8Array.of(1, 2, 3, 4). */
  async authenticatePairing(pin: Uint8Array) {
    if (pin.length !== 4)
      throw new RangeError("PIN must contain exactly four bytes")
    await this.requirePairing().writeValueWithoutResponse(concat(pin))
    const result = await this.requirePairing().readValue()
    if (
      result.byteLength !== 4 ||
      pin.some((byte, index) => result.getUint8(index) !== byte)
    )
      throw new Error("Incorrect Bluetooth PIN")
  }
  private requirePairing() {
    if (!this.pairing) throw new DisconnectedError()
    return this.pairing
  }
  async writeSystem(data: Uint8Array) {
    if (!this.systemRx) throw new DisconnectedError()
    if (data.length > MAX_BLUETOOTH_PACKET_SIZE)
      throw new RangeError("BLE system packet exceeds 244 bytes")
    if (!(await this.isPaired()))
      throw new Error("Bluetooth pairing is required")
    await this.systemRx.writeValueWithoutResponse(concat(data))
  }
  writeUser(data: Uint8Array): Promise<void> {
    const copy = data.slice()
    const result = this.userWrites.then(async () => {
      if (!this.userRx) throw new DisconnectedError()
      if (!(await this.isPaired()))
        throw new Error("Bluetooth pairing is required")
      for (
        let offset = 0;
        offset < copy.length;
        offset += MAX_BLUETOOTH_PACKET_SIZE
      )
        await this.userRx.writeValueWithoutResponse(
          concat(copy.subarray(offset, offset + MAX_BLUETOOTH_PACKET_SIZE))
        )
    })
    this.userWrites = result.catch(() => {})
    return result
  }
  async close() {
    if (this.disconnectListener)
      this.device.removeEventListener(
        "gattserverdisconnected",
        this.disconnectListener
      )
    for (const { characteristic, listener } of this.subscriptions)
      characteristic.removeEventListener("characteristicvaluechanged", listener)
    await Promise.allSettled(
      this.subscriptions.map(({ characteristic }) =>
        characteristic.stopNotifications()
      )
    )
    this.subscriptions.length = 0
    this.device.gatt?.disconnect()
    this.pairing = this.systemRx = this.userRx = undefined
  }
}
export interface BluetoothConnection {
  connection: Connection
  isPaired(): Promise<boolean>
  requestPairing(): Promise<void>
  authenticatePairing(pin: Uint8Array): Promise<void>
}
export async function openBluetooth(
  device: BluetoothDeviceLike
): Promise<BluetoothConnection> {
  const transport = new BluetoothTransport(device)
  const connection = await Connection.open(transport)
  return {
    connection,
    isPaired: () => transport.isPaired(),
    requestPairing: () => transport.requestPairing(),
    authenticatePairing: (pin) => transport.authenticatePairing(pin),
  }
}
/** Must be called from a user gesture. */
export async function requestBluetooth(
  api: BluetoothApi = bluetoothApi()
): Promise<BluetoothConnection> {
  return openBluetooth(
    await api.requestDevice({ filters: [{ services: [V5_SERVICE] }] })
  )
}
export async function getBluetoothDevices(
  api: BluetoothApi = bluetoothApi()
): Promise<BluetoothDeviceLike[]> {
  if (!api.getDevices)
    throw new Error("This browser does not support Bluetooth.getDevices()")
  return api.getDevices()
}
