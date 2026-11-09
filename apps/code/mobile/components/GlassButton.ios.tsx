import { Button, Host, Text as NativeText } from "@expo/ui/swift-ui";
import { buttonStyle, font } from "@expo/ui/swift-ui/modifiers";
import { Platform } from "react-native";
import { PlainButton } from "./PlainButton";

// Liquid Glass is a SwiftUI style that exists only on iOS 26+ (built with Xcode 26).
// Older iOS versions get the token-styled button.
const supportsLiquidGlass = parseInt(String(Platform.Version), 10) >= 26;

type GlassButtonProps = {
  label: string;
  onPress: () => void;
};

export function GlassButton({ label, onPress }: GlassButtonProps) {
  if (!supportsLiquidGlass) {
    return <PlainButton label={label} onPress={onPress} />;
  }

  return (
    <Host matchContents>
      <Button onPress={onPress} modifiers={[buttonStyle("glass")]}>
        <NativeText
          modifiers={[
            // SwiftUI resolves fonts by their PostScript name. The expo-font alias
            // (Merriweather_700Bold) only works with React Native's Text.
            font({ family: "Merriweather-Regular", size: 17 }),
          ]}
        >
          {label}
        </NativeText>
      </Button>
    </Host>
  );
}
