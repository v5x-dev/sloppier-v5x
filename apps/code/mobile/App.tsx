import "./global.css"
import {
  Merriweather_400Regular,
  Merriweather_600SemiBold,
} from "@expo-google-fonts/merriweather"
import {
  Button,
  Column,
  Host,
  RNHostView,
  Row,
  Text,
  TextInput,
  useNativeState,
} from "@expo/ui"
import { glassEffect } from "@expo/ui/swift-ui/modifiers"
import { useFonts } from "expo-font"
import { StatusBar } from "expo-status-bar"
import { useCallback, useState } from "react"
import {
  Image,
  Platform,
  ScrollView,
  Text as NativeText,
  useColorScheme,
  View,
  type ImageSourcePropType,
} from "react-native"

const providers = [
  {
    id: "google",
    name: "Google",
    source: require("./assets/phosphor/google-logo.png"),
  },
  {
    id: "microsoft",
    name: "Microsoft",
    source: require("./assets/phosphor/microsoft-logo.png"),
  },
  {
    id: "github",
    name: "GitHub",
    source: require("./assets/phosphor/github-logo.png"),
  },
  {
    id: "apple",
    name: "Apple",
    source: require("./assets/phosphor/apple-logo.png"),
  },
] as const

const palettes = {
  light: {
    background: "#FFFFFF",
    foreground: "#0C0A09",
    mutedForeground: "#7C6D67",
    card: "rgba(0, 0, 0, 0.04)",
    cardBorder: "rgba(0, 0, 0, 0.1)",
    input: "rgba(0, 0, 0, 0.04)",
    placeholder: "#95857E",
    divider: "#E8E4E3",
    primary: "#FDC700",
    primaryForeground: "#733E0A",
    destructive: "#E7000B",
  },
  dark: {
    background: "#0C0A09",
    foreground: "#FBFAF9",
    mutedForeground: "#ABA09C",
    card: "rgba(255, 255, 255, 0.08)",
    cardBorder: "rgba(255, 255, 255, 0.16)",
    input: "rgba(255, 255, 255, 0.1)",
    placeholder: "#FFFFFF80",
    divider: "#FFFFFF26",
    primary: "#F0B100",
    primaryForeground: "#733E0A",
    destructive: "#FF6467",
  },
} as const

export default function App() {
  const [fontsLoaded] = useFonts({
    Merriweather: Merriweather_400Regular,
    MerriweatherSemiBold: Merriweather_600SemiBold,
  })

  if (!fontsLoaded) return null

  return <SignInScreen />
}

