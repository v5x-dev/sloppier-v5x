import { useCSSVariable } from "uniwind"

const names = {
  background: "--background",
  foreground: "--foreground",
  popover: "--popover",
  popoverForeground: "--popover-foreground",
  card: "--card",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  border: "--border",
  destructive: "--destructive",
  chart3: "--chart-3",
} as const

// Dark-theme values, used only until the CSS variables resolve.
const fallback: Record<keyof typeof names, string> = {
  background: "#0C0A09",
  foreground: "#FBFAF9",
  popover: "#1D1816",
  popoverForeground: "#FBFAF9",
  card: "#1D1816",
  muted: "#2B2422",
  mutedForeground: "#ABA09C",
  primary: "#F2C744",
  primaryForeground: "#5C3D12",
  border: "#FFFFFF1A",
  destructive: "#F87171",
  chart3: "#D08A16",
}

export type ThemeTokens = typeof fallback

/** The app's design tokens from global.css, as resolved color strings. */
export function useThemeTokens(): ThemeTokens {
  const values = useCSSVariable(Object.values(names))
  const tokens = {} as ThemeTokens
  ;(Object.keys(names) as (keyof typeof names)[]).forEach((key, index) => {
    const value = Array.isArray(values) ? values[index] : undefined
    tokens[key] = typeof value === "string" ? value : fallback[key]
  })
  return tokens
}
