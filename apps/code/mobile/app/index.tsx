import { useEffect, useState } from "react"
import { ActivityIndicator, ScrollView, Text, View, useColorScheme } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { Button, Host } from "@expo/ui"
import { useConvexAuth, useMutation, useQuery } from "convex/react"
import { api } from "@workspace/backend/api"
import { useAuth } from "@/lib/auth"

export default function DashboardScreen() {
  const { user, signOut } = useAuth()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const ensurePersonal = useMutation(api.workspaces.ensurePersonal)
  const workspaces = useQuery(api.workspaces.listMine, isAuthenticated ? {} : "skip")
  const [setupError, setSetupError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const dark = useColorScheme() === "dark"
  const foreground = dark ? "#FBFAF9" : "#0C0A09"
  useEffect(() => {
    if (!isAuthenticated) return
    let active = true
    setSetupError(null)
    void ensurePersonal({}).catch((error) => { if (active) setSetupError(error instanceof Error ? error.message : "Could not set up your workspace.") })
    return () => { active = false }
  }, [isAuthenticated, ensurePersonal, attempt])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: dark ? "#0C0A09" : "#FFFFFF" }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 24 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontFamily: "MerriweatherSemiBold", fontSize: 28, color: foreground }}>Dashboard</Text>
          <View accessibilityLabel={user?.email} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: dark ? "#292524" : "#E8E4E3", justifyContent: "center", alignItems: "center" }}>
            <Text style={{ fontFamily: "Merriweather", color: foreground }}>{(user?.first_name ?? user?.email ?? "?").slice(0, 1).toUpperCase()}</Text>
          </View>
        </View>
        <Text style={{ fontFamily: "Merriweather", color: foreground }}>{user?.email}</Text>
        {isLoading || (isAuthenticated && workspaces === undefined) ? <ActivityIndicator accessibilityLabel="Loading workspaces" /> : null}
        {!isLoading && !isAuthenticated ? <Text style={{ color: foreground }}>Your session could not connect to the workspace. Sign out and try again.</Text> : null}
        {setupError ? <><Text accessibilityRole="alert" style={{ color: "#E7000B" }}>{setupError}</Text><Host matchContents><Button label="Retry workspace setup" onPress={() => setAttempt((value) => value + 1)} /></Host></> : null}
        {workspaces?.map(({ workspace }) => workspace ? <View key={workspace._id} style={{ padding: 20, borderRadius: 16, backgroundColor: dark ? "#292524" : "#F5F5F4" }}><Text style={{ color: foreground, fontFamily: "Merriweather", fontSize: 18 }}>{workspace.name}</Text></View> : null)}
        {workspaces?.length === 0 && !setupError ? <Text style={{ color: foreground, fontFamily: "Merriweather" }}>Setting up your personal workspace…</Text> : null}
        <Host matchContents><Button variant="text" label="Sign out" onPress={() => { void signOut().catch((error) => setSetupError(error instanceof Error ? error.message : "Could not clear your session.")) }} /></Host>
      </ScrollView>
    </SafeAreaView>
  )
}
