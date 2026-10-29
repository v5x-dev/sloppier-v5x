import { createPortal } from "react-dom"
import { ActionTooltip } from "@/components/shared/action-tooltip"
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { useAction } from "convex/react"
import { api } from "@v5x/backend/api"
import type { Id } from "@v5x/backend/dataModel"
import { Button } from "@v5x/ui/components/button"
import { Input } from "@v5x/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v5x/ui/components/select"
import {
  CaretDownIcon,
  CaretUpIcon,
  DownloadSimpleIcon,
  EyeIcon,
  EyeSlashIcon,
  PathIcon,
  XIcon,
} from "@phosphor-icons/react"
import { cn } from "@v5x/ui/lib/utils"
import { parseAutonPaths, type AutonTemplate } from "@/lib/auton-paths"
import { pathPoseAt } from "@/lib/path-animation"
import { exportPathGif } from "@/lib/export-path-gif"
import { errorMessage } from "@/lib/errors"
import type { WorkbenchSource } from "@/lib/workbench-source"

const fields = ["H2H", "Skills"].map((setup) => ({
  label: `Override · ${setup}`,
  image: `https://field-rendering.jerryio.com/renders/V5RC-Override-${setup}-TopDown-TileColor66_71@0.1+500px.png`,
  exportImage: `/fields/override-${setup.toLowerCase()}-uniform.png`,
}))
const extent = 3690 / 25.4
const project = (x: number, y: number) =>
  `${50 + (x / extent) * 100},${50 - (y / extent) * 100}`
