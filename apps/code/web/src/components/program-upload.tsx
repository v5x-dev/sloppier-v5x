import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  ArrowUpIcon,
  BluetoothIcon,
  CheckCircleIcon,
  CpuIcon,
  PlugIcon,
} from "@phosphor-icons/react"
import {
  FileExitAction,
  requestBluetooth,
  requestSerial,
  systemVersion,
  uploadProgram,
  type BluetoothConnection,
  type Connection,
  type ProgramData,
} from "@workspace/serial"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { Spinner } from "@workspace/ui/components/spinner"
import { errorMessage } from "@/lib/errors"

import { ProgramConsole } from "./program-console"

type Device = { connection: Connection; bluetooth?: BluetoothConnection }

export function ProgramUpload({
  name,
  buildAction,
  prepareProgram,
  dirty,
}: {
  name: string
  buildAction: ReactNode
  prepareProgram: (
    signal: AbortSignal,
    onStage: (message: string) => void
  ) => Promise<ProgramData>
  dirty: boolean
}) {
  const preparation = useRef<AbortController | null>(null)
  const id = useId()
  const device = useRef<Device | null>(null)
  const mounted = useRef(true)
  const busyRef = useRef(false)
  const consoleQueue = useRef<Promise<unknown>>(Promise.resolve())
  const [consoleConnection, setConsoleConnection] = useState<Connection | null>(
    null
  )
  const consoleIO = useCallback(
    (action: (connection: Connection) => Promise<void>): Promise<boolean> => {
      const result = consoleQueue.current.then(async () => {
        if (busyRef.current || !device.current) return false
        await action(device.current.connection)
        return true
      })
      consoleQueue.current = result.catch(() => {})
      return result
    },
    []
  )
  const [open, setOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [paired, setPaired] = useState(false)
  const [connected, setConnected] = useState<"USB" | "Bluetooth" | null>(null)
  const [pin, setPin] = useState("")
  const [slot, setSlot] = useState(1)
  const [run, setRun] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [success, setSuccess] = useState(false)
  const [support, setSupport] = useState({ serial: false, bluetooth: false })
  useEffect(() => {
    mounted.current = true
    setSupport({
      serial: "serial" in navigator,
      bluetooth: "bluetooth" in navigator,
    })
    return () => {
      mounted.current = false
      preparation.current?.abort()
      void device.current?.connection.close().catch(() => {})
      device.current = null
    }
  }, [])

  useEffect(() => {
    if (!consoleConnection) return
    return consoleConnection.onDisconnect((error) => {
      if (!mounted.current) return
      setConsoleConnection(null)
      setConnected(null)
      setPaired(false)
      setError(error.message)
      if (device.current?.connection === consoleConnection)
        device.current = null
      void consoleConnection.close().catch(() => {})
    })
  }, [consoleConnection])

  async function operation(action: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    setSuccess(false)
    try {
      await consoleQueue.current
      await action()
    } catch (err) {
      if (mounted.current) {
        setError(errorMessage(err))
        setMessage(null)
      }
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function disconnect() {
    const current = device.current
    device.current = null
    setConnected(null)
    setConsoleConnection(null)
    setPaired(false)
    setPin("")
    setMessage(null)
    await current?.connection.close()
  }
  function connect(kind: "USB" | "Bluetooth") {
    void operation(async () => {
      setMessage("Choose your V5 brain…")
      // Invoke the chooser immediately so browser user activation is preserved.
      let selected: Device
      if (kind === "USB") selected = { connection: await requestSerial() }
      else {
        const bluetooth = await requestBluetooth()
        selected = { connection: bluetooth.connection, bluetooth }
      }
      if (!mounted.current) {
        await selected.connection.close()
        return
      }
      device.current = selected
      try {
        const authenticated =
          !selected.bluetooth || (await selected.bluetooth.isPaired())
        if (!authenticated) await selected.bluetooth!.requestPairing()
        else await verifyBrain(selected.connection)
        setConnected(kind)
        setPaired(authenticated)
        if (authenticated) setConsoleConnection(selected.connection)
        setMessage(
          authenticated
            ? "V5 brain connected"
            : "Enter the PIN shown on your brain."
        )
      } catch (err) {
        await disconnect()
        throw err
      }
    })
  }
  async function verifyBrain(connection: Connection) {
    const info = await connection.request(systemVersion())
    if (![0x10, 0x11, 0x14].includes(info.productType))
      throw new Error("Select a V5 brain or V5 controller.")
  }
  function pair() {
    void operation(async () => {
      const selected = device.current
      if (!selected?.bluetooth || !/^\d{4}$/.test(pin)) return
      await selected.bluetooth.authenticatePairing(
        Uint8Array.from(pin, (digit) => Number(digit))
      )
      await verifyBrain(selected.connection)
      setPaired(true)
      setConsoleConnection(selected.connection)
      setPin("")
      setMessage("V5 brain connected")
    })
  }
  function upload() {
    void operation(async () => {
      const selected = device.current
      if (!selected || !paired) return
      const controller = new AbortController()
      preparation.current = controller
      const targetSlot = slot
      setProgress(null)
      setMessage("Checking connection…")
      let preparing = false
      try {
        await verifyBrain(selected.connection)
        preparing = true
        const program = await prepareProgram(controller.signal, (stage) => {
          if (mounted.current) setMessage(stage)
        })
        preparing = false
        controller.signal.throwIfAborted()
        await verifyBrain(selected.connection)
        setProgress(0)
        await uploadProgram(selected.connection, program, {
          slot: targetSlot,
          name,
          programType: "v5x",
          compress: true,
          afterUpload: run
            ? FileExitAction.RunProgram
            : FileExitAction.DoNothing,
          onProgress: (file, percent) => {
            if (!mounted.current) return
            setMessage(
              `Uploading ${file === "ini" ? "program details" : file === "lib" ? "library" : "program"}…`
            )
            setProgress(Math.round(percent))
          },
        })
        if (mounted.current) {
          setSuccess(true)
          setMessage(
            `Uploaded to slot ${targetSlot}${run ? " and started" : ""}.`
          )
          setProgress(null)
        }
      } catch (err) {
        if (!preparing) await disconnect().catch(() => {})
        throw err
      } finally {
        preparation.current = null
        if (mounted.current) setProgress(null)
      }
    })
  }

  return (
    <>
      <Popover open={connectOpen} onOpenChange={setConnectOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Connect V5 brain"
              title="Connect V5 brain"
            />
          }
        >
          <PlugIcon />
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={12}
          className="w-80 max-w-[calc(100vw-2rem)] gap-4 p-4"
        >
          <PopoverHeader>
            <PopoverTitle>Connect V5 brain</PopoverTitle>
          </PopoverHeader>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Connection
            </span>
            {connected ? (
              <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
                <span className="flex items-center gap-2">
                  {connected === "USB" ? <PlugIcon /> : <BluetoothIcon />}
                  {paired ? `${connected} connected` : "Pairing required"}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => void operation(disconnect)}
                >
                  Disconnect
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !support.serial}
                  onClick={() => connect("USB")}
                >
                  <PlugIcon />
                  USB
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !support.bluetooth}
                  onClick={() => connect("Bluetooth")}
                >
                  <BluetoothIcon />
                  Bluetooth
                </Button>
              </div>
            )}
            {!connected && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {!support.serial && !support.bluetooth
                  ? "Use Chrome or Edge on a supported device to connect your brain."
                  : "For USB, select the brain’s system port."}
              </p>
            )}
          </div>
          {connected && !paired && (
            <form
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                pair()
              }}
            >
              <Field>
                <FieldLabel htmlFor={`${id}-pin`}>Brain PIN</FieldLabel>
                <Input
                  id={`${id}-pin`}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  pattern="[0-9]{4}"
                  placeholder="0000"
                  value={pin}
                  disabled={busy}
                  onChange={(event) =>
                    setPin(event.target.value.replace(/\D/g, ""))
                  }
                />
              </Field>
              <Button
                type="submit"
                variant="outline"
                disabled={busy || pin.length !== 4}
              >
                Pair
              </Button>
            </form>
          )}

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {busy && progress === null && (
            <p role="status" className="text-xs text-muted-foreground">
              {message}
            </p>
          )}
        </PopoverContent>
      </Popover>
      {buildAction}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Upload to V5 brain"
              title="Upload to V5 brain"
            />
          }
        >
          <ArrowUpIcon />
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={12}
          className="w-80 max-w-[calc(100vw-2rem)] gap-4 p-4"
        >
          <PopoverHeader>
            <div className="mb-1 flex items-center gap-2">
              <CpuIcon className="size-4 text-muted-foreground" />
              <PopoverTitle>Upload to V5 brain</PopoverTitle>
            </div>
            <PopoverDescription>
              Commit, build, and send your program to the robot.
            </PopoverDescription>
          </PopoverHeader>
          <p className="text-xs text-muted-foreground">
            {paired
              ? `${connected} connected`
              : "Connect your V5 brain using the Connect button."}
          </p>
          <Field>
            <FieldLabel htmlFor={`${id}-slot`}>Program slot</FieldLabel>
            <NativeSelect
              id={`${id}-slot`}
              className="w-full"
              value={slot}
              disabled={busy}
              onChange={(event) => {
                setSlot(Number(event.target.value))
                setSuccess(false)
              }}
            >
              {Array.from({ length: 8 }, (_, index) => (
                <NativeSelectOption key={index} value={index + 1}>
                  Slot {index + 1}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={run}
              disabled={busy}
              onChange={(event) => setRun(event.target.checked)}
            />
            Run after upload
          </label>
          <div className="space-y-2 text-xs leading-relaxed">
            {dirty && (
              <p className="text-muted-foreground">
                Your changes will be committed and built before uploading.
              </p>
            )}
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2"
            >
              {busy && <Spinner className="size-3.5 shrink-0" />}
              {success && <CheckCircleIcon className="size-4 shrink-0" />}
              {message}
            </div>
            {progress !== null && (
              <progress
                aria-label="File upload progress"
                className="h-1 w-full accent-primary"
                value={progress}
                max={100}
              />
            )}
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
          </div>
          <Button
            disabled={busy || !paired}
            onClick={upload}
            className="w-full"
          >
            <ArrowUpIcon />
            {busy
              ? progress !== null
                ? "Uploading…"
                : "Preparing upload…"
              : `Upload to slot ${slot}`}
          </Button>
        </PopoverContent>
      </Popover>
      <ProgramConsole
        connection={consoleConnection}
        io={consoleIO}
        busy={busy}
        slot={slot}
        onSlotChange={setSlot}
      />
    </>
  )
}
