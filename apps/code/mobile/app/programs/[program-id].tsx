import { CaretLeft } from "phosphor-react-native"
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  useColorScheme,
} from "react-native"
import { Stack } from "expo-router/stack"
import { useLocalSearchParams, useRouter } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { ProgramFileTree } from "@/components/program-file-tree"
import { GlassButton } from "@/components/glass-button"
import { ProgramActionsBar } from "@/components/program-actions-bar"
import { useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@workspace/backend/api"
import type { Id } from "@workspace/backend/dataModel"
import { useCSSVariable } from "uniwind"

export default function ProgramScreen() {
  const router = useRouter()
  const { "program-id": programId } = useLocalSearchParams<{
    "program-id": string
  }>()
  const program = useQuery(api.programs.get, {
    programId: programId as Id<"programs">,
  })
  const retryProvisioning = useMutation(api.programs.retryProvisioning)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const retry = async () => {
    if (retrying) return
    setRetrying(true)
    setRetryError(null)
    try {
      await retryProvisioning({ programId: programId as Id<"programs"> })
    } catch (cause) {
      setRetryError(cause instanceof Error ? cause.message : "Could not retry.")
    } finally {
      setRetrying(false)
    }
  }
  const dark = useColorScheme() === "dark"
  const foreground = dark ? "#FBFAF9" : "#0C0A09"
  const sidebarColor = useCSSVariable("--sidebar")
  const mutedColor = useCSSVariable("--muted")
  const backTint =
    typeof mutedColor === "string" ? mutedColor : dark ? "#2B2422" : "#F3F1F1"
  const backgroundColor =
    typeof sidebarColor === "string"
      ? sidebarColor
      : dark
        ? "#1D1816"
        : "#FBFAF9"
  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor,
      }}
    >
      <Stack.Screen
        options={{
          headerShown: false,
          gestureEnabled: true,
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
          borderBottomColor: dark ? "#FFFFFF1A" : "#E8E4E3",
        }}
      >
        <GlassButton
          label="Back to programs"
          onPress={() => router.back()}
          tint={backTint}
          border={dark ? "#FFFFFF1A" : "#E8E4E3"}
          width={44}
          height={44}
          radius={22}
        >
          <CaretLeft
            size={20}
            color={foreground}
            weight="regular"
            style={{ alignSelf: "center" }}
          />
        </GlassButton>
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontFamily: "Merriweather",
            fontSize: 17,
            textAlign: "center",
            color: foreground,
          }}
        >
          {program?.name ?? "Program"}
        </Text>
        <View style={{ width: 44 }} />
      </View>
      {program === undefined ? (
        <ActivityIndicator
          accessibilityLabel="Loading program"
          color={foreground}
          style={{ padding: 24 }}
        />
      ) : program === null ? (
        <Text
          style={{ fontFamily: "Merriweather", color: foreground, padding: 16 }}
        >
          Program not found.
        </Text>
      ) : program.repositoryStatus === "failed" ? (
        <View style={{ padding: 16, gap: 12 }}>
          <Text
            accessibilityRole="alert"
            style={{ fontFamily: "Merriweather", color: foreground }}
          >
            {retryError ?? "Could not prepare this program’s files."}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={retrying}
            onPress={() => {
              void retry()
            }}
            style={{ paddingVertical: 12 }}
          >
            <Text style={{ fontFamily: "Merriweather", color: foreground }}>
              {retrying ? "Retrying…" : "Retry"}
            </Text>
          </Pressable>
        </View>
      ) : (
        <ProgramFileTree
          key={program._id}
          programId={program._id}
          ready={program.repositoryStatus === "ready"}
          foreground={foreground}
          mutedForeground={dark ? "#ABA09C" : "#7C6D67"}
          muted={backTint}
        />
      )}
      {program && program.repositoryStatus === "ready" ? (
        <ProgramActionsBar
          programId={program._id}
          template={program.template}
        />
      ) : null}
    </SafeAreaView>
  )
}
