import * as WebBrowser from "expo-web-browser"
import { Redirect } from "expo-router"
import { ActivityIndicator, Platform, Text, View } from "react-native"
import { useAuth } from "@/lib/auth"

// On web the popup delivers the callback to the original AuthRequest window.
WebBrowser.maybeCompleteAuthSession()

export default function CallbackScreen() {
  const { user } = useAuth()
  if (user) return <Redirect href="/" />
  if (Platform.OS !== "web") return <Redirect href="/sign-in" />
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16 }}><ActivityIndicator /><Text style={{ fontFamily: "Merriweather" }}>Completing sign-in. You can return to the app.</Text></View>
}
