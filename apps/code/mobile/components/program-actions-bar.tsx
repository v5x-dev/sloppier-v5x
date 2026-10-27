import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react"
import { Platform, View } from "react-native"
import {
  BottomSheet,
  Button,
  Column,
  Host,
  List,
  ListItem,
  RNHostView,
  Row,
  Text,
  TextInput,
  useNativeState,
} from "@expo/ui"
import { glassEffect } from "@expo/ui/swift-ui/modifiers"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useRouter } from "expo-router"
import { useAction, useConvex } from "convex/react"
import {
  DownloadSimple,
  GitBranch,
  Hammer,
  MagnifyingGlass,
  PathIcon,
  Plug,
  PlugsConnected,
  TextAlignLeft,
  type Icon as PhosphorIcon,
} from "phosphor-react-native"
import { markCommitted, usePendingEdits } from "@/lib/pending-edits"
import { useThemeTokens } from "@/lib/theme-tokens"
import { retryOnReconnect } from "@/lib/retry"
import { ThemedList } from "@/components/themed-list"
import {
  PrimaryButton,
  rowModifiers,
  SectionLabel,
  SheetText,
  SheetTitle,
  useSheetColors,
} from "@/components/sheet-ui"
import { readLiveText } from "@/lib/read-live-text"
import { ConnectSheet } from "@/components/connect-sheet"
import { AutonPathsSheet } from "@/components/auton-paths-sheet"
import { useBrain } from "@/lib/brain"
import { api } from "@workspace/backend/api"
import type { Id } from "@workspace/backend/dataModel"
import type { FunctionReturnType } from "convex/server"

const buttonSize = 48
const iconSize = 20
const nativeGlass =
  Platform.OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 26

type Action = {
  key: string
  label: string
  icon: PhosphorIcon
  // Undefined while the action is not available on mobile yet.
  onPress?: () => void
}

// Vertical glass capsule of program actions, mirroring the web app's bottom
// bar: Format, Git (commit and history), Search, then Connect, Upload, Build
// and, for
// EZ-Template and JAR programs, Path preview.
export function ProgramActionsBar({
  programId,
  template,
}: {
  programId: Id<"programs">
  template: string
}) {
  const tokens = useThemeTokens()
  const colors = {
    foreground: tokens.foreground,
    mutedForeground: tokens.mutedForeground,
    muted: tokens.muted,
    border: tokens.border,
  }
  const insets = useSafeAreaInsets()
  const [sheet, setSheet] = useState<
    "search" | "git" | "connect" | "paths" | null
  >(null)
  const brain = useBrain()
  const pending = usePendingEdits(programId)
  const actions: Action[] = [
    { key: "format", label: "Format document", icon: TextAlignLeft },
    {
      key: "git",
      label: pending.length
        ? `Git: ${pending.length} uncommitted ${pending.length === 1 ? "file" : "files"}`
        : "Git",
      icon: GitBranch,
      onPress: () => setSheet("git"),
    },
    {
      key: "search",
      label: "Search",
      icon: MagnifyingGlass,
      onPress: () => setSheet("search"),
    },
    {
      key: "connect",
      label:
        brain.phase === "connected"
          ? `Connected to ${brain.name ?? "V5 Brain"}`
          : "Connect to V5 Brain",
      icon: brain.phase === "connected" ? PlugsConnected : Plug,
      onPress: () => setSheet("connect"),
    },
    { key: "upload", label: "Upload", icon: DownloadSimple },
    { key: "build", label: "Build", icon: Hammer },
    ...(template === "ez-template" || template === "jar"
      ? [
          {
            key: "paths",
            label: "Path preview",
            icon: PathIcon,
            onPress: () => setSheet("paths"),
          },
        ]
      : []),
  ]
  return (
    <>
      <View
        pointerEvents="box-none"
        style={{ position: "absolute", right: 16, bottom: insets.bottom + 16 }}
      >
        <Host matchContents>
          <Column
            spacing={0}
            style={{
              paddingVertical: 4,
              borderRadius: buttonSize / 2,
              ...(nativeGlass
                ? {}
                : {
                    backgroundColor: colors.muted,
                    borderColor: colors.border,
                    borderWidth: 1,
                  }),
            }}
            modifiers={
              nativeGlass
                ? [
                    glassEffect({
                      glass: { variant: "regular", interactive: true },
                      shape: "capsule",
                    }),
                  ]
                : undefined
            }
          >
            {actions.map((action) => (
              <Button
                key={action.key}
                variant="text"
                onPress={action.onPress}
                disabled={!action.onPress}
                style={{ width: buttonSize, height: buttonSize }}
              >
                <RNHostView matchContents>
                  <ActionIcon
                    icon={action.icon}
                    label={action.label}
                    color={
                      action.onPress
                        ? colors.foreground
                        : colors.mutedForeground
                    }
                    badge={action.key === "git" && pending.length > 0}
                  />
                </RNHostView>
              </Button>
            ))}
          </Column>
        </Host>
      </View>
      <SearchSheet
        isPresented={sheet === "search"}
        programId={programId}
        onDismiss={() => setSheet(null)}
      />
      <ConnectSheet
        isPresented={sheet === "connect"}
        onDismiss={() => setSheet(null)}
      />
      {template === "ez-template" || template === "jar" ? (
        <AutonPathsSheet
          isPresented={sheet === "paths"}
          programId={programId}
          template={template}
          onDismiss={() => setSheet(null)}
        />
      ) : null}
      <GitSheet
        isPresented={sheet === "git"}
        pending={pending}
        programId={programId}
        onDismiss={() => setSheet(null)}
      />
    </>
  )
}

