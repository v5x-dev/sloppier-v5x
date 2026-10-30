import { useMutation } from "convex/react"
import { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
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
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react"
import {
  ArrowClockwiseIcon,
  ArrowRightIcon,
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
} from "@v5x/serial"
import { Button } from "@v5x/ui/components/button"
import { ButtonGroup } from "@v5x/ui/components/button-group"
import { Field, FieldLabel } from "@v5x/ui/components/field"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@v5x/ui/components/input-otp"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@v5x/ui/components/popover"
import { Progress } from "@v5x/ui/components/progress"
import { Spinner } from "@v5x/ui/components/spinner"
import { Switch } from "@v5x/ui/components/switch"
import { toast } from "@v5x/ui/components/toast"
import { cn } from "@v5x/ui/lib/utils"
import { errorMessage } from "@/lib/errors"
import {
  BRAIN_SLOT_COUNT,
  matchBrainSlot,
  type BrainSlotMatch,
  type BrainSlotReading,
} from "@/lib/brain-slots"
import { shortcutKeys } from "@/lib/keyboard-shortcuts"

import { ProgramConsole } from "./program-console"

type Device = { connection: Connection; bluetooth?: BluetoothConnection }

const subscribeToNothing = () => () => {}

const slotMatchLabel: Record<BrainSlotMatch, string | null> = {
  empty: null,
  current: "Current revision",
  "other-revision": "Different revision",
  "other-program": "Other program",
  untracked: "Not tracked by v5x",
}

// Status is shown as a bar along the bottom of each slot and as the border of the
// program-to-slot row. Text labels remain in each slot's accessible name.
const slotLineClass: Record<BrainSlotMatch, string | null> = {
  empty: null,
  current: "bg-success",
  "other-revision": "bg-primary",
  "other-program": "bg-muted-foreground",
  untracked:
    "bg-[repeating-linear-gradient(90deg,var(--muted-foreground)_0_4px,transparent_4px_7px)]",
}

const slotBorderClass: Record<BrainSlotMatch, string> = {
  empty: "border-border",
  current: "border-success",
  "other-revision": "border-primary",
  "other-program": "border-muted-foreground",
  untracked: "border-muted-foreground",
}

function shortRevision(sha: string | undefined) {
  return sha ? sha.slice(0, 7) : ""
}

function describeSlot(
  number: number,
  reading: BrainSlotReading | undefined,
  match: BrainSlotMatch | null
) {
  const status =
    match === "empty" ? "Empty" : match ? slotMatchLabel[match] : null
  return [`Slot ${number}`, reading?.name, status].filter(Boolean).join(", ")
}

export function ProgramUpload({
  name,
  buildAction,
  prepareProgram,
  dirty,
  programId,
  currentSha,
}: {
  name: string
  programId: Id<"programs">
  /** The Program's committed head, which uploads record as their revision. */
  currentSha?: string
  buildAction: ReactNode
  prepareProgram: (
    signal: AbortSignal,
    onStage: (message: string) => void,
    isInstalled: (sha: string) => Promise<boolean>
  ) => Promise<ProgramData | null>
  dirty: boolean
}) {
  const recordUpload = useMutation(api.uploads.record)
  const preparation = useRef<AbortController | null>(null)
  const id = useId()
  const device = useRef<Device | null>(null)
  const mounted = useRef(true)
  const busyRef = useRef(false)
  const slotButtons = useRef<(HTMLButtonElement | null)[]>([])
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
  const [slots, setSlots] = useState<BrainSlotReading[] | null>(null)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsError, setSlotsError] = useState<string | null>(null)
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
      setSlots(null)
      setSlotsError(null)
      setError(disconnectError.message)
      if (device.current?.connection === consoleConnection)
        device.current = null
      void consoleConnection.close().catch(() => {})
    })
  }, [consoleConnection])

  // Runs through the console queue so it never overlaps an upload. A skipped
  // read leaves the last list in place.
  const refreshSlots = useCallback(async () => {
    setSlotsLoading(true)
    setSlotsError(null)
    try {
      await consoleIO(async (connection) => {
        const { readBrainSlots } = await import("@/lib/brain-slots-reader")
        const readings = await readBrainSlots(connection)
        if (mounted.current && device.current?.connection === connection)
          setSlots(readings)
      })
    } catch (err) {
      if (mounted.current && device.current) setSlotsError(errorMessage(err))
    } finally {
      if (mounted.current) setSlotsLoading(false)
    }
  }, [consoleIO])

  function selectSlot(number: number) {
    setSlot(number)
    setSuccess(false)
  }
  // Arrow keys move the selection through the slots, as in a radio group.
  function moveSlot(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    const direction =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0
    if (!direction) return
    event.preventDefault()
    const next = (index + direction + BRAIN_SLOT_COUNT) % BRAIN_SLOT_COUNT
    selectSlot(next + 1)
    slotButtons.current[next]?.focus()
  }
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
    setSlots(null)
    setSlotsError(null)
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
        let revision = ""
        const program = await prepareProgram(
          controller.signal,
          (stage) => {
            if (mounted.current) setMessage(stage)
          },
          async (sha) => {
            const { isInstalled } = await import("@/lib/brain-revision")
            revision = sha
            setMessage("Checking the program on your Brain…")
            return isInstalled(selected.connection, targetSlot, programId, sha)
          }
        )
        preparing = false
        controller.signal.throwIfAborted()
        if (!program) {
          const resultMessage = `Slot ${targetSlot} already has this version.`
          if (mounted.current) {
            setSuccess(true)
            setMessage(resultMessage)
          }
          if (fromKeyboard) toast.add({ type: "success", title: resultMessage })
          return
        }
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
        if (
          program.type === "monolith" &&
          selected.connection.type !== "controller"
        ) {
          try {
            const { recordInstalled } = await import("@/lib/brain-revision")
            await recordInstalled(
              selected.connection,
              targetSlot,
              programId,
              revision
            )
          } catch {
            // The program was uploaded successfully; a missing record only prevents reuse.
          }
        }
        try {
          await recordUpload({ programId, revision, slot: targetSlot })
        } catch {
          toast.add({
            type: "error",
            title: "Upload succeeded, but activity could not be saved.",
          })
        }
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
    }, fromKeyboard).then(refreshSlots)
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
      setConnectOpen(true)
      return
    }
    upload(true)
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => uploadFromKeyboard(event)
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [])

  const selected = slots?.find((item) => item.slot === slot)
  const selectedMatch = selected
    ? matchBrainSlot(selected, { programId, revision: currentSha })
    : null
  const selectedName =
    selectedMatch === "empty"
      ? "Empty"
      : selected
        ? (selected.name ?? "Unnamed program")
        : "—"
  const uploadButtonText =
    selected?.binary && selectedMatch !== "current"
      ? selected.name
        ? `Replace ${selected.name} in slot ${slot}`
        : `Replace slot ${slot}`
      : `Upload to slot ${slot}`
  const showStatus = busy || success || dirty || Boolean(error)

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
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (nextOpen) void refreshSlots()
        }}
      >
        <ActionTooltip label={uploadLabel} shortcut={shortcutKeys("⇧", "B")}>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Upload to V5 Brain"
                aria-busy={busy}
              />
            }
          >
            {busy ? (
              <Spinner className="text-primary" />
            ) : (
              <UploadSimpleIcon className="text-primary" />
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
            <div className="flex items-center gap-2">
              <CpuIcon className="size-4 text-muted-foreground" />
              <PopoverTitle>Upload to V5 Brain</PopoverTitle>
            </div>
          </PopoverHeader>
          {!brainReady ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Connect your V5 Brain before uploading your Program.
              </p>
              <Button
                className="w-full"
                onClick={() => {
                  setOpen(false)
                  setConnectOpen(true)
                }}
              >
                Connect V5 Brain
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span
                    id={`${id}-slots`}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Brain slots
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Refresh Brain slots"
                    disabled={slotsLoading}
                    onClick={() => void refreshSlots()}
                  >
                    <ArrowClockwiseIcon
                      className={slotsLoading ? "animate-spin" : undefined}
                    />
                  </Button>
                </div>
                <ButtonGroup
                  role="radiogroup"
                  aria-labelledby={`${id}-slots`}
                  className="w-full"
                >
                  {Array.from({ length: BRAIN_SLOT_COUNT }, (_, index) => {
                    const number = index + 1
                    const reading = slots?.find((item) => item.slot === number)
                    const match = reading
                      ? matchBrainSlot(reading, {
                          programId,
                          revision: currentSha,
                        })
                      : null
                    const selectedSlot = slot === number
                    return (
                      <Button
                        key={number}
                        ref={(element) => {
                          slotButtons.current[index] = element
                        }}
                        variant="outline"
                        size="icon"
                        role="radio"
                        aria-checked={selectedSlot}
                        aria-label={describeSlot(number, reading, match)}
                        tabIndex={selectedSlot ? 0 : -1}
                        data-pressed={selectedSlot || undefined}
                        disabled={busy}
                        onClick={() => selectSlot(number)}
                        onKeyDown={(event) => moveSlot(event, index)}
                        className={cn(
                          "aspect-square h-auto! w-auto! flex-1 overflow-hidden",
                          match === "empty" && "text-muted-foreground"
                        )}
                      >
                        {number}
                        {match && slotLineClass[match] && (
                          <span
                            aria-hidden
                            className={cn(
                              "absolute inset-x-0 bottom-0 h-[3px]",
                              slotLineClass[match]
                            )}
                          />
                        )}
                      </Button>
                    )
                  })}
                </ButtonGroup>
                {slotsError && (
                  <p role="alert" className="text-xs text-destructive">
                    {slotsError}
                  </p>
                )}
              </div>
              <div
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2.5",
                  selectedMatch
                    ? slotBorderClass[selectedMatch]
                    : "border-border"
                )}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {shortRevision(currentSha)}
                  </span>
                </div>
                <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{selectedName}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {selectedMatch === "empty"
                      ? ""
                      : shortRevision(selected?.record?.sha)}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`${id}-run`} className="text-sm">
                  Run after upload
                </label>
                <Switch
                  id={`${id}-run`}
                  checked={run}
                  disabled={busy}
                  onCheckedChange={(checked) => setRun(checked)}
                />
              </div>
              {/* Idle status is screen-reader-only: out of the flow, so no gap above Upload. */}
              <div
                className={cn(
                  "space-y-2 text-xs leading-relaxed",
                  !showStatus && "sr-only"
                )}
              >
                {dirty && (
                  <p className="text-muted-foreground">
                    Your changes will be saved before uploading.
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
                {busy ? <Spinner /> : <ArrowUpIcon />}
                {busy
                  ? progress !== null
                    ? "Uploading…"
                    : "Preparing upload…"
                  : uploadButtonText}
              </Button>
            </>
          )}
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
