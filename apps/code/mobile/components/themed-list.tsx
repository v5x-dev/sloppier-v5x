import type { ReactNode } from "react"
import { List } from "@expo/ui"

// Universal fallback; the iOS version paints the list with theme tokens.
export function ThemedList({
  children,
}: {
  children: ReactNode
  backgroundColor: string
}) {
  return <List>{children}</List>
}
