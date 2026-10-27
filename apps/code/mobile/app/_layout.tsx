import "../global.css"
import {
  Merriweather_400Regular,
  Merriweather_600SemiBold,
} from "@expo-google-fonts/merriweather"
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_400Regular_Italic,
  JetBrainsMono_700Bold,
  JetBrainsMono_700Bold_Italic,
} from "@expo-google-fonts/jetbrains-mono"
import { useFonts } from "expo-font"
import { StatusBar } from "expo-status-bar"
import { Stack } from "expo-router/stack"
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "expo-router/react-navigation"
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react"
import { AuthProvider, useAuth, useConvexAuthAdapter } from "@/lib/auth"
import { ActivityIndicator, Text, View, useColorScheme } from "react-native"
import { useCSSVariable } from "uniwind"

export { ErrorBoundary } from "expo-router"

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null

function Routes() {
  const { user, isLoading } = useAuth()
  const dark = useColorScheme() === "dark"
  const baseTheme = dark ? DarkTheme : DefaultTheme
  const themeBackground = useCSSVariable("--background")
  const backgroundColor =
    typeof themeBackground === "string" ? themeBackground : "#0C0A09"
  if (isLoading)
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor,
        }}
      >
        <ActivityIndicator accessibilityLabel="Restoring session" />
      </View>
    )
  return (
    <ThemeProvider
      value={{
        ...baseTheme,
        colors: {
          ...baseTheme.colors,
          background: backgroundColor,
          card: backgroundColor,
        },
      }}
    >
      <View style={{ flex: 1, backgroundColor }}>
        <StatusBar style={dark ? "light" : "dark"} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor },
            headerStyle: { backgroundColor },
            headerTintColor: baseTheme.colors.text,
            headerBackButtonDisplayMode: "minimal",
          }}
        >
          <Stack.Protected guard={!user}>
            <Stack.Screen name="sign-in" />
          </Stack.Protected>
          <Stack.Protected guard={Boolean(user)}>
            <Stack.Screen name="index" />
            <Stack.Screen name="programs/[program-id]" />
            <Stack.Screen name="programs/[program-id]/file" />
          </Stack.Protected>
          <Stack.Screen name="callback" />
        </Stack>
      </View>
    </ThemeProvider>
  )
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    JetBrainsMono: JetBrainsMono_400Regular,
    JetBrainsMonoItalic: JetBrainsMono_400Regular_Italic,
    JetBrainsMonoBold: JetBrainsMono_700Bold,
    JetBrainsMonoBoldItalic: JetBrainsMono_700Bold_Italic,
    Merriweather: Merriweather_400Regular,
    MerriweatherSemiBold: Merriweather_600SemiBold,
  })
  if (!fontsLoaded && !fontError) return null
  if (!convex)
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
        <Text>Set EXPO_PUBLIC_CONVEX_URL to connect your workspace.</Text>
      </View>
    )
  return (
    <AuthProvider>
      <ConvexProviderWithAuth client={convex} useAuth={useConvexAuthAdapter}>
        <Routes />
      </ConvexProviderWithAuth>
    </AuthProvider>
  )
}
