/** Structural subsets of browser APIs, avoiding ambient navigator type changes. */
export interface SerialPortLike {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  getInfo(): { usbVendorId?: number; usbProductId?: number }
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>
  close(): Promise<void>
}
export interface SerialApi {
  requestPort(options: {
    filters: { usbVendorId: number; usbProductId?: number }[]
  }): Promise<SerialPortLike>
  getPorts(): Promise<SerialPortLike[]>
}
export interface CharacteristicLike extends EventTarget {
  readonly value?: DataView
  readValue(): Promise<DataView>
  writeValueWithoutResponse(data: Uint8Array<ArrayBuffer>): Promise<void>
  startNotifications(): Promise<unknown>
  stopNotifications(): Promise<unknown>
}
export interface BluetoothDeviceLike extends EventTarget {
  readonly id: string
  readonly name?: string
  readonly gatt?: {
    readonly connected: boolean
    connect(): Promise<{
      getPrimaryService(uuid: string): Promise<{
        getCharacteristic(uuid: string): Promise<CharacteristicLike>
      }>
    }>
    disconnect(): void
  }
}
export interface BluetoothApi {
  requestDevice(options: {
    filters: { services: string[] }[]
  }): Promise<BluetoothDeviceLike>
  getDevices?(): Promise<BluetoothDeviceLike[]>
}
export function serialApi(): SerialApi {
  const api = (
    globalThis.navigator as (Navigator & { serial?: SerialApi }) | undefined
  )?.serial
  if (!api)
    throw new Error(
      "Web Serial is unavailable. Use a supporting browser in a secure context."
    )
  return api
}
export function bluetoothApi(): BluetoothApi {
  const api = (
    globalThis.navigator as
      (Navigator & { bluetooth?: BluetoothApi }) | undefined
  )?.bluetooth
  if (!api)
    throw new Error(
      "Web Bluetooth is unavailable. Use a supporting browser in a secure context."
    )
  return api
}
