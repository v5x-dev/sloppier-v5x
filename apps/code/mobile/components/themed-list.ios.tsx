import type { ReactNode } from "react"
import { List } from "@expo/ui/swift-ui"
import {
  background,
  listStyle,
  scrollContentBackground,
} from "@expo/ui/swift-ui/modifiers"

// SwiftUI List on the app's background instead of the system grouped gray.
// The universal List does not take modifiers, so iOS uses SwiftUI directly.
export function ThemedList({
  children,
  backgroundColor,
}: {
  children: ReactNode
  backgroundColor: string
}) {
  return (
    <List
      modifiers={[
        listStyle("plain"),
        scrollContentBackground("hidden"),
        background(backgroundColor),
      ]}
    >
      {children}
    </List>
  )
}
