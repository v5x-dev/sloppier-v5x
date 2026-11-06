// What to do with the selection: its size and connections, the actions on it, and exact
// values typed in. It sits over the bottom of the 3D view and only appears with a selection.

import {
  CopyIcon,
  LinkIcon,
  LinkBreakIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { Button } from "@v5x/ui/components/button"
import { Input } from "@v5x/ui/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@v5x/ui/components/native-select"
import { useState } from "react"
import type { Vec3 } from "@/catalog/types"

export const PALETTE: { name: string; color: string }[] = [
  { name: "Aluminum", color: "#c4cad3" },
  { name: "Steel", color: "#7f8691" },
  { name: "Nylon", color: "#e3dac3" },
  { name: "Black", color: "#2d3138" },
  { name: "Red", color: "#d9493b" },
  { name: "Yellow", color: "#f2c14e" },
  { name: "Green", color: "#67b56f" },
  { name: "Blue", color: "#5b8fe0" },
]

const AXIS_NAMES = ["X", "Y", "Z"] as const

export type SelectionFacts = {
  count: number
  /** Connections that touch the selection. */
  connections: number
  /** Whether a screw or shaft is selected, so Connect has something to join. */
  fastener: boolean
  /** The one selected Part's position, when exactly one is selected. */
  position?: Vec3
  /** A readable name for the selection, such as "Motor" or "3 Parts". */
  title: string
}

export type SelectionPanelProps = {
  facts: SelectionFacts
  pivots: { id: string; label: string }[]
  pivot: string | undefined
  onPivot: (id: string | undefined) => void
  angleStepDeg: number
  onAngleStep: (deg: number) => void
  onMoveBy: (delta: Vec3) => void
  onMoveTo: (position: Vec3) => void
  onTurn: (degrees: number, axis: number) => void
  onDuplicate: () => void
  onDelete: () => void
  onRecolor: (color: string) => void
  onConnect: () => void
  onDisconnect: () => void
}

export function SelectionPanel(props: SelectionPanelProps) {
  const { facts } = props
  return (
    <section
      aria-label="Selection"
      className="flex w-full max-w-3xl flex-col gap-2 rounded-lg border border-border bg-background/95 p-3 text-sm shadow-sm backdrop-blur-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto min-w-0 truncate font-medium">
          {facts.title}
          <span className="ml-2 font-normal text-muted-foreground">
            {facts.connections === 0
              ? "not connected"
              : `${facts.connections} connection${facts.connections === 1 ? "" : "s"}`}
          </span>
        </p>
        <Button variant="ghost" size="sm" onClick={props.onDuplicate}>
          <CopyIcon /> Duplicate
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onDelete}>
          <TrashIcon /> Delete
        </Button>
        {facts.fastener && (
          <Button variant="ghost" size="sm" onClick={props.onConnect}>
            <LinkIcon /> Connect
          </Button>
        )}
        {facts.connections > 0 && (
          <Button variant="ghost" size="sm" onClick={props.onDisconnect}>
            <LinkBreakIcon /> Disconnect
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Colour</span>
        {PALETTE.map((swatch) => (
          <button
            key={swatch.color}
            type="button"
            aria-label={swatch.name}
            title={swatch.name}
            onClick={() => props.onRecolor(swatch.color)}
            className="size-5 rounded-full border border-border ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            style={{ backgroundColor: swatch.color }}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-t border-border pt-2">
        <MoveBy onMoveBy={props.onMoveBy} />
        {facts.position && (
          <PositionFields position={facts.position} onMoveTo={props.onMoveTo} />
        )}
        <TurnBy
          onTurn={props.onTurn}
          aboutFastener={props.pivot !== undefined}
        />
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Snap turns to
            <NativeSelect
              value={String(props.angleStepDeg)}
              onChange={(event) =>
                props.onAngleStep(Number(event.target.value))
              }
              aria-label="Snap turns to"
            >
              {[1, 15, 45, 90].map((deg) => (
                <NativeSelectOption key={deg} value={String(deg)}>
                  {deg}°
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          {props.pivots.length > 0 && (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Turn about
              <NativeSelect
                value={props.pivot ?? ""}
                onChange={(event) =>
                  props.onPivot(
                    event.target.value === "" ? undefined : event.target.value
                  )
                }
                aria-label="Turn about"
              >
                <NativeSelectOption value="">
                  The selection&apos;s centre
                </NativeSelectOption>
                {props.pivots.map((pivot) => (
                  <NativeSelectOption key={pivot.id} value={pivot.id}>
                    {pivot.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          )}
        </div>
      </div>
    </section>
  )
}

function MoveBy({ onMoveBy }: { onMoveBy: (delta: Vec3) => void }) {
  const [text, setText] = useState<[string, string, string]>(["0", "0", "0"])
  const values = text.map((t) => Number(t))
  const valid = values.every((v) => Number.isFinite(v))
  const apply = () => {
    if (!valid) return
    if (values.every((v) => v === 0)) return
    onMoveBy([values[0], values[1], values[2]])
    setText(["0", "0", "0"])
  }
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        apply()
      }}
    >
      <span className="pb-2 text-xs text-muted-foreground">Move by (mm)</span>
      {AXIS_NAMES.map((axis, i) => (
        <label
          key={axis}
          className="flex flex-col gap-1 text-xs text-muted-foreground"
        >
          {axis}
          <Input
            className="h-7 w-20"
            inputMode="decimal"
            aria-label={`Move by ${axis} in millimetres`}
            value={text[i]}
            onChange={(event) => {
              const next = [...text] as [string, string, string]
              next[i] = event.target.value
              setText(next)
            }}
          />
        </label>
      ))}
      <Button type="submit" size="sm" variant="secondary" disabled={!valid}>
        Move
      </Button>
    </form>
  )
}

function PositionFields({
  position,
  onMoveTo,
}: {
  position: Vec3
  onMoveTo: (position: Vec3) => void
}) {
  const [text, setText] = useState<[string, string, string]>([
    position[0].toFixed(1),
    position[1].toFixed(1),
    position[2].toFixed(1),
  ])
  const values = text.map((t) => Number(t))
  const valid = values.every((v) => Number.isFinite(v))
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (valid) onMoveTo([values[0], values[1], values[2]])
      }}
    >
      <span className="pb-2 text-xs text-muted-foreground">Position (mm)</span>
      {AXIS_NAMES.map((axis, i) => (
        <label
          key={axis}
          className="flex flex-col gap-1 text-xs text-muted-foreground"
        >
          {axis}
          <Input
            className="h-7 w-20"
            inputMode="decimal"
            aria-label={`Position ${axis} in millimetres`}
            value={text[i]}
            onChange={(event) => {
              const next = [...text] as [string, string, string]
              next[i] = event.target.value
              setText(next)
            }}
          />
        </label>
      ))}
      <Button type="submit" size="sm" variant="secondary" disabled={!valid}>
        Set
      </Button>
    </form>
  )
}

function TurnBy({
  onTurn,
  aboutFastener,
}: {
  onTurn: (degrees: number, axis: number) => void
  aboutFastener: boolean
}) {
  const [degrees, setDegrees] = useState("90")
  const [axis, setAxis] = useState(1)
  const value = Number(degrees)
  const valid = Number.isFinite(value) && value !== 0
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (valid) onTurn(value, axis)
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Turn by (°)
        <Input
          className="h-7 w-20"
          inputMode="decimal"
          aria-label="Turn by degrees"
          value={degrees}
          onChange={(event) => setDegrees(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {aboutFastener ? "Fastener axis" : "Around"}
        {aboutFastener ? (
          <span className="flex h-7 items-center px-2 text-foreground">
            Selected screw or shaft
          </span>
        ) : (
          <NativeSelect
            value={String(axis)}
            onChange={(event) => setAxis(Number(event.target.value))}
            aria-label="Turn around axis"
          >
            {AXIS_NAMES.map((name, i) => (
              <NativeSelectOption key={name} value={String(i)}>
                {name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={!valid}>
        Turn
      </Button>
    </form>
  )
}