// Phosphor glyph for a native bar button, with a dot for pending work.
function ActionIcon({
  icon: Glyph,
  label,
  color,
  badge,
}: {
  icon: PhosphorIcon
  label: string
  color: string
  badge?: boolean
}): ReactElement {
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        width: iconSize + 6,
        height: iconSize + 6,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Glyph size={iconSize} color={color} />
      {badge ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: "#EF5D32",
          }}
        />
      ) : null}
    </View>
  )
}

type SheetProps = {
  isPresented: boolean
  programId: Id<"programs">
  onDismiss: () => void
}

type SearchResult = FunctionReturnType<typeof api.codeStorage.searchProgram>
type SearchRow = { key: string; path: string; line: number; text: string }

function SearchSheet({ isPresented, programId, onDismiss }: SheetProps) {
  const colors = useSheetColors()
  const router = useRouter()
  const search = useAction(api.codeStorage.searchProgram)
  const input = useNativeState("")
  const [query, setQuery] = useState("")
  const [result, setResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const latest = useRef(0)
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResult(null)
      setError(null)
      return
    }
    // Debounce typing; ignore responses for older queries.
    const request = ++latest.current
    const timer = setTimeout(() => {
      setSearching(true)
      search({ programId, query: trimmed, matchCase: false })
        .then((value) => {
          if (request !== latest.current) return
          setResult(value)
          setError(null)
        })
        .catch((cause) => {
          if (request !== latest.current) return
          setError(cause instanceof Error ? cause.message : "Search failed.")
        })
        .finally(() => {
          if (request === latest.current) setSearching(false)
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [query, programId, search])
  const rows: SearchRow[] = (result?.files ?? []).flatMap((file) =>
    file.matches.map((match) => ({
      key: `${file.path}:${match.line}:${match.column}`,
      path: file.path,
      line: match.line,
      text: match.text.trim(),
    }))
  )
  const summary =
    error ??
    (searching
      ? "Searching…"
      : result
        ? `${rows.length} ${rows.length === 1 ? "match" : "matches"}${result.truncated ? " (more not shown)" : ""}`
        : "Search every file in the program.")
  return (
    <Host>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={onDismiss}
        snapPoints={["full"]}
        containerColor={colors.background}
      >
        <Column spacing={12} style={{ padding: 20 }}>
          <SheetTitle title="Search" colors={colors} />
          <TextInput
            value={input}
            onChangeText={setQuery}
            placeholder="Search in program"
            placeholderTextColor={colors.mutedForeground}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          <Text
            textStyle={{
              fontFamily: "Merriweather",
              fontSize: 12,
              color: error ? colors.destructive : colors.mutedForeground,
            }}
          >
            {summary}
          </Text>
        </Column>
        <ThemedList backgroundColor={colors.background}>
          <List.ForEach data={rows} keyExtractor={(row) => row.key} recycling>
            {({ item }) => (
              <ListItem
                onPress={() => {
                  onDismiss()
                  router.push({
                    pathname: "/programs/[program-id]/file",
                    params: { "program-id": programId, path: item.path },
                  })
                }}
                modifiers={rowModifiers(colors)}
              >
                <Column spacing={2} alignment="start">
                  <Text
                    numberOfLines={1}
                    textStyle={{
                      fontFamily: "JetBrainsMono-Regular",
                      fontSize: 13,
                      color: colors.foreground,
                    }}
                  >
                    {item.text}
                  </Text>
                  <Text
                    numberOfLines={1}
                    textStyle={{
                      fontFamily: "Merriweather",
                      fontSize: 12,
                      color: colors.mutedForeground,
                    }}
                  >
                    {`${item.path}:${item.line}`}
                  </Text>
                </Column>
              </ListItem>
            )}
          </List.ForEach>
        </ThemedList>
      </BottomSheet>
    </Host>
  )
}

type Commit = FunctionReturnType<
  typeof api.codeStorage.history
>["commits"][number]
type CommitFile = FunctionReturnType<
  typeof api.codeStorage.historyFiles
>[number]

function relativeDate(iso: string) {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  const units: [number, string][] = [
    [60 * 60 * 24 * 365, "year"],
    [60 * 60 * 24 * 30, "month"],
    [60 * 60 * 24, "day"],
    [60 * 60, "hour"],
    [60, "minute"],
  ]
  for (const [size, name] of units) {
    const count = Math.floor(seconds / size)
    if (count >= 1) return `${count} ${name}${count === 1 ? "" : "s"} ago`
  }
  return "just now"
}

function GitSheet({
  isPresented,
  programId,
  pending,
  onDismiss,
}: SheetProps & { pending: readonly string[] }) {
  const colors = useSheetColors()
  const client = useConvex()
  const commitFiles = useAction(api.codeStorage.commitFiles)
  const message = useNativeState("")
  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const history = useAction(api.codeStorage.history)
  const historyFiles = useAction(api.codeStorage.historyFiles)
  const [commits, setCommits] = useState<Commit[] | null>(null)
  const [cursor, setCursor] = useState<string>()
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [files, setFiles] = useState<Record<string, CommitFile[] | "loading">>(
    {}
  )
  const inFlight = useRef(false)
  const load = useCallback(
    async (next?: string) => {
      if (inFlight.current) return
      inFlight.current = true
      setLoading(true)
      try {
        const page = await retryOnReconnect(() =>
          history({ programId, cursor: next })
        )
        setCommits((current) => [
          ...(next ? (current ?? []) : []),
          ...page.commits,
        ])
        setCursor(page.nextCursor)
        setHasMore(page.hasMore)
        setError(null)
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Could not load history."
        )
      } finally {
        inFlight.current = false
        setLoading(false)
      }
    },
    [history, programId]
  )
  useEffect(() => {
    if (isPresented && commits === null) void load()
  }, [isPresented, commits, load])
  const toggle = (sha: string) => {
    setExpanded((current) => (current === sha ? null : sha))
    if (files[sha]) return
    setFiles((current) => ({ ...current, [sha]: "loading" }))
    historyFiles({ programId, sha })
      .then((list) => setFiles((current) => ({ ...current, [sha]: list })))
      .catch(() =>
        setFiles((current) => {
          const next = { ...current }
          delete next[sha]
          return next
        })
      )
  }
  const meta = (commit: Commit) =>
    `${commit.author} · ${relativeDate(commit.date)}`
  const statusColor = (state: string) =>
    state.startsWith("d")
      ? colors.destructive
      : state.startsWith("a")
        ? colors.primary
        : colors.mutedForeground
  const commit = async () => {
    if (committing || !pending.length) return
    const paths = [...pending]
    setCommitting(true)
    setCommitError(null)
    try {
      const changes = await Promise.all(
        paths.map(async (path) => ({
          operation: "put" as const,
          path,
          contents: await readLiveText(client, programId, path),
        }))
      )
      const typed = message.get().trim()
      const generated =
        paths.length === 1
          ? `Update ${paths[0]}`
          : `Update ${paths.length} files: ${paths.join(", ")}`
      await commitFiles({
        programId,
        message: (typed || generated).slice(0, 200),
        changes,
      })
      markCommitted(programId, paths)
      message.set("")
      // Show the new commit at the top.
      setCommits(null)
    } catch (cause) {
      setCommitError(
        cause instanceof Error ? cause.message : "Could not commit."
      )
    } finally {
      setCommitting(false)
    }
  }
  const mono = (size: number, color: string) => ({
    fontFamily: "JetBrainsMono-Regular",
    fontSize: size,
    color,
  })
  const plain = rowModifiers(colors, { separator: false })
  return (
    <Host>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={onDismiss}
        snapPoints={["half", "full"]}
        containerColor={colors.background}
      >
        <ThemedList backgroundColor={colors.background}>
          <ListItem
            modifiers={rowModifiers(colors, {
              separator: false,
              top: 20,
              bottom: 4,
            })}
          >
            <SheetTitle title="Git" colors={colors} />
          </ListItem>

          <ListItem
            modifiers={rowModifiers(colors, {
              separator: false,
              top: 16,
              bottom: 6,
            })}
          >
            <SectionLabel colors={colors}>
              {pending.length ? `Changes · ${pending.length}` : "Changes"}
            </SectionLabel>
          </ListItem>
          {pending.length ? (
            <>
              {pending.map((path) => (
                <ListItem
                  key={path}
                  modifiers={rowModifiers(colors, {
                    separator: false,
                    top: 3,
                    bottom: 3,
                  })}
                >
                  <Row spacing={10}>
                    <Text textStyle={mono(13, colors.primary)}>M</Text>
                    <Text
                      numberOfLines={1}
                      textStyle={mono(13, colors.foreground)}
                    >
                      {path}
                    </Text>
                  </Row>
                </ListItem>
              ))}
              <ListItem
                modifiers={rowModifiers(colors, {
                  separator: false,
                  top: 12,
                  bottom: 6,
                })}
              >
                <TextInput
                  value={message}
                  placeholder={
                    pending.length === 1
                      ? `Update ${pending[0]}`
                      : `Update ${pending.length} files`
                  }
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="sentences"
                />
              </ListItem>
              <ListItem modifiers={plain}>
                <PrimaryButton
                  label={
                    committing
                      ? "Committing…"
                      : `Commit ${pending.length} ${pending.length === 1 ? "file" : "files"}`
                  }
                  disabled={committing}
                  onPress={() => void commit()}
                  colors={colors}
                />
              </ListItem>
            </>
          ) : (
            <ListItem modifiers={plain}>
              <SheetText colors={colors} muted>
                No uncommitted changes.
              </SheetText>
            </ListItem>
          )}
          {commitError ? (
            <ListItem modifiers={plain}>
              <SheetText colors={colors} error>
                {commitError}
              </SheetText>
            </ListItem>
          ) : null}

          <ListItem
            modifiers={rowModifiers(colors, {
              separator: false,
              top: 24,
              bottom: 6,
            })}
          >
            <SectionLabel colors={colors}>History</SectionLabel>
          </ListItem>
          {error || (loading && !commits) ? (
            <ListItem modifiers={plain}>
              <SheetText colors={colors} muted={!error} error={Boolean(error)}>
                {error ?? "Loading history…"}
              </SheetText>
            </ListItem>
          ) : null}
          <List.ForEach
            data={commits ?? []}
            keyExtractor={(commit) => commit.sha}
          >
            {({ item }) => {
              const list = files[item.sha]
              return (
                <ListItem
                  onPress={() => toggle(item.sha)}
                  modifiers={rowModifiers(colors, { top: 12, bottom: 12 })}
                >
                  <Column spacing={4} alignment="start">
                    <Text
                      numberOfLines={2}
                      textStyle={{
                        fontFamily: "Merriweather",
                        fontSize: 15,
                        color: colors.foreground,
                      }}
                    >
                      {item.message.split("\n")[0]}
                    </Text>
                    <Row spacing={8}>
                      <Text
                        textStyle={{
                          fontFamily: "Merriweather",
                          fontSize: 12,
                          color: colors.mutedForeground,
                        }}
                      >
                        {meta(item)}
                      </Text>
                      <Text textStyle={mono(11, colors.mutedForeground)}>
                        {item.sha.slice(0, 7)}
                      </Text>
                    </Row>
                    {expanded === item.sha ? (
                      <Column
                        spacing={3}
                        alignment="start"
                        style={{ paddingTop: 6 }}
                      >
                        {!list || list === "loading" ? (
                          <Text textStyle={mono(12, colors.mutedForeground)}>
                            Loading files…
                          </Text>
                        ) : list.length ? (
                          list.map((file) => (
                            <Row key={file.path} spacing={10}>
                              <Text
                                textStyle={mono(
                                  12,
                                  statusColor(String(file.state))
                                )}
                              >
                                {String(file.state).slice(0, 1).toUpperCase()}
                              </Text>
                              <Text
                                numberOfLines={1}
                                textStyle={mono(12, colors.mutedForeground)}
                              >
                                {file.path}
                              </Text>
                            </Row>
                          ))
                        ) : (
                          <Text textStyle={mono(12, colors.mutedForeground)}>
                            No visible file changes.
                          </Text>
                        )}
                      </Column>
                    ) : null}
                  </Column>
                </ListItem>
              )
            }}
          </List.ForEach>
          {hasMore && cursor ? (
            <ListItem onPress={() => void load(cursor)} modifiers={plain}>
              <SheetText colors={colors} muted>
                {loading ? "Loading…" : "Load older commits"}
              </SheetText>
            </ListItem>
          ) : null}
        </ThemedList>
      </BottomSheet>
    </Host>
  )
}
