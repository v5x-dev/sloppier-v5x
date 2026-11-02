import { Text as NativeText, TextInput as NativeTextInput } from "react-native"
import type { TextInputProps, TextProps } from "react-native"

import { fontFamily } from "../theme/font"

export function Text({ style, ...props }: TextProps) {
  return <NativeText {...props} style={[{ fontFamily }, style]} />
}

export function TextInput({ style, ...props }: TextInputProps) {
  return <NativeTextInput {...props} style={[{ fontFamily }, style]} />
}
