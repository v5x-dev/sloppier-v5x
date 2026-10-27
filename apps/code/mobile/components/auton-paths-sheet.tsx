import { useEffect, useMemo, useState } from "react"
import { Image, View, useWindowDimensions } from "react-native"
import Svg, { Circle, G, Path, Polyline } from "react-native-svg"
import {
  BottomSheet,
  Column,
  Host,
  Picker,
  RNHostView,
  Row,
  ScrollView,
  Slider,
} from "@expo/ui"
import { Buffer } from "buffer"
import { useAction, useConvex } from "convex/react"
import { api } from "@workspace/backend/api"
import type { Id } from "@workspace/backend/dataModel"
import { SheetText, SheetTitle, useSheetColors } from "@/components/sheet-ui"
import { parseAutonPaths, type AutonTemplate } from "@/lib/auton-paths"
import { usePendingEdits } from "@/lib/pending-edits"
import { readLiveText } from "@/lib/read-live-text"
import { retryOnReconnect } from "@/lib/retry"
import { useThemeTokens } from "@/lib/theme-tokens"

// Same field renders and projection as the web preview.
const fields = ["H2H", "Skills"].map((setup) => ({
  label: `Override · ${setup}`,
  image: `https://field-rendering.jerryio.com/renders/V5RC-Override-${setup}-TopDown-TileColor66_71@0.1+500px.png`,
}))
const extent = 3690 / 25.4
const project = (x: number, y: number) =>
  [50 + (x / extent) * 100, 50 - (y / extent) * 100] as const
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
// Vendored libraries are skipped; user headers and nested folders count.
const isSource = (path: string) =>
  /\.(cpp|cc|cxx|h|hpp)$/.test(path) &&
  !/(^|\/)(?:EZ-Template|JAR-Template|pros|node_modules|\.git)\//i.test(path)

