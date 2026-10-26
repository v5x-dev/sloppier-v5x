import { Button, Host, RNHostView } from "@expo/ui"
import { glassEffect } from "@expo/ui/swift-ui/modifiers"
import { Platform, View, type ViewStyle } from "react-native"
import type { ReactElement } from "react"

type Props = {
  children: ReactElement
  onPress: () => void
  tint: string
  border: string
  height: number
  radius?: number
  width?: ViewStyle["width"]
  disabled?: boolean
  label: string
}
export function GlassButton({
  children,
  onPress,
  tint,
  border,
  height,
  radius = 12,
  width = "100%",
  disabled,
  label,
}: Props) {
  const nativeGlass =
    Platform.OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 26
  return (
    <Host ignoreSafeArea="all" style={{ width, height }}>
      <Button
        variant="text"
        disabled={disabled}
        onPress={onPress}
        modifiers={
          nativeGlass
            ? [
                glassEffect({
                  glass: { variant: "regular", interactive: true, tint },
                  shape: "roundedRectangle",
                  cornerRadius: radius,
                }),
              ]
            : undefined
        }
        style={{
          width: "100%",
          height,
          padding: 0,
          backgroundColor: nativeGlass ? "transparent" : tint,
          borderColor: border,
          borderWidth: nativeGlass ? 0 : 1,
          borderRadius: radius,
        }}
      >
        <RNHostView matchContents={{ vertical: true }}>
          <View
            accessibilityLabel={label}
            style={{ width: "100%", height, justifyContent: "center" }}
          >
            {children}
          </View>
        </RNHostView>
      </Button>
    </Host>
  )
}
