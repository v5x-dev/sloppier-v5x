import { useEffect, useRef, useState } from "react"
import {
  TerminalIcon,
  PlayIcon,
  StopIcon,
  ArrowRightIcon,
} from "@phosphor-icons/react"
import {
  fileLoadAction,
  FileLoadAction,
  logRead,
  logStatus,
  readUser,
  writeUser,
  TimeoutError,
  type Connection,
  type BrainLogEntry,
} from "@workspace/serial"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@workspace/ui/components/sheet"
import { errorMessage } from "@/lib/errors"

type IO = (
  action: (connection: Connection) => Promise<void>
) => Promise<boolean>
export function ProgramConsole({
  connection,
  io,
  busy,
  slot,
  onSlotChange,
}: {
  connection: Connection | null
  io: IO
  busy: boolean
  slot: number
  onSlotChange: (slot: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<"output" | "events">("output")
  const [output, setOutput] = useState("")
  const [input, setInput] = useState("")
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [events, setEvents] = useState<BrainLogEntry[] | null>(null)
  const log = useRef<HTMLPreElement>(null)
  useEffect(() => {
    setError(null)
    setEvents(null)
    if (!connection) {
      setOpen(false)
      return
    }
    const decoder = new TextDecoder()
    let disposed = false
    const append = (bytes: Uint8Array) => {
      if (!disposed && bytes.length)
        setOutput((current) =>
          (current + decoder.decode(bytes, { stream: true })).slice(-200_000)
        )
    }
    const unsubscribe = connection.onUserData(append)
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        if (
          connection!.type !== "bluetooth" &&
          !connection!.transport.writeUser
        )
          await io(async (current) => append(await readUser(current)))
      } catch (err) {
        if (!(err instanceof TimeoutError) && !disposed) {
          setError(errorMessage(err))
          return
        }
      }
      if (!disposed) timer = setTimeout(poll, 100)
    }
    void poll()
    return () => {
      disposed = true
      clearTimeout(timer)
      unsubscribe()
    }
  }, [connection, io])
  useEffect(() => {
    if (!paused && log.current) log.current.scrollTop = log.current.scrollHeight
  }, [output, paused, open, tab])
  async function action(fn: (current: Connection) => Promise<void>) {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      if (!(await io(fn)))
        setError(
          "The brain is busy or disconnected. Try again when it is ready."
        )
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }
  const disabled = !connection || busy || pending
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Open robot console"
        title={
          connection
            ? "Robot console"
            : "Connect a V5 brain to open the console"
        }
        disabled={!connection}
        onClick={() => {
          if (connection) setOpen(true)
        }}
      >
        <TerminalIcon />
      </Button>
      <Sheet
        open={open && Boolean(connection)}
        onOpenChange={(nextOpen) => setOpen(nextOpen && Boolean(connection))}
      >
        <SheetContent
          side="right"
          className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        >
          <SheetHeader className="border-b pr-12">
            <SheetTitle>Robot console</SheetTitle>
            <SheetDescription>
              {connection
                ? `${connection.type === "bluetooth" ? "Bluetooth" : "USB"} connected`
                : "No V5 brain connected"}
              {busy && " · Device busy"}
            </SheetDescription>
          </SheetHeader>
          <div className="flex items-center gap-2 border-b p-3">
            <NativeSelect
              aria-label="Console program slot"
              value={slot}
              disabled={busy || pending}
              onChange={(event) => onSlotChange(Number(event.target.value))}
            >
              {Array.from({ length: 8 }, (_, i) => (
                <NativeSelectOption key={i} value={i + 1}>
                  Slot {i + 1}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() =>
                void action(async (current) => {
                  await current.request(fileLoadAction(`slot_${slot}.bin`))
                })
              }
            >
              <PlayIcon />
              Run
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() =>
                void action(async (current) => {
                  await current.request(
                    fileLoadAction(`slot_${slot}.bin`, FileLoadAction.Stop)
                  )
                })
              }
            >
              <StopIcon />
              Stop
            </Button>
          </div>
          <div
            className="flex items-center gap-1 border-b px-3 py-2"
            role="group"
            aria-label="Console view"
          >
            <Button
              size="sm"
              variant={tab === "output" ? "secondary" : "ghost"}
              aria-pressed={tab === "output"}
              onClick={() => setTab("output")}
            >
              Program output
            </Button>
            <Button
              size="sm"
              variant={tab === "events" ? "secondary" : "ghost"}
              aria-pressed={tab === "events"}
              onClick={() => setTab("events")}
            >
              Brain event log
            </Button>
          </div>
          {error && (
            <p role="alert" className="px-4 py-3 text-xs text-destructive">
              {error}
            </p>
          )}
          {tab === "output" ? (
            <>
              <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground">
                <span>Live output</span>
                <div className="flex gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-pressed={paused}
                    onClick={() => setPaused(!paused)}
                  >
                    {paused ? "Resume scrolling" : "Pause scrolling"}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setOutput("")}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <pre
                ref={log}
                role="log"
                aria-label="Robot output"
                aria-live="off"
                className="min-h-0 flex-1 overflow-auto px-4 pb-4 font-mono text-xs break-words whitespace-pre-wrap"
              >
                {output || (
                  <span className="text-muted-foreground">
                    {connection
                      ? "Waiting for program output…"
                      : "Program output will appear here."}
                  </span>
                )}
              </pre>
              <form
                className="flex gap-2 border-t p-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  const text = input
                  void action(async (current) => {
                    await writeUser(
                      current,
                      new TextEncoder().encode(text + "\n")
                    )
                    setInput((value) => (value === text ? "" : value))
                  })
                }}
              >
                <Input
                  aria-label="Console command"
                  placeholder="Send a command…"
                  value={input}
                  disabled={disabled}
                  onChange={(event) => setInput(event.target.value)}
                  className="font-mono text-xs"
                />
                <Button
                  type="submit"
                  size="icon"
                  variant="outline"
                  disabled={disabled || !input}
                  aria-label="Send command"
                >
                  <ArrowRightIcon />
                </Button>
              </form>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-xs text-muted-foreground">
                  Latest 20 recorded events
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={disabled}
                  onClick={() =>
                    void action(async (current) => {
                      const { count } = await current.request(logStatus())
                      setEvents(
                        count
                          ? (
                              await current.request(
                                logRead(
                                  Math.min(count, 20),
                                  Math.min(count, 20)
                                )
                              )
                            ).entries
                          : []
                      )
                    })
                  }
                >
                  {pending ? "Reading…" : "Refresh"}
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-4">
                {events === null ? (
                  <p className="text-xs text-muted-foreground">
                    Refresh to read the brain’s recorded event log.
                  </p>
                ) : events.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No recorded events.
                  </p>
                ) : (
                  <table className="w-full text-left font-mono text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="py-2">Uptime</th>
                        <th>Code</th>
                        <th>Type</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((entry, i) => (
                        <tr key={i} className="border-b">
                          <td className="py-2">
                            {(entry.time / 1000).toFixed(3)}s
                          </td>
                          <td>{entry.code}</td>
                          <td>{entry.type}</td>
                          <td>{entry.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <p className="p-4 text-xs text-muted-foreground">
                Event codes are shown as reported by VEXos. Their meanings are
                undocumented upstream.
              </p>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