export function AutonPathsSheet({
  isPresented,
  programId,
  template,
  onDismiss,
}: {
  isPresented: boolean
  programId: Id<"programs">
  template: AutonTemplate
  onDismiss: () => void
}) {
  const colors = useSheetColors()
  const tokens = useThemeTokens()
  const client = useConvex()
  const listFiles = useAction(api.codeStorage.listFiles)
  const readFile = useAction(api.codeStorage.readFile)
  const pending = usePendingEdits(programId)
  const { width } = useWindowDimensions()
  const [files, setFiles] = useState<Map<string, string> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState("")
  const [field, setField] = useState(0)
  const [trackWidth, setTrackWidth] = useState(12)
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    if (!isPresented) return
    let cancelled = false
    setFiles(null)
    setError(null)
    void (async () => {
      const paths: string[] = []
      let cursor: string | undefined
      do {
        const page = await retryOnReconnect(() =>
          listFiles({ programId, cursor })
        )
        paths.push(...page.paths)
        cursor = page.hasMore ? page.nextCursor : undefined
      } while (cursor)
      const source = new Map<string, string>()
      for (const path of paths.filter(isSource)) {
        // Uncommitted edits come from the live document, like the web drafts.
        if (pending.includes(path)) {
          source.set(path, await readLiveText(client, programId, path))
        } else {
          const { bytes, contentRange } = await retryOnReconnect(() =>
            readFile({ programId, path, length: 512 * 1024 })
          )
          const total = Number(contentRange?.split("/").at(-1))
          if (total > bytes.byteLength)
            throw new Error(`${path} is too large to preview completely.`)
          source.set(path, Buffer.from(bytes).toString("utf8"))
        }
        if (cancelled) return
      }
      if (!cancelled) setFiles(source)
    })().catch((cause) => {
      if (!cancelled)
        setError(
          cause instanceof Error ? cause.message : "Could not read the program."
        )
    })
    return () => {
      cancelled = true
    }
  }, [isPresented, programId, pending, client, listFiles, readFile])

  const routes = useMemo(
    () => (files ? parseAutonPaths(files, template, trackWidth) : []),
    [files, template, trackWidth]
  )
  const route = routes.find((item) => item.id === selected) ?? routes.at(0)
  const segments: string[][] = []
  for (const point of route?.points ?? []) {
    if (point.start || !segments.length) segments.push([])
    segments.at(-1)!.push(project(point.x, point.y).join(","))
  }
  const size = Math.min(width - 40, 520)

  return (
    <Host>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={onDismiss}
        snapPoints={["full"]}
        containerColor={colors.background}
      >
        <ScrollView>
          <Column spacing={12} style={{ padding: 20 }} alignment="start">
            <SheetTitle title="Auton paths" colors={colors} />
            <Row spacing={12}>
              <Picker
                selectedValue={field}
                onValueChange={(value) => {
                  setField(value)
                  setImageError(false)
                }}
                appearance="menu"
              >
                {fields.map((item, index) => (
                  <Picker.Item
                    key={item.label}
                    label={item.label}
                    value={index}
                  />
                ))}
              </Picker>
              {routes.length ? (
                <Picker
                  selectedValue={route?.id ?? ""}
                  onValueChange={setSelected}
                  appearance="menu"
                >
                  {routes.map((item) => (
                    <Picker.Item
                      key={item.id}
                      label={item.name}
                      value={item.id}
                    />
                  ))}
                </Picker>
              ) : null}
            </Row>
            <SheetText colors={colors} muted>
              {`Track width ${trackWidth.toFixed(2)} in`}
            </SheetText>
            <Slider
              value={trackWidth}
              onValueChange={setTrackWidth}
              min={4}
              max={24}
              step={0.25}
            />
            {error ? (
              <SheetText colors={colors} error>
                {error}
              </SheetText>
            ) : !files ? (
              <SheetText colors={colors} muted>
                Reading program source…
              </SheetText>
            ) : !route ? (
              <SheetText colors={colors} muted>
                {`No ${templateNames[template].label} motion routines found. ${templateNames[template].hint}`}
              </SheetText>
            ) : (
              <RNHostView matchContents>
                <View
                  accessible
                  accessibilityLabel={`Path for ${route.name}. Field center is 0, 0; positive Y points up.`}
                  style={{
                    width: size,
                    height: size,
                    borderRadius: 8,
                    overflow: "hidden",
                    borderWidth: 1,
                    borderColor: tokens.border,
                    backgroundColor: tokens.muted,
                  }}
                >
                  <Image
                    source={{ uri: fields[field].image }}
                    style={{ position: "absolute", width: size, height: size }}
                    onError={() => setImageError(true)}
                  />
                  <Svg
                    width={size}
                    height={size}
                    viewBox="0 0 100 100"
                    style={{ position: "absolute" }}
                  >
                    {segments.map((segment, index) => (
                      <Polyline
                        key={index}
                        points={segment.join(" ")}
                        fill="none"
                        stroke={tokens.primary}
                        strokeWidth={1}
                        strokeLinejoin="round"
                      />
                    ))}
                    {route.points.map((point, index) => {
                      if (point.interpolated) return null
                      const [x, y] = project(point.x, point.y)
                      return (
                        <G key={index} transform={`translate(${x} ${y})`}>
                          <Circle
                            r={point.start ? 1.8 : 0.9}
                            fill={
                              point.start ? tokens.chart3 : tokens.primary
                            }
                            stroke={tokens.background}
                            strokeWidth={0.3}
                          />
                          <Path
                            d="M 0 0 L 0 -3"
                            stroke={tokens.foreground}
                            strokeWidth={0.5}
                            transform={`rotate(${point.heading})`}
                          />
                        </G>
                      )
                    })}
                  </Svg>
                </View>
              </RNHostView>
            )}
            {imageError ? (
              <SheetText colors={colors} error>
                Field image failed to load. Choose another field or reopen the
                preview.
              </SheetText>
            ) : null}
            {(route?.warnings ?? []).map((warning) => (
              <SheetText key={warning} colors={colors} muted>
                {warning}
              </SheetText>
            ))}
            <SheetText colors={colors} muted>
              Field renders by JerryIO · CC BY 4.0
            </SheetText>
          </Column>
        </ScrollView>
      </BottomSheet>
    </Host>
  )
}
