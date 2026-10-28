import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useCSSVariable } from "uniwind";

export default function Home() {
  const primary = useCSSVariable("--color-primary");
  const color = typeof primary === "string" ? primary : undefined;

  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Svg
        accessible
        accessibilityLabel="code by v5x logo"
        width={128}
        height={128}
        viewBox="-16 -16 196 196"
      >
        <Path
          d="M133.9 45c-.5 0-1 .2-1.3.6 0 0-48.6 59.4-51 62.4-2.4-3-50.1-62.4-50.1-62.4-.3-.4-.8-.6-1.3-.6h-28.6c-.6 0-1.2.4-1.5.9-.3.6-.2 1.2.2 1.7l66 80.2c.3.4.8.6 1.3.6h27.8c.5 0 .9-.2 1.3-.6l67-80.2c.4-.5.5-1.2.2-1.7-.3-.6-.8-.9-1.5-.9h-28.5z"
          fill={color}
          stroke={color}
          strokeWidth={12}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}
