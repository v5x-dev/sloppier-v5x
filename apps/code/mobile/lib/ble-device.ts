import { Buffer } from "buffer"
import type { Device, Subscription } from "react-native-ble-plx"
import type { BluetoothDeviceLike, CharacteristicLike } from "@workspace/serial"

type Listener = EventListenerOrEventListenerObject

// Just enough EventTarget for @workspace/serial's Bluetooth transport, which
// listens for "characteristicvaluechanged" and "gattserverdisconnected".
class Events {
  private readonly listeners = new Map<string, Set<Listener>>()
  addEventListener(type: string, listener: Listener | null) {
    if (!listener) return
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(type, set)
  }
  removeEventListener(type: string, listener: Listener | null) {
    if (listener) this.listeners.get(type)?.delete(listener)
  }
  dispatchEvent(event: Event) {
    for (const listener of this.listeners.get(event.type) ?? [])
      if (typeof listener === "function") listener(event)
      else listener.handleEvent(event)
    return true
  }
  protected emit(type: string) {
    this.dispatchEvent({ type } as Event)
  }
}

function toDataView(base64: string | null | undefined) {
  const bytes = Buffer.from(base64 ?? "", "base64")
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

class Characteristic extends Events implements CharacteristicLike {
  value?: DataView
  private subscription?: Subscription
  constructor(
    private readonly device: Device,
    private readonly service: string,
    private readonly uuid: string
  ) {
    super()
  }
  async readValue() {
    const read = await this.device.readCharacteristicForService(
      this.service,
      this.uuid
    )
    this.value = toDataView(read.value)
    return this.value
  }
  async writeValueWithoutResponse(data: Uint8Array<ArrayBuffer>) {
    await this.device.writeCharacteristicWithoutResponseForService(
      this.service,
      this.uuid,
      Buffer.from(data).toString("base64")
    )
  }
  async startNotifications() {
    this.subscription?.remove()
    this.subscription = this.device.monitorCharacteristicForService(
      this.service,
      this.uuid,
      (error, characteristic) => {
        // A monitor error is followed by the device's disconnect event.
        if (error || !characteristic) return
        this.value = toDataView(characteristic.value)
        this.emit("characteristicvaluechanged")
      }
    )
    return this
  }
  async stopNotifications() {
    this.subscription?.remove()
    this.subscription = undefined
    return this
  }
}

/** Wraps a react-native-ble-plx device in the Web Bluetooth shape. */
export class BleDevice extends Events implements BluetoothDeviceLike {
  readonly id: string
  readonly name?: string
  private connected = false
  private disconnectSubscription?: Subscription
  readonly gatt: NonNullable<BluetoothDeviceLike["gatt"]>
  constructor(private device: Device) {
    super()
    this.id = device.id
    this.name = device.localName ?? device.name ?? undefined
    const self = this
    this.gatt = {
      get connected() {
        return self.connected
      },
      connect: () => this.connect(),
      disconnect: () => {
        void this.device.cancelConnection().catch(() => {})
      },
    }
  }
  private async connect() {
    this.device = await this.device.connect()
    this.device = await this.device.discoverAllServicesAndCharacteristics()
    this.connected = true
    this.disconnectSubscription?.remove()
    this.disconnectSubscription = this.device.onDisconnected(() => {
      this.connected = false
      this.disconnectSubscription?.remove()
      this.emit("gattserverdisconnected")
    })
    const device = this.device
    return {
      getPrimaryService: async (service: string) => ({
        getCharacteristic: async (uuid: string) =>
          new Characteristic(device, service, uuid),
      }),
    }
  }
}
