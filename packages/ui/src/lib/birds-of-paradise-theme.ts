import type { Theme } from "@pierre/highlights"
import theme from "./themes/birds-of-paradise-zed.json"

// Zed palette from https://github.com/LoganBresnahan/birds-of-paradise-zed.
// The upstream license is included alongside the theme.
export const birdsOfParadiseTheme = {
  ...theme.themes[0],
  appearance: "dark" as const,
} satisfies Theme
