import { Button, Host } from "@expo/ui"
import { glassEffect } from "@expo/ui/swift-ui/modifiers"
import { Platform, Pressable, View, type ViewStyle } from "react-native"
import { useState, type ReactElement } from "react"

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
  const [measuredWidth, setMeasuredWidth] = useState<number>()
  const nativeGlass =
    Platform.OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 26
  const iconOnly = typeof width === "number"
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{ width, height, alignSelf: iconOnly ? "center" : "stretch" }}
      onLayout={({ nativeEvent }) => setMeasuredWidth(nativeEvent.layout.width)}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      <View pointerEvents="none" style={{ width: "100%", height }}>
        <Host
          ignoreSafeArea="all"
          style={{ width: "100%", height }}
          accessibilityElementsHidden
        >
          <Button
            variant="text"
            label=" "
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
              width: measuredWidth ?? (typeof width === "number" ? width : 0),
              height,
              padding: 0,
              backgroundColor: nativeGlass ? "transparent" : tint,
              borderColor: border,
              borderWidth: nativeGlass ? 0 : 1,
              borderRadius: radius,
            }}
          />
        </Host>
      </View>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          alignItems: iconOnly ? "center" : "stretch",
          justifyContent: "center",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {children}
      </View>
    </Pressable>
  )
}
