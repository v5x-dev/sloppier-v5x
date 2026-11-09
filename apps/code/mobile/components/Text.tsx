import { Text as NativeText, type TextProps } from "react-native";

// Every piece of text in the app goes through this component so the family comes
// from the shared font token (packages/tokens/src/code/native-fonts.css).
export function Text({ className, ...props }: TextProps) {
  return <NativeText className={`font-serif ${className ?? ""}`} {...props} />;
}
