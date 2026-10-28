import { ActionGroup } from "@/components/shared/action-group"
import { ActionTooltip } from "@/components/shared/action-tooltip"
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import {
  ArrowUpIcon,
  BluetoothIcon,
  CheckCircleIcon,
  CpuIcon,
  PlugIcon,
  PlugsConnectedIcon,
  UploadSimpleIcon,
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
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@workspace/ui/components/input-otp"
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
import { Progress } from "@workspace/ui/components/progress"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"
import { errorMessage } from "@/lib/errors"
import { shortcutKeys } from "@/lib/keyboard-shortcuts"

import { ProgramConsole } from "./program-console"

type Device = { connection: Connection; bluetooth?: BluetoothConnection }

const subscribeToNothing = () => () => {}

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
  // Browser support is read on the client; the server render reports none.
  const serialSupported = useSyncExternalStore(
    subscribeToNothing,
    () => "serial" in navigator,
    () => false
  )
  const bluetoothSupported = useSyncExternalStore(
    subscribeToNothing,
    () => "bluetooth" in navigator,
    () => false
  )
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      preparation.current?.abort()
      void device.current?.connection.close().catch(() => {})
      device.current = null
    }
  }, [])

  useEffect(() => {
    if (!consoleConnection) return
    return consoleConnection.onDisconnect((disconnectError) => {
      if (!mounted.current) return
      setConsoleConnection(null)
      setConnected(null)
      setPaired(false)
      setError(disconnectError.message)
      if (device.current?.connection === consoleConnection)
        device.current = null
      void consoleConnection.close().catch(() => {})
    })
  }, [consoleConnection])

  async function operation(action: () => Promise<void>, notify = false) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    setSuccess(false)
    try {
      await consoleQueue.current
      await action()
    } catch (err) {
      // Keyboard-started work has no open popover to show the error in.
      if (notify)
        toast.add({
          type: "error",
          title: "Could not upload",
          description: errorMessage(err),
        })
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
      setMessage("Choose your V5 Brain…")
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
            ? "V5 Brain connected"
            : "Enter the PIN shown on your Brain."
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
      throw new Error("Select a V5 Brain or V5 controller.")
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
      setMessage("V5 Brain connected")
    })
  }
  function upload(fromKeyboard = false) {
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
        const uploaded = `Uploaded to slot ${targetSlot}${run ? " and started" : ""}.`
        if (mounted.current) {
          setSuccess(true)
          setMessage(uploaded)
          setProgress(null)
        }
        if (fromKeyboard) toast.add({ type: "success", title: uploaded })
      } catch (err) {
        if (!preparing) await disconnect().catch(() => {})
        throw err
      } finally {
        preparation.current = null
        if (mounted.current) setProgress(null)
      }
    }, fromKeyboard)
  }
  const brainReady = Boolean(connected) && paired
  const connectTitle = !connected
    ? "Connect V5 Brain"
    : !paired
      ? "Pair V5 Brain"
      : `V5 Brain connected over ${connected}`
  const uploadLabel = !connected
    ? "Connect a V5 Brain to upload"
    : !paired
      ? "Pair your V5 Brain to upload"
      : "Upload to V5 Brain"
  const uploadFromKeyboard = useEffectEvent((event: KeyboardEvent) => {
    if (
      !(event.ctrlKey || event.metaKey) ||
      !event.shiftKey ||
      event.altKey ||
      event.isComposing ||
      event.repeat ||
      event.key.toLowerCase() !== "b"
    )
      return
    event.preventDefault()
    if (!paired) {
      toast.add({ type: "error", title: uploadLabel })
      return
    }
    upload(true)
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => uploadFromKeyboard(event)
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [])

  return (
    <ActionGroup label="V5 Brain">
      <Popover open={connectOpen} onOpenChange={setConnectOpen}>
        <ActionTooltip label={connectTitle}>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={connectTitle}
              />
            }
          >
            {connected ? (
              <PlugsConnectedIcon
                className={brainReady ? "text-success" : "text-primary"}
              />
            ) : (
              <PlugIcon className="text-primary" />
            )}
          </PopoverTrigger>
        </ActionTooltip>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={12}
          className="w-80 max-w-[calc(100vw-2rem)] gap-4 p-4"
        >
          <PopoverHeader>
            <PopoverTitle>Connect V5 Brain</PopoverTitle>
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
                  disabled={busy || !serialSupported}
                  onClick={() => connect("USB")}
                >
                  <PlugIcon />
                  USB
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !bluetoothSupported}
                  onClick={() => connect("Bluetooth")}
                >
                  <BluetoothIcon />
                  Bluetooth
                </Button>
              </div>
            )}
            {!connected && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {!serialSupported && !bluetoothSupported
                  ? "Use Chrome or Edge on a supported device to connect your Brain."
                  : "For USB, select the Brain’s system port."}
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
                <InputOTP
                  id={`${id}-pin`}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  pattern="^[0-9]*$"
                  value={pin}
                  disabled={busy}
                  onChange={setPin}
                >
                  <InputOTPGroup>
                    {[0, 1, 2, 3].map((index) => (
                      <InputOTPSlot key={index} index={index} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
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
      <Popover open={open && brainReady} onOpenChange={setOpen}>
        {brainReady && (
          <ActionTooltip label={uploadLabel} shortcut={shortcutKeys("⇧", "B")}>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Upload to V5 Brain"
                />
              }
            >
              <UploadSimpleIcon className="text-primary" />
            </PopoverTrigger>
          </ActionTooltip>
        )}
        <PopoverContent
          side="top"
          align="end"
          sideOffset={12}
          className="w-80 max-w-[calc(100vw-2rem)] gap-4 p-4"
        >
          <PopoverHeader>
            <div className="mb-1 flex items-center gap-2">
              <CpuIcon className="size-4 text-muted-foreground" />
              <PopoverTitle>Upload to V5 Brain</PopoverTitle>
            </div>
            <PopoverDescription>
              Commit, build, and send your program to the robot.
            </PopoverDescription>
          </PopoverHeader>
          <p className="text-xs text-muted-foreground">
            {paired
              ? `${connected} connected`
              : "Connect your V5 Brain using the Connect button."}
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
              <Progress
                aria-label="File upload progress"
                className="w-full"
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
            onClick={() => upload()}
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
    </ActionGroup>
  )
}
