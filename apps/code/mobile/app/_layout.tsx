import "../global.css"
import { Merriweather_400Regular, Merriweather_600SemiBold } from "@expo-google-fonts/merriweather"
import { useFonts } from "expo-font"
import { Stack } from "expo-router/stack"
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react"
import { AuthProvider, useAuth, useConvexAuthAdapter } from "@/lib/auth"
import { ActivityIndicator, Text, View } from "react-native"

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null

function Routes() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}><ActivityIndicator accessibilityLabel="Restoring session" /></View>
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!user}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={Boolean(user)}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Screen name="callback" />
    </Stack>
  )
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Merriweather: Merriweather_400Regular, MerriweatherSemiBold: Merriweather_600SemiBold })
  if (!fontsLoaded && !fontError) return null
  if (!convex) return <View style={{ flex: 1, justifyContent: "center", padding: 24 }}><Text>Set EXPO_PUBLIC_CONVEX_URL to connect your workspace.</Text></View>
  return <AuthProvider><ConvexProviderWithAuth client={convex} useAuth={useConvexAuthAdapter}><Routes /></ConvexProviderWithAuth></AuthProvider>
}
