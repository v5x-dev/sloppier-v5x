import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Pressable, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useLocalSearchParams, useRouter } from "expo-router"
import { Stack } from "expo-router/stack"
import { CaretLeft, Check, GitCommit } from "phosphor-react-native"
import { useAction } from "convex/react"
import { Buffer } from "buffer"
import { api } from "@workspace/backend/api"
import type { Id } from "@workspace/backend/dataModel"
import { GlassButton } from "@/components/glass-button"
import { CodeEditor, type CodeEditorRef } from "@/components/code-editor"
import { SourceFileView } from "@/components/source-file-view"
import { useCSSVariable } from "uniwind"
import { sourceColors } from "@/lib/source-highlighting"
import { retryOnReconnect } from "@/lib/retry"
import { useLiveFile } from "@/lib/use-live-file"

export default function FileScreen() {
  const { "program-id": programId, path } = useLocalSearchParams<{
    "program-id": string
    path: string
  }>()
  const router = useRouter()
  const background = useCSSVariable("--background")
  const border = useCSSVariable("--border")
  const destructive = useCSSVariable("--destructive")
  const borderColor = typeof border === "string" ? border : "#FFFFFF1A"
  const errorColor = typeof destructive === "string" ? destructive : "#F87171"
  const muted = useCSSVariable("--muted-foreground")
  const mutedColor = typeof muted === "string" ? muted : sourceColors.gutter
  const foreground = useCSSVariable("--foreground")
  const foregroundColor =
    typeof foreground === "string" ? foreground : sourceColors.foreground
  const backgroundColor =
    typeof background === "string" ? background : "#0C0A09"
  const live = useLiveFile(programId as Id<"programs">, path)
  // Files the live editor rejects (too large, binary) stay viewable read-only.
  const liveFailed = live.text === null && live.error !== null
  const readFile = useAction(api.codeStorage.readFile)
  const commitFiles = useAction(api.codeStorage.commitFiles)
  // Live files always render in the native editor. Tapping the code focuses
  // it at the tapped character; while it has the keyboard, a check button
  // in the header ends editing.
  const editor = useRef<CodeEditorRef>(null)
  const [editing, setEditing] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [contents, setContents] = useState<string | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!liveFailed) return
    let active = true
    setContents(null)
    setReadError(null)
    void (async () => {
      if (!path) throw new Error("No file selected.")
      const chunks: Buffer[] = []
      let offset = 0
      let total = 0
      do {
        const page = await retryOnReconnect(() =>
          readFile({
            programId: programId as Id<"programs">,
            path,
            offset,
            length: 256 * 1024,
          })
        )
        if (!active) return
        const chunk = Buffer.from(page.bytes)
        if (!offset && chunk.includes(0))
          throw new Error(
            "This file contains binary data and cannot be displayed as code."
          )
        chunks.push(chunk)
        offset += chunk.length
        total = Number(page.contentRange?.match(/\/(\d+)$/)?.[1] ?? offset)
        if (total > 4 * 1024 * 1024)
          throw new Error("This file is too large to preview on mobile.")
        if (offset < total && !chunk.length)
          throw new Error("Could not read the remaining file contents.")
      } while (offset < total)
      if (active) setContents(Buffer.concat(chunks).toString("utf8"))
    })().catch((cause) => {
      if (active)
        setReadError(
          cause instanceof Error ? cause.message : "Could not read this file."
        )
    })
    return () => {
      active = false
    }
  }, [programId, path, readFile, attempt, liveFailed])

  const commit = async () => {
    const text = live.text
    if (text === null || !path || !live.synced || committing) return
    setCommitting(true)
    setCommitError(null)
    try {
      await commitFiles({
        programId: programId as Id<"programs">,
        message: `Update ${path}`,
        changes: [{ operation: "put", path, contents: text }],
      })
      live.markCommitted(text)
    } catch (cause) {
      setCommitError(
        cause instanceof Error ? cause.message : "Could not commit this file."
      )
    } finally {
      setCommitting(false)
    }
  }

  const displayed = live.text ?? (liveFailed ? contents : null)
  const readFailure = liveFailed ? readError : null
  const status = committing
    ? "Committing…"
    : commitError
      ? commitError
      : live.error
        ? live.error
        : live.text !== null
          ? null
          : liveFailed
            ? "Read-only · live editing is unavailable for this file"
            : null
  const statusIsError = Boolean(commitError ?? live.error)

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor }}>
      <Stack.Screen
        options={{
          headerShown: false,
          contentStyle: { backgroundColor },
        }}
      />
      <View
        style={{
          height: 64,
          paddingHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          borderBottomWidth: 1,
          borderBottomColor: borderColor,
        }}
      >
        <GlassButton
          label="Back to files"
          onPress={() => router.back()}
          tint="#2B2422"
          border={borderColor}
          width={44}
          height={44}
          radius={22}
        >
          <CaretLeft size={20} color={foregroundColor} />
        </GlassButton>
        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: "Merriweather",
              fontSize: 16,
              color: foregroundColor,
            }}
          >
            {path?.split("/").pop() ?? "File"}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: "Merriweather",
              fontSize: 10,
              color: mutedColor,
            }}
          >
            {path}
          </Text>
        </View>
        {live.edited ? (
          <GlassButton
            label="Commit file"
            onPress={commit}
            disabled={!live.synced || committing}
            tint="#2B2422"
            border={borderColor}
            width={44}
            height={44}
            radius={22}
          >
            <GitCommit size={20} color={foregroundColor} />
          </GlassButton>
        ) : null}
        {editing ? (
          <GlassButton
            label="Finish editing"
            onPress={() => editor.current?.blur()}
            tint="#2B2422"
            border={borderColor}
            width={44}
            height={44}
            radius={22}
          >
            <Check size={20} color={foregroundColor} />
          </GlassButton>
        ) : null}
      </View>
      {status ? (
        <Text
          numberOfLines={2}
          style={{
            paddingHorizontal: 16,
            paddingVertical: 6,
            fontFamily: "Merriweather",
            fontSize: 11,
            color: statusIsError ? errorColor : mutedColor,
          }}
        >
          {status}
        </Text>
      ) : null}
      {readFailure ? (
        <View style={{ padding: 20, gap: 12 }}>
          <Text
            accessibilityRole="alert"
            style={{
              color: sourceColors.foreground,
              fontFamily: "Merriweather",
            }}
          >
            {readFailure}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              live.retry()
              setAttempt((value) => value + 1)
            }}
            style={{ paddingVertical: 12 }}
          >
            <Text
              style={{
                color: sourceColors.foreground,
                fontFamily: "Merriweather",
              }}
            >
              Retry
            </Text>
          </Pressable>
        </View>
      ) : displayed === null ? (
        <ActivityIndicator
          accessibilityLabel="Loading file"
          color={sourceColors.foreground}
          style={{ padding: 24 }}
        />
      ) : live.text !== null ? (
        <CodeEditor
          key={`${programId}:${path}`}
          ref={editor}
          text={live.text}
          path={path}
          editable
          onChangeText={live.edit}
          onFocusChange={setEditing}
          backgroundColor={backgroundColor}
        />
      ) : (
        <SourceFileView
          key={`${programId}:${path}`}
          path={path}
          contents={displayed}
          backgroundColor={backgroundColor}
        />
      )}
    </SafeAreaView>
  )
}
