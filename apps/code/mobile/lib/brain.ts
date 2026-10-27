import { useSyncExternalStore } from "react"
import { BleManager, State, type Device } from "react-native-ble-plx"
import {
  openBluetooth,
  systemVersion,
  V5_SERVICE,
  type BluetoothConnection,
  type Connection,
} from "@workspace/serial"
import { BleDevice } from "@/lib/ble-device"

export type BrainPhase =
  "idle" | "scanning" | "connecting" | "pairing" | "connected"

export type BrainState = {
  phase: BrainPhase
  devices: { id: string; name: string }[]
  name?: string
  message?: string
  error?: string
}

// One Bluetooth connection to a V5 Brain for the whole app, so upload and the
// console can reuse it from any screen. Mirrors the web's connect flow:
// connect, pair with the PIN shown on the Brain, then verify it is a Brain.
let manager: BleManager | null = null
let state: BrainState = { phase: "idle", devices: [] }
let current: BluetoothConnection | null = null
let stopDisconnect: (() => void) | null = null
const found = new Map<string, Device>()
const listeners = new Set<() => void>()

function set(next: Partial<BrainState>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

function ble() {
  manager ??= new BleManager()
  return manager
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Bluetooth failed."
}

function waitForPoweredOn() {
  return new Promise<void>((resolve, reject) => {
    const subscription = ble().onStateChange((next) => {
      if (next === State.PoweredOn) {
        subscription.remove()
        resolve()
      } else if (next === State.Unauthorized || next === State.Unsupported) {
        subscription.remove()
        reject(
          new Error(
            next === State.Unauthorized
              ? "Allow Bluetooth for V5X in Settings."
              : "Bluetooth is not supported on this device."
          )
        )
      } else if (next === State.PoweredOff) {
        set({ message: "Turn on Bluetooth to find your V5 Brain." })
      }
    }, true)
  })
}

export async function startScan() {
  if (state.phase !== "idle") return
  found.clear()
  set({ phase: "scanning", devices: [], error: undefined, message: undefined })
  try {
    await waitForPoweredOn()
    // The sheet may have closed while Bluetooth was turning on.
    if ((state.phase as BrainPhase) !== "scanning") return
    set({ message: "Looking for V5 Brains…" })
    await ble().startDeviceScan([V5_SERVICE], null, (error, device) => {
      if (error) {
        set({ phase: "idle", error: error.message, message: undefined })
        return
      }
      if (!device || found.has(device.id)) return
      found.set(device.id, device)
      set({
        devices: [
          ...state.devices,
          {
            id: device.id,
            name: device.localName ?? device.name ?? "V5 Brain",
          },
        ],
      })
    })
  } catch (error) {
    set({ phase: "idle", error: message(error), message: undefined })
  }
}

export function stopScan() {
  if (state.phase !== "scanning") return
  void manager?.stopDeviceScan()
  set({ phase: "idle", message: undefined })
}

async function verify(connection: Connection) {
  const info = await connection.request(systemVersion())
  if (![0x10, 0x11, 0x14].includes(info.productType))
    throw new Error("Select a V5 Brain or V5 controller.")
}

function connected() {
  set({ phase: "connected", message: "V5 Brain connected", error: undefined })
}

export async function connect(id: string) {
  const device = found.get(id)
  if (!device) return
  void manager?.stopDeviceScan()
  const name = device.localName ?? device.name ?? "V5 Brain"
  set({ phase: "connecting", name, message: `Connecting to ${name}…` })
  try {
    const bluetooth = await openBluetooth(new BleDevice(device))
    current = bluetooth
    stopDisconnect = bluetooth.connection.onDisconnect((error) => {
      reset(error.message)
    })
    if (await bluetooth.isPaired()) {
      await verify(bluetooth.connection)
      connected()
    } else {
      await bluetooth.requestPairing()
      set({ phase: "pairing", message: "Enter the PIN shown on your Brain." })
    }
  } catch (error) {
    await disconnect()
    set({ error: message(error) })
  }
}

export async function pair(pin: string) {
  if (!current || !/^\d{4}$/.test(pin)) return
  set({ message: "Pairing…", error: undefined })
  try {
    await current.authenticatePairing(
      Uint8Array.from(pin, (digit) => Number(digit))
    )
    await verify(current.connection)
    connected()
  } catch (error) {
    set({
      message: "Enter the PIN shown on your Brain.",
      error: message(error),
    })
  }
}

function reset(error?: string) {
  stopDisconnect?.()
  stopDisconnect = null
  current = null
  set({
    phase: "idle",
    name: undefined,
    message: undefined,
    error,
    devices: [],
  })
}

export async function disconnect() {
  const connection = current?.connection
  reset()
  await connection?.close().catch(() => {})
}

/** The connected Brain, for upload and console. Null until paired. */
export function brainConnection() {
  return state.phase === "connected" ? (current?.connection ?? null) : null
}

export function useBrain() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state
  )
}
