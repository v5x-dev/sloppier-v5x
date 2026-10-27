import { Plus } from "phosphor-react-native"
import { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Image,
  Text,
  View,
  useColorScheme,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { BottomSheet, Host, RNHostView } from "@expo/ui"
import { useConvexAuth, useMutation, useQuery } from "convex/react"
import { useRouter } from "expo-router"
import { api } from "@workspace/backend/api"
import type { Doc, Id } from "@workspace/backend/dataModel"
import { useAuth } from "@/lib/auth"
import { ActionMenu } from "@/components/action-menu"
import { GlassButton } from "@/components/glass-button"
import { ProgramListItem } from "@/components/program-list-item"
import { RenameProgramSheet } from "@/components/rename-program-sheet"
import { useCSSVariable } from "uniwind"

type Template = "vexcode" | "pros" | "jar" | "ez-template"
const templateIcons = {
  vexcode: require("../assets/templates/vexcode.png"),
  pros: require("../assets/templates/pros.png"),
  jar: require("../assets/templates/jar.png"),
  "ez-template": require("../assets/templates/ez.png"),
}
const templates: { id: Template; name: string }[] = [
  { id: "vexcode", name: "VEXCode" },
  { id: "pros", name: "PROS" },
  { id: "ez-template", name: "EZ" },
  { id: "jar", name: "JAR" },
]
function createdAgo(timestamp: number) {
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000)
  for (const [unit, size] of [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ] as const) {
    if (seconds >= size) {
      const count = Math.floor(seconds / size)
      return `${count} ${unit}${count === 1 ? "" : "s"} ago`
    }
  }
  return "Just now"
}

