import { Stack } from "expo-router";
import "../global.css";
import { useCSSVariable } from "uniwind";

export default function RootLayout() {
  const background = useCSSVariable("--color-background");

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: background },
      }}
    />
  );
}
