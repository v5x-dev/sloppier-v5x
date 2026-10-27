import { Button, Text } from "@expo/ui"
import {
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listRowSeparatorTint,
} from "@expo/ui/swift-ui/modifiers"
import { useThemeTokens } from "@/lib/theme-tokens"

// Sheets sit on the popover surface, so they use its token pair.
export function useSheetColors() {
  const tokens = useThemeTokens()
  return {
    background: tokens.popover,
    foreground: tokens.popoverForeground,
    mutedForeground: tokens.mutedForeground,
    border: tokens.border,
    primary: tokens.primary,
    primaryForeground: tokens.primaryForeground,
    destructive: tokens.destructive,
  }
}
export type SheetColors = ReturnType<typeof useSheetColors>

// Every row shares the sheet's 20pt edge so headers, controls and items line
// up. Separators only between real items, never under headers or controls.
export function rowModifiers(
  colors: SheetColors,
  { separator = true, top = 10, bottom = 10 } = {}
) {
  return [
    listRowBackground(colors.background),
    listRowInsets({ leading: 20, trailing: 20, top, bottom }),
    separator
      ? listRowSeparatorTint(colors.border)
      : listRowSeparator("hidden"),
  ]
}

export function SheetTitle({
  title,
  colors,
}: {
  title: string
  colors: SheetColors
}) {
  return (
    <Text
      textStyle={{
        fontFamily: "Merriweather-SemiBold",
        fontSize: 22,
        color: colors.foreground,
      }}
    >
      {title}
    </Text>
  )
}

export function SheetText({
  children,
  colors,
  muted,
  error,
  mono,
}: {
  children: string
  colors: SheetColors
  muted?: boolean
  error?: boolean
  mono?: boolean
}) {
  return (
    <Text
      textStyle={{
        fontFamily: mono ? "JetBrainsMono-Regular" : "Merriweather",
        fontSize: muted || error || mono ? 12 : 15,
        color: error
          ? colors.destructive
          : muted
            ? colors.mutedForeground
            : colors.foreground,
      }}
    >
      {children}
    </Text>
  )
}

// Primary-token button with the app font.
export function PrimaryButton({
  label,
  onPress,
  disabled,
  colors,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  colors: SheetColors
}) {
  return (
    <Button
      variant="filled"
      disabled={disabled}
      onPress={onPress}
      style={{
        backgroundColor: colors.primary,
        borderRadius: 10,
        paddingVertical: 10,
        paddingHorizontal: 16,
      }}
    >
      <Text
        textStyle={{
          fontFamily: "Merriweather-SemiBold",
          fontSize: 15,
          color: colors.primaryForeground,
        }}
      >
        {label}
      </Text>
    </Button>
  )
}

// Small muted label that heads a group of rows.
export function SectionLabel({
  children,
  colors,
}: {
  children: string
  colors: SheetColors
}) {
  return (
    <Text
      textStyle={{
        fontFamily: "Merriweather-SemiBold",
        fontSize: 11,
        color: colors.mutedForeground,
      }}
    >
      {children}
    </Text>
  )
}
