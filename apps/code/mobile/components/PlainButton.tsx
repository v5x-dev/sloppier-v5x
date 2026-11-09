import { Pressable } from "react-native";
import { Text } from "./Text";

// Token-styled button used everywhere Liquid Glass is unavailable.
export function PlainButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="rounded-full bg-primary px-6 py-3 active:opacity-80"
    >
      <Text className="font-serif text-primary-foreground">{label}</Text>
    </Pressable>
  );
}
