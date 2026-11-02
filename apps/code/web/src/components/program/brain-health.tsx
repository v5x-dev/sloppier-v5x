import { useCallback, useEffect, useState } from "react"
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  BatteryEmptyIcon,
  BatteryLowIcon,
  BatteryMediumIcon,
  BatteryHighIcon,
  BatteryFullIcon,
} from "@phosphor-icons/react"
import {
  deviceInventory,
  systemFlags,
  systemStatus,
  type Connection,
} from "@v5x/serial"
import { Button } from "@v5x/ui/components/button"
import { errorMessage } from "@/lib/errors"

type Health = {
  firmware: string | null
  battery: number
  devices: Array<{ port: number; type: number; status: number }>
}

type IO = (
  action: (connection: Connection) => Promise<void>
) => Promise<boolean>

export function BrainHealth({
  connection,
  io,
  busy,
}: {
  connection: Connection
  io: IO
  busy: boolean
}) {
  const [health, setHealth] = useState<Health | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    setPending(true)
    setError(null)
    try {
      const read = await io(async (current) => {
        if (current !== connection) return
        const status = await current.request(systemStatus())
        const flags = await current.request(systemFlags())
        const devices = await current.request(deviceInventory())
        const v = status.systemVersion
        setHealth({
          firmware: v
            ? `${v.major}.${v.minor}.${v.build}${v.beta ? ` beta ${v.beta}` : ""}`
            : null,
          battery: Math.min(100, (flags.byte1 >> 4) * 8),
          devices,
        })
      })
      if (!read) setError("The Brain is busy. Try again when it is ready.")
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }, [connection, io])
  useEffect(() => {
    if (!busy && !health && !pending && !error) void refresh()
  }, [busy, health, pending, error, refresh])
  const devices =
    health?.devices.filter(
      (d) => d.port >= 1 && d.port <= 21 && d.type !== 0
    ) ?? []
  const BatteryIcon =
    !health || health.battery <= 8
      ? BatteryEmptyIcon
      : health.battery <= 24
        ? BatteryLowIcon
        : health.battery <= 48
          ? BatteryMediumIcon
          : health.battery <= 80
            ? BatteryHighIcon
            : BatteryFullIcon
  return (
    <section
      aria-label="Brain health"
      className="rounded-lg border px-2.5 py-1.5"
    >
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-xs font-medium group-open:border-b group-open:pb-2 [&::-webkit-details-marker]:hidden">
          Brain
          {health && (
            <span className="flex items-center gap-1 font-normal text-muted-foreground">
              <BatteryIcon
                aria-hidden="true"
                className={
                  health.battery <= 24 ? "size-4 text-destructive" : "size-4"
                }
              />
              <span>
                <span className="sr-only">Battery </span>
                {health.battery}%
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <span className="sr-only">VEXos version </span>
                {health.firmware ?? "Unavailable"}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <span className="sr-only">Connected smart ports </span>
                {devices.length} ports
              </span>
            </span>
          )}
          <CaretDownIcon
            aria-hidden="true"
            className="ml-auto size-3 shrink-0 transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="space-y-1 pt-1 pb-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Brain health</span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Refresh Brain health"
              disabled={busy || pending}
              onClick={() => void refresh()}
            >
              <ArrowClockwiseIcon
                className={pending ? "animate-spin" : undefined}
              />
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              Could not read Brain health: {error}
            </p>
          )}
          {!health && !error && (
            <p role="status" className="text-xs text-muted-foreground">
              {busy ? "Waiting for the Brain…" : "Reading Brain health…"}
            </p>
          )}
          {health && (
            <>
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium">Smart ports</span>
                <span className="text-muted-foreground">
                  {devices.length} connected
                </span>
              </div>
              <div className="max-h-24 overflow-y-auto">
                {devices.length ? (
                  devices.map((d) => (
                    <div key={d.port} className="flex items-center gap-2 py-1">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted font-mono text-xs">
                        {d.port}
                      </span>
                      <span className="min-w-0 flex-1 text-xs">
                        {deviceName(d.type)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="py-1 text-xs text-muted-foreground">
                    No smart port devices reported.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </details>
      {health && health.battery <= 24 && (
        <p className="text-xs text-destructive">
          Charge the Brain battery before use.
        </p>
      )}
    </section>
  )
}

function deviceName(type: number) {
  const names: Record<number, string> = {
    2: "Motor",
    3: "LED",
    4: "Rotation sensor",
    5: "Motor",
    6: "Inertial sensor",
    7: "Distance sensor",
    8: "Radio",
    11: "Vision sensor",
    12: "3-Wire Expander",
    16: "Optical sensor",
    17: "Electromagnet",
    20: "GPS sensor",
    26: "AI camera",
    27: "Light tower",
    28: "Arm",
    29: "AI Vision sensor",
    30: "Pneumatics",
    128: "Generic sensor",
    129: "Serial device",
  }
  return names[type] ?? `Device type ${type}`
}