const templateNames: Record<AutonTemplate, { label: string; hint: string }> = {
  "ez-template": {
    label: "EZ-Template",
    hint: "Add pid_drive_set or pid_odom_set calls inside a void function.",
  },
  jar: {
    label: "JAR-Template",
    hint: "Add drive_distance or drive_to_point calls inside a void function.",
  },
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

export function ProgramPathPreview({
  programId,
  revision,
  template,
  paths,
  drafts,
  cursor,
}: {
  cursor: { path: string; line: number } | null
  programId: Id<"programs">
  revision?: string
  template: AutonTemplate
  paths: string[] | null
  drafts: Pick<
    WorkbenchSource,
    "getDrafts" | "subscribeDrafts" | "getDraftVersion"
  >
}) {
  const readFile = useAction(api.codeStorage.readFile)
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<Map<string, string> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const draftVersion = useSyncExternalStore(
    drafts.subscribeDrafts,
    drafts.getDraftVersion
  )
  const [retry, setRetry] = useState(0)
  const [selected, setSelected] = useState("")
  const [field, setField] = useState("0")
  const [trackWidth, setTrackWidth] = useState(12)
  const [robotWidth, setRobotWidth] = useState(12)
  const [robotLength, setRobotLength] = useState(12)
  const [elapsed, setElapsed] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [imageError, setImageError] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(true)
  const [robotVisible, setRobotVisible] = useState(true)
  const optionsId = useId()
  const panel = useRef<HTMLElement>(null)
  // Null keeps the default bottom-right anchor until the panel is first dragged.
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null
  )
  const dragStart = useRef<{
    pointerX: number
    pointerY: number
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  useEffect(() => {
    const keepOnScreen = () => {
      const rect = panel.current?.getBoundingClientRect()
      if (!rect) return
      setPosition(
        (current) =>
          current && {
            x: clamp(current.x, 0, window.innerWidth - rect.width),
            y: clamp(current.y, 0, window.innerHeight - rect.height),
          }
      )
    }
    window.addEventListener("resize", keepOnScreen)
    return () => window.removeEventListener("resize", keepOnScreen)
  }, [])
  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    // Let the header's buttons receive their own clicks.
    if (event.button !== 0 || !event.isPrimary) return
    if ((event.target as HTMLElement).closest("button")) return
    const rect = panel.current?.getBoundingClientRect()
    if (!rect) return
    // Prevent native text selection/dragging from competing with pointer capture.
    event.preventDefault()
    dragStart.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStart.current
    if (!start) return
    setPosition({
      x: clamp(
        start.x + event.clientX - start.pointerX,
        0,
        window.innerWidth - start.width
      ),
      y: clamp(
        start.y + event.clientY - start.pointerY,
        0,
        window.innerHeight - start.height
      ),
    })
  }
  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    dragStart.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  useEffect(() => {
    if (!open || !paths) return
    const controller = new AbortController()
    setError(null)
    void (async () => {
      const source = new Map<string, string>()
      // Exclude vendored libraries, but include user headers and nested source folders.
      const candidates = paths.filter(
        (path) =>
          /\.(cpp|cc|cxx|h|hpp)$/.test(path) &&
          !/(^|\/)(?:EZ-Template|JAR-Template|pros|node_modules|\.git)\//i.test(
            path
          )
      )
      for (const path of candidates) {
        const { bytes, contentRange } = await readFile({
          programId,
          path,
          ref: revision,
          length: 512 * 1024,
        })
        if (controller.signal.aborted) return
        const total = Number(contentRange?.split("/").at(-1))
        if (total > bytes.byteLength)
          throw new Error(`${path} is too large to preview completely.`)
        source.set(
          path,
          new TextDecoder("utf-8", { fatal: true }).decode(bytes)
        )
      }
      if (!controller.signal.aborted) setFiles(source)
    })().catch((reason) => {
      if (!controller.signal.aborted) setError(errorMessage(reason))
    })
    return () => {
      controller.abort()
    }
  }, [open, paths, programId, revision, readFile, retry])
  const routes = useMemo(() => {
    const source = new Map(
      [...(files ?? [])].filter(([path]) => paths?.includes(path))
    )
    for (const [path, text] of drafts.getDrafts())
      if (paths?.includes(path)) source.set(path, text)
    return parseAutonPaths(source, template, trackWidth)
  }, [files, drafts, paths, template, draftVersion, trackWidth])
  const route = routes.find((item) => item.id === selected) ?? routes.at(0)
  useEffect(() => {
    if (!open || !route) return
    let frame: number
    const started = performance.now()
    const tick = (now: number) => {
      setElapsed((now - started) / 1000)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [open, route])
  const robot = route && pathPoseAt(route.points, elapsed)
  const segments: string[][] = []
  for (const point of route?.points ?? []) {
    if (point.start || !segments.length) segments.push([])
    segments.at(-1)!.push(project(point.x, point.y))
  }
  return (
    <>
      <ActionTooltip label="Preview autonomous paths">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Preview autonomous paths"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <PathIcon />
        </Button>
      </ActionTooltip>
      {open &&
        createPortal(
          <section
            ref={panel}
            aria-label="Autonomous path preview"
            style={position ? { left: position.x, top: position.y } : undefined}
            className={cn(
              "fixed z-30 flex max-h-[calc(100svh-5rem)] w-80 max-w-[calc(100vw-2rem)] resize flex-col gap-2 overflow-auto rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl",
              !position && "right-4 bottom-14"
            )}
          >
            <div
              className="flex shrink-0 cursor-grab touch-none items-center justify-between gap-2 select-none active:cursor-grabbing"
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={() => {
                dragStart.current = null
              }}
              onDragStart={(event) => event.preventDefault()}
            >
              <span className="text-sm font-medium">Auton paths</span>
              <div className="flex items-center">
                <ActionTooltip label="Export path GIF">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Export path GIF"
                    disabled={!route || exporting || imageError}
                    onClick={() => {
                      if (!route || !panel.current) return
                      const styles = getComputedStyle(panel.current)
                      setExporting(true)
                      setExportError(null)
                      void exportPathGif({
                        route,
                        fieldImage: fields[Number(field)].exportImage,
                        robotWidth,
                        robotLength,
                        robotVisible,
                        primary: styles.getPropertyValue("--primary").trim(),
                        startColor: styles.getPropertyValue("--chart-3").trim(),
                        foreground: styles
                          .getPropertyValue("--foreground")
                          .trim(),
                        background: styles
                          .getPropertyValue("--background")
                          .trim(),
                      })
                        .catch((reason) => setExportError(errorMessage(reason)))
                        .finally(() => setExporting(false))
                    }}
                  >
                    <DownloadSimpleIcon />
                  </Button>
                </ActionTooltip>
                <ActionTooltip
                  label={robotVisible ? "Hide robot" : "Show robot"}
                >
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={robotVisible ? "Hide robot" : "Show robot"}
                    aria-pressed={robotVisible}
                    onClick={() => setRobotVisible(!robotVisible)}
                  >
                    {robotVisible ? <EyeIcon /> : <EyeSlashIcon />}
                  </Button>
                </ActionTooltip>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={
                    optionsOpen ? "Collapse options" : "Expand options"
                  }
                  aria-expanded={optionsOpen}
                  aria-controls={optionsId}
                  onClick={() => setOptionsOpen(!optionsOpen)}
                >
                  {optionsOpen ? <CaretUpIcon /> : <CaretDownIcon />}
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Close path preview"
                  onClick={() => setOpen(false)}
                >
                  <XIcon />
                </Button>
              </div>
            </div>
            {optionsOpen && (
              <div id={optionsId} className="flex shrink-0 flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex min-w-0 flex-col gap-1 text-xs">
                    <span className="text-muted-foreground">Field</span>
                    <Select
                      value={field}
                      items={fields.map((item, index) => ({
                        value: String(index),
                        label: item.label,
                      }))}
                      onValueChange={(value) => {
                        if (value === null) return
                        setField(value)
                        setImageError(false)
                      }}
                    >
                      <SelectTrigger
                        aria-label="Field"
                        className="w-full min-w-0"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {fields.map((item, index) => (
                          <SelectItem key={item.label} value={String(index)}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  {routes.length > 0 && (
                    <label className="flex min-w-0 flex-col gap-1 text-xs">
                      <span className="text-muted-foreground">Route</span>
                      <Select
                        value={route?.id ?? ""}
                        items={routes.map((item) => ({
                          value: item.id,
                          label: item.name,
                        }))}
                        onValueChange={(value) => {
                          if (value !== null) setSelected(value)
                        }}
                      >
                        <SelectTrigger
                          aria-label="Route"
                          className="w-full min-w-0"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {routes.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      [
                        "Track",
                        "Track width in inches",
                        trackWidth,
                        setTrackWidth,
                      ],
                      [
                        "Width",
                        "Drive base width in inches",
                        robotWidth,
                        setRobotWidth,
                      ],
                      [
                        "Length",
                        "Drive base length in inches",
                        robotLength,
                        setRobotLength,
                      ],
                    ] as const
                  ).map(([label, accessibleLabel, value, setValue]) => (
                    <label
                      key={label}
                      className="flex min-w-0 flex-col gap-1 text-xs"
                    >
                      <span className="text-muted-foreground">{label}</span>
                      <Input
                        aria-label={accessibleLabel}
                        type="number"
                        min="1"
                        max="36"
                        step="0.25"
                        value={value}
                        className="w-full min-w-0"
                        onChange={(event) => {
                          const next = event.target.valueAsNumber
                          if (Number.isFinite(next) && next >= 1 && next <= 36)
                            setValue(next)
                        }}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
            {exporting && (
              <p role="status" className="text-xs text-muted-foreground">
                Exporting GIF…
              </p>
            )}
            {exportError && (
              <p role="alert" className="text-xs text-destructive">
                Could not export GIF: {exportError}
              </p>
            )}
            {error && (
              <div className="text-xs text-destructive">
                {error}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRetry(retry + 1)}
                >
                  Retry
                </Button>
              </div>
            )}
            {!files && !error ? (
              <p className="text-xs text-muted-foreground" role="status">
                Reading program source…
              </p>
            ) : files && !route ? (
              <p className="text-xs text-muted-foreground">
                No {templateNames[template].label} motion routines found.{" "}
                {templateNames[template].hint}
              </p>
            ) : route ? (
              <>
                <div className="relative aspect-square min-h-16 shrink overflow-hidden rounded border bg-muted">
                  <img
                    src={fields[Number(field)].image}
                    alt={fields[Number(field)].label}
                    draggable={false}
                    className="absolute inset-0 size-full object-contain"
                    onError={() => setImageError(true)}
                  />
                  <svg
                    viewBox="0 0 100 100"
                    className="absolute inset-0 size-full"
                    role="img"
                    aria-label={`Path for ${route.name}. Field center is 0, 0; positive Y points up.`}
                  >
                    {segments.map((segment, index) => (
                      <polyline
                        key={index}
                        points={segment.join(" ")}
                        fill="none"
                        stroke="var(--primary)"
                        strokeWidth="1"
                        strokeLinejoin="round"
                      />
                    ))}
                    {route.points.map(
                      (point, index) =>
                        !point.interpolated && (
                          <g
                            key={index}
                            transform={`translate(${project(point.x, point.y).replace(",", " ")})`}
                          >
                            <circle
                              r={point.start ? 1.8 : 0.9}
                              fill={
                                point.start
                                  ? "var(--chart-3)"
                                  : "var(--primary)"
                              }
                              stroke="var(--background)"
                              strokeWidth="0.3"
                            >
                              <title>{`${index}: (${point.x.toFixed(1)}, ${point.y.toFixed(1)}) ${point.heading.toFixed(0)}°`}</title>
                            </circle>
                            <path
                              d="M 0 0 L 0 -3"
                              stroke="var(--foreground)"
                              strokeWidth="0.5"
                              transform={`rotate(${point.heading})`}
                            />
                          </g>
                        )
                    )}
                    {robotVisible && robot && (
                      <g
                        transform={`translate(${project(robot.x, robot.y).replace(",", " ")}) rotate(${robot.heading})`}
                      >
                        <rect
                          x={(-robotWidth / extent) * 50}
                          y={(-robotLength / extent) * 50}
                          width={(robotWidth / extent) * 100}
                          height={(robotLength / extent) * 100}
                          fill="var(--primary)"
                          fillOpacity="0.4"
                          stroke="var(--primary)"
                          strokeWidth="0.6"
                        />
                        <path
                          d="M -1 -2 L 0 -3 L 1 -2"
                          fill="none"
                          stroke="var(--foreground)"
                          strokeWidth="0.5"
                        />
                      </g>
                    )}
                    {route.points.map(
                      (point, index) =>
                        !point.interpolated &&
                        cursor &&
                        point.source?.file === cursor.path &&
                        point.source.line === cursor.line && (
                          <g
                            key={`selected-${index}`}
                            transform={`translate(${project(point.x, point.y).replace(",", " ")})`}
                          >
                            <circle
                              r="1.1"
                              fill="var(--chart-4)"
                              stroke="white"
                              strokeWidth="0.3"
                            />
                          </g>
                        )
                    )}
                  </svg>
                </div>
                {imageError && (
                  <p className="text-xs text-destructive">
                    Field image failed to load. Choose another field or reopen
                    the preview.
                  </p>
                )}
                {route.warnings.map((warning) => (
                  <p key={warning} className="text-xs text-muted-foreground">
                    {warning}
                  </p>
                ))}
              </>
            ) : null}
            <a
              href="https://field-rendering.jerryio.com/"
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-[10px] text-muted-foreground underline"
            >
              Field renders by JerryIO · CC BY 4.0
            </a>
          </section>,
          document.body
        )}
    </>
  )
}