function SignInScreen() {
  const systemColorScheme = useColorScheme()
  const colorScheme = systemColorScheme === "dark" ? "dark" : "light"
  const colors = palettes[colorScheme]
  const usesLiquidGlass =
    process.env.EXPO_OS === "ios" &&
    Number.parseInt(String(Platform.Version), 10) >= 26
  const email = useNativeState("")
  const [feedback, setFeedback] = useState<{
    message: string
    tone: "error" | "info"
  } | null>(null)

  const updateEmail = useCallback(
    (value: string) => {
      "worklet"
      email.value = value
    },
    [email]
  )

  const continueWithEmail = useCallback(() => {
    const address = email.value.trim()

    if (!address) {
      setFeedback({
        message: "Enter your email address to continue.",
        tone: "error",
      })
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setFeedback({ message: "Enter a valid email address.", tone: "error" })
      return
    }

    setFeedback({
      message: "Email sign-in isn't configured in this mobile app yet.",
      tone: "info",
    })
  }, [email])

  const showUnavailableMessage = useCallback((action: string) => {
    setFeedback({
      message: `${action} isn't configured in this mobile app yet.`,
      tone: "info",
    })
  }, [])

  const glassModifiers = (
    shape: "capsule" | "roundedRectangle",
    cornerRadius = 16
  ) =>
    usesLiquidGlass
      ? [
          glassEffect({
            glass: { variant: "regular", interactive: true },
            shape,
            cornerRadius,
          }),
        ]
      : undefined

  const glassSurfaceStyle = (backgroundColor: string, cornerRadius: number) => ({
    backgroundColor,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: cornerRadius,
  })

  return (
    <>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ flexGrow: 1, justifyContent: "center" }}>
            <Host
              colorScheme={colorScheme}
              matchContents={{ vertical: true }}
              style={{ width: "100%" }}
            >
              <Column
                alignment="center"
                spacing={32}
                style={{
                  width: "100%",
                  paddingHorizontal: 20,
                  paddingTop: 88,
                  paddingBottom: 40,
                }}
              >
                <RNHostView
                  matchContents={{ vertical: true }}
                  style={{ width: "100%" }}
                >
                  <View
                    style={{
                      width: "100%",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <Image
                      source={require("./assets/logo.png")}
                      resizeMode="contain"
                      style={{ width: 48, height: 48 }}
                    />
                    <NativeText
                      style={{
                        fontFamily: "MerriweatherSemiBold",
                        fontSize: 28,
                        color: colors.foreground,
                      }}
                    >
                      Sign in
                    </NativeText>
                  </View>
                </RNHostView>

                <Column spacing={16} style={{ width: "100%" }}>
                  <Row
                    alignment="center"
                    spacing={10}
                    style={{ width: "100%" }}
                  >
                    <Row
                      alignment="center"
                      spacing={10}
                      modifiers={glassModifiers("roundedRectangle", 16)}
                      style={{
                        width: "82%",
                        height: 52,
                        paddingHorizontal: 16,
                        ...glassSurfaceStyle(colors.input, 16),
                      }}
                    >
                      <HostedImage
                        source={require("./assets/phosphor/envelope-simple.png")}
                        size={18}
                        tintColor={colors.mutedForeground}
                      />
                      <TextInput
                        value={email}
                        autoCapitalize="none"
                        autoComplete="email"
                        autoCorrect={false}
                        keyboardType="email-address"
                        onChangeText={updateEmail}
                        onSubmitEditing={continueWithEmail}
                        placeholder="Your email address"
                        placeholderTextColor={colors.placeholder}
                        returnKeyType="go"
                        style={{
                          width: "78%",
                          height: 52,
                          paddingHorizontal: 0,
                          backgroundColor: "transparent",
                          borderWidth: 0,
                          borderRadius: 0,
                        }}
                        textStyle={{
                          fontFamily: "Merriweather",
                          fontSize: 14,
                          color: colors.foreground,
                        }}
                      />
                    </Row>

                    <Button
                      onPress={continueWithEmail}
                      modifiers={glassModifiers("roundedRectangle", 16)}
                      style={{
                        width: 52,
                        height: 52,
                        padding: 0,
                        ...glassSurfaceStyle(colors.card, 16),
                      }}
                      testID="continue-with-email"
                      variant="text"
                    >
                      <HostedImage
                        source={require("./assets/phosphor/arrow-right.png")}
                        size={22}
                        tintColor={colors.primary}
                      />
                    </Button>
                  </Row>

                  {feedback ? (
                    <Text
                      textStyle={{
                        fontFamily: "Merriweather",
                        fontSize: 12,
                        color:
                          feedback.tone === "error"
                            ? colors.destructive
                            : colors.mutedForeground,
                        textAlign: "center",
                      }}
                    >
                      {feedback.message}
                    </Text>
                  ) : null}

                  <Row
                    alignment="center"
                    spacing={12}
                    style={{ width: "100%" }}
                  >
                    <View
                      style={{
                        width: "43%",
                        height: 1,
                        backgroundColor: colors.divider,
                      }}
                    />
                    <Text
                      textStyle={{
                        fontFamily: "Merriweather",
                        fontSize: 11,
                        color: colors.mutedForeground,
                      }}
                    >
                      OR
                    </Text>
                    <View
                      style={{
                        width: "43%",
                        height: 1,
                        backgroundColor: colors.divider,
                      }}
                    />
                  </Row>

                  <Row
                    alignment="center"
                    spacing={10}
                    style={{ width: "100%" }}
                  >
                    {providers.map((provider) => (
                      <Button
                        key={provider.id}
                        onPress={() =>
                          showUnavailableMessage(`${provider.name} sign-in`)
                        }
                        modifiers={glassModifiers("roundedRectangle", 16)}
                        style={{
                          width: "22.8%",
                          height: 52,
                          padding: 0,
                          ...glassSurfaceStyle(colors.card, 16),
                        }}
                        testID={`sign-in-${provider.id}`}
                        variant="text"
                      >
                        <HostedImage
                          source={provider.source}
                          size={26}
                          tintColor={colors.foreground}
                        />
                      </Button>
                    ))}
                  </Row>
                </Column>

                <Row alignment="center" spacing={4}>
                  <Text
                    textStyle={{
                      fontFamily: "Merriweather",
                      fontSize: 13,
                      color: colors.mutedForeground,
                    }}
                  >
                    Don't have an account?
                  </Text>
                  <Button
                    onPress={() => showUnavailableMessage("Sign-up")}
                    modifiers={glassModifiers("capsule")}
                    style={{
                      ...glassSurfaceStyle(colors.card, 20),
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                    }}
                    testID="sign-up"
                    variant="text"
                  >
                    <Text
                      textStyle={{
                        fontFamily: "MerriweatherSemiBold",
                        fontSize: 13,
                        color: colors.primary,
                      }}
                    >
                      Sign up
                    </Text>
                  </Button>
                </Row>
              </Column>
            </Host>
          </View>
        </ScrollView>
      </View>
    </>
  )
}

function HostedImage({
  source,
  size,
  tintColor,
}: {
  source: ImageSourcePropType
  size: number
  tintColor: string
}) {
  return (
    <RNHostView
      matchContents
      style={{ width: size, height: size, alignSelf: "center" }}
    >
      <Image
        source={source}
        resizeMode="contain"
        style={{ width: size, height: size, tintColor }}
      />
    </RNHostView>
  )
}
