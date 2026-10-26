import { CaretLeft } from "phosphor-react-native"
import { ActivityIndicator, Text, View, useColorScheme } from "react-native"
import { Stack } from "expo-router/stack"
import { useLocalSearchParams, useRouter } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { GlassButton } from "@/components/glass-button"
import { useQuery } from "convex/react"
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
  const dark = useColorScheme() === "dark"
  const foreground = dark ? "#FBFAF9" : "#0C0A09"
  const sidebarColor = useCSSVariable("--sidebar")
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
        }}
      >
        <GlassButton
          label="Back to programs"
          onPress={() => router.back()}
          tint={backgroundColor}
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
            color: foreground,
          }}
        >
          {program?.name ?? "Program"}
        </Text>
      </View>
      <View style={{ flex: 1, padding: 16, gap: 16 }}>
        {!program ? (
          <ActivityIndicator accessibilityLabel="Loading program" />
        ) : (
          <>
            <Text
              style={{
                fontFamily: "MerriweatherSemiBold",
                fontSize: 22,
                color: foreground,
              }}
            >
              {program.name}
            </Text>
            <Text style={{ fontFamily: "Merriweather", color: foreground }}>
              {program.template === "ez-template"
                ? "EZ-Template"
                : program.template === "vexcode"
                  ? "VEXCode"
                  : program.template.toUpperCase()}
            </Text>
            <Text
              style={{
                fontFamily: "Merriweather",
                fontSize: 12,
                color: dark ? "#ABA09C" : "#7C6D67",
              }}
            >
              Created {new Date(program.createdAt).toLocaleDateString()}
            </Text>
            <Text style={{ fontFamily: "Merriweather", color: foreground }}>
              Repository: {program.repositoryStatus}
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  )
}