export default function DashboardScreen() {
  const { user, signOut } = useAuth()
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)
  const avatarUrl = user?.profile_picture_url
  const { isAuthenticated, isLoading } = useConvexAuth()
  const router = useRouter()
  const ensurePersonal = useMutation(api.workspaces.ensurePersonal)
  const createProgram = useMutation(api.programs.create)
  const setArchived = useMutation(api.programs.setArchived)
  const [renameTarget, setRenameTarget] = useState<Doc<"programs"> | null>(null)
  const [updatingProgram, setUpdatingProgram] = useState<Id<"programs"> | null>(
    null
  )
  const updating = useRef(false)
  const workspaces = useQuery(
    api.workspaces.listMine,
    isAuthenticated ? {} : "skip"
  )
  const [selectedWorkspaceId, setSelectedWorkspaceId] =
    useState<Id<"workspaces"> | null>(null)
  const available = workspaces?.flatMap(({ workspace }) =>
    workspace ? [workspace] : []
  )
  const workspace =
    available?.find((item) => item._id === selectedWorkspaceId) ??
    available?.[0]
  const programs = useQuery(
    api.programs.listByWorkspace,
    isAuthenticated && workspace ? { workspaceId: workspace._id } : "skip"
  )
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const dark = useColorScheme() === "dark"
  const popoverColor = useCSSVariable("--popover")
  const mutedColor = useCSSVariable("--muted")
  const colors = {
    background: dark ? "#0C0A09" : "#FFFFFF",
    foreground: dark ? "#FBFAF9" : "#0C0A09",
    card: dark ? "#1D1816" : "#FFFFFF",
    muted: dark ? "#2B2422" : "#F3F1F1",
    mutedForeground: dark ? "#ABA09C" : "#7C6D67",
    border: dark ? "#FFFFFF1A" : "#E8E4E3",
    primary: dark ? "#F0B100" : "#FDC700",
    primaryForeground: "#733E0A",
  }
  useEffect(() => {
    if (!isAuthenticated) return
    let active = true
    setError(null)
    void ensurePersonal({}).catch((cause) => {
      if (active)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not set up your workspace."
        )
    })
    return () => {
      active = false
    }
  }, [isAuthenticated, ensurePersonal, attempt])
  const selectWorkspace = (id: string) => {
    if (id === "sign-out") {
      void signOut().catch((cause) =>
        setError(cause instanceof Error ? cause.message : "Could not sign out.")
      )
      return
    }
    const next = available?.find((item) => item._id === id)
    if (next) {
      setSelectedWorkspaceId(next._id)
      setError(null)
    }
  }
  const create = async (template: Template) => {
    if (!workspace || creating) return
    setCreating(true)
    setError(null)
    try {
      await createProgram({ workspaceId: workspace._id, template })
      setShowCreate(false)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create your program."
      )
    } finally {
      setCreating(false)
    }
  }
  const programAction = async (program: Doc<"programs">, action: string) => {
    if (updating.current) return
    if (action === "rename") {
      setRenameTarget(program)
      return
    }
    if (action !== "archive") return
    updating.current = true
    setUpdatingProgram(program._id)
    setError(null)
    try {
      await setArchived({
        programId: program._id,
        archived: !program.archivedAt,
      })
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update the program."
      )
    } finally {
      updating.current = false
      setUpdatingProgram(null)
    }
  }
  const loading =
    isLoading ||
    (isAuthenticated && (workspaces === undefined || programs === undefined))
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          height: 64,
          paddingHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Image
          source={require("../assets/logo.png")}
          resizeMode="contain"
          style={{ width: 24, height: 24 }}
          accessibilityLabel="v5x"
        />
        <ActionMenu
          title={user?.email ?? "Account"}
          dark={dark}
          actions={[
            {
              id: "workspaces",
              title: "Workspaces",
              displayInline: true,
              subactions:
                available?.map((item) => ({
                  id: item._id,
                  title: item.name,
                  state:
                    item._id === workspace?._id
                      ? ("on" as const)
                      : ("off" as const),
                })) ?? [],
            },
            {
              id: "sign-out",
              title: "Sign out",
              attributes: { destructive: true },
            },
          ]}
          onSelect={selectWorkspace}
        >
          <View
            accessible
            accessibilityRole="button"
            accessibilityLabel={`Account and workspace menu. Current workspace: ${workspace?.name ?? "Loading"}`}
            style={{
              width: 44,
              height: 44,
              alignItems: "flex-end",
              justifyContent: "center",
            }}
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                overflow: "hidden",
                backgroundColor: colors.muted,
                borderWidth: 1,
                borderColor: colors.border,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {avatarUrl && failedAvatarUrl !== avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  resizeMode="cover"
                  style={{ width: "100%", height: "100%" }}
                  onError={() => setFailedAvatarUrl(avatarUrl)}
                  accessibilityLabel="Profile photo"
                />
              ) : (
                <Text
                  style={{
                    fontFamily: "Merriweather",
                    fontSize: 12,
                    color: colors.mutedForeground,
                  }}
                >
                  {(user?.first_name ?? user?.email ?? "?")
                    .slice(0, 1)
                    .toUpperCase()}
                </Text>
              )}
            </View>
          </View>
        </ActionMenu>
      </View>
      <FlatList
        data={
          programs
            ?.filter((program) => !program.archivedAt)
            .sort((a, b) => b.createdAt - a.createdAt) ?? []
        }
        keyExtractor={(program) => program._id}
        contentContainerStyle={{
          paddingTop: 20,
          paddingBottom: 24,
        }}
        ListHeaderComponent={
          <View style={{ gap: 16, paddingBottom: 8, paddingHorizontal: 16 }}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text
                accessibilityRole="header"
                style={{
                  fontFamily: "Merriweather",
                  fontSize: 22,
                  color: colors.mutedForeground,
                }}
              >
                Your programs
              </Text>
              <GlassButton
                label="New program"
                onPress={() => setShowCreate(true)}
                disabled={!workspace || !isAuthenticated}
                tint={colors.primary}
                border={colors.border}
                height={44}
                width={44}
                radius={16}
              >
                <View
                  pointerEvents="none"
                  style={{
                    width: 44,
                    height: 44,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Plus
                    size={20}
                    color={colors.primaryForeground}
                    weight="bold"
                  />
                </View>
              </GlassButton>
            </View>
            {error ? (
              <View style={{ gap: 12 }}>
                <Text
                  accessibilityRole="alert"
                  style={{
                    fontFamily: "Merriweather",
                    fontSize: 12,
                    color: "#E7000B",
                  }}
                >
                  {error}
                </Text>
                <Text
                  accessibilityRole="button"
                  onPress={() => setAttempt((value) => value + 1)}
                  style={{ color: colors.primary, fontFamily: "Merriweather" }}
                >
                  Retry
                </Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator
              accessibilityLabel="Loading programs"
              color={colors.mutedForeground}
              style={{ padding: 24 }}
            />
          ) : (
            <Text
              style={{
                fontFamily: "Merriweather",
                fontSize: 13,
                color: colors.mutedForeground,
                paddingVertical: 20,
                paddingHorizontal: 20,
              }}
            >
              {!isAuthenticated
                ? "Your session could not connect. Use the avatar menu to sign out and try again."
                : "No programs yet. Tap + to create your first program."}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <ProgramListItem
            name={item.name}
            created={createdAgo(item.createdAt)}
            templateName={
              templates.find((template) => template.id === item.template)
                ?.name ?? item.template
            }
            icon={templateIcons[item.template]}
            foreground={colors.foreground}
            mutedForeground={colors.mutedForeground}
            pressedColor={colors.muted}
            border={colors.border}
            onPress={() =>
              router.push({
                pathname: "/programs/[program-id]",
                params: { "program-id": item._id },
              })
            }
            dark={dark}
            actionsDisabled={Boolean(updatingProgram)}
            onAction={(action) => {
              void programAction(item, action)
            }}
          />
        )}
      />
      {renameTarget ? (
        <RenameProgramSheet
          key={renameTarget._id}
          program={renameTarget}
          onClose={() => setRenameTarget(null)}
          colors={{
            ...colors,
            popover:
              typeof popoverColor === "string" ? popoverColor : colors.card,
          }}
        />
      ) : null}
      <Host matchContents>
        <BottomSheet
          isPresented={showCreate}
          onDismiss={() => setShowCreate(false)}
          containerColor={
            typeof popoverColor === "string"
              ? popoverColor
              : dark
                ? "#1D1816"
                : "#FFFFFF"
          }
        >
          <RNHostView matchContents={{ vertical: true }}>
            <View style={{ padding: 24, gap: 12, width: "100%" }}>
              <Text
                style={{
                  fontFamily: "MerriweatherSemiBold",
                  fontSize: 22,
                  color: colors.foreground,
                }}
              >
                Create new program
              </Text>
              {error ? (
                <Text
                  accessibilityRole="alert"
                  style={{
                    fontFamily: "Merriweather",
                    fontSize: 12,
                    color: "#E7000B",
                  }}
                >
                  {error}
                </Text>
              ) : null}
              {templates.map((template) => (
                <GlassButton
                  key={template.id}
                  label={`Create ${template.name} program`}
                  disabled={creating}
                  onPress={() => {
                    void create(template.id)
                  }}
                  tint={
                    typeof mutedColor === "string" ? mutedColor : colors.muted
                  }
                  border={colors.border}
                  height={52}
                >
                  <View
                    style={{
                      paddingHorizontal: 16,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <Image
                      source={templateIcons[template.id]}
                      style={{ width: 20, height: 20 }}
                      resizeMode="contain"
                    />
                    <Text
                      style={{
                        fontFamily: "Merriweather",
                        color: colors.foreground,
                      }}
                    >
                      {template.name}
                    </Text>
                  </View>
                </GlassButton>
              ))}
            </View>
          </RNHostView>
        </BottomSheet>
      </Host>
    </SafeAreaView>
  )
}
