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
import { StatusBar } from "expo-status-bar"
import { useCallback, useState } from "react"
import { useAuth } from "@/lib/auth"
import {
  Image,
  Platform,
  ScrollView,
  Text as NativeText,
  useColorScheme,
  View,
} from "react-native"

import {
  AppleLogo,
  ArrowRight,
  EnvelopeSimple,
  GithubLogo,
  GoogleLogo,
  WindowsLogo,
  type Icon,
} from "phosphor-react-native"

const providers = [
  {
    id: "google",
    name: "Google",
    icon: GoogleLogo,
  },
  {
    id: "microsoft",
    name: "Microsoft",
    icon: WindowsLogo,
  },
  {
    id: "github",
    name: "GitHub",
    icon: GithubLogo,
  },
  {
    id: "apple",
    name: "Apple",
    icon: AppleLogo,
  },
] as const

const palettes = {
  light: {
    background: "#FFFFFF",
    foreground: "#0C0A09",
    mutedForeground: "#7C6D67",
    card: "#FFFFFF",
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
    card: "#292524",
    cardBorder: "rgba(255, 255, 255, 0.16)",
    input: "rgba(255, 255, 255, 0.1)",
    placeholder: "#FFFFFF80",
    divider: "#FFFFFF26",
    primary: "#F0B100",
    primaryForeground: "#733E0A",
    destructive: "#FF6467",
  },
} as const

export default function SignInScreen() {
  const { signIn, isSigningIn, error } = useAuth()
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

    setFeedback(null)
    void signIn({ email: address })
  }, [email, signIn])

  const glassModifiers = (
    shape: "capsule" | "roundedRectangle",
    cornerRadius = 16
  ) =>
    usesLiquidGlass
      ? [
          glassEffect({
            glass: {
              variant: "regular",
              interactive: true,
              tint: colors.card,
            },
            shape,
            cornerRadius,
          }),
        ]
      : undefined

  const glassSurfaceStyle = (
    backgroundColor: string,
    cornerRadius: number
  ) => ({
    backgroundColor: usesLiquidGlass ? "transparent" : backgroundColor,
    borderColor: colors.cardBorder,
    borderWidth: usesLiquidGlass ? 0 : 1,
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
                        ...glassSurfaceStyle(colors.card, 16),
                      }}
                    >
                      <HostedIcon
                        icon={EnvelopeSimple}
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
                      disabled={isSigningIn}
                      onPress={continueWithEmail}
                      modifiers={glassModifiers("roundedRectangle", 16)}
                      style={{
                        width: 52,
                        height: 52,
                        padding: 0,
                        ...glassSurfaceStyle(colors.primary, 16),
                      }}
                      testID="continue-with-email"
                      variant="text"
                    >
                      <HostedIcon
                        icon={ArrowRight}
                        size={22}
                        tintColor={colors.primaryForeground}
                      />
                    </Button>
                  </Row>

                  {feedback || error || isSigningIn ? (
                    <Text
                      textStyle={{
                        fontFamily: "Merriweather",
                        fontSize: 12,
                        color:
                          feedback?.tone === "error" || error
                            ? colors.destructive
                            : colors.mutedForeground,
                        textAlign: "center",
                      }}
                    >
                      {feedback?.message ?? error ?? "Opening secure sign-in…"}
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
                        disabled={isSigningIn}
                        onPress={() => {
                          setFeedback(null)
                          void signIn({ provider: provider.id })
                        }}
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
                        <HostedIcon
                          icon={provider.icon}
                          size={26}
                          tintColor={colors.foreground}
                          buttonHeight={52}
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
                  <RNHostView matchContents>
                    <NativeText
                      accessibilityRole="link"
                      disabled={isSigningIn}
                      onPress={() => {
                        setFeedback(null)
                        void signIn({ signUp: true })
                      }}
                      testID="sign-up"
                      style={{
                        fontFamily: "Merriweather",
                        fontSize: 13,
                        color: colors.primary,
                      }}
                    >
                      Sign up
                    </NativeText>
                  </RNHostView>
                </Row>
              </Column>
            </Host>
          </View>
        </ScrollView>
      </View>
    </>
  )
}

function HostedIcon({
  icon: IconComponent,
  size,
  tintColor,
  buttonHeight,
}: {
  icon: Icon
  size: number
  tintColor: string
  buttonHeight?: number
}) {
  return (
    <RNHostView matchContents={buttonHeight ? { vertical: true } : true}>
      <View
        style={{
          width: buttonHeight ? "100%" : size,
          height: buttonHeight ?? size,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconComponent size={size} color={tintColor} weight="regular" />
      </View>
    </RNHostView>
  )
}
