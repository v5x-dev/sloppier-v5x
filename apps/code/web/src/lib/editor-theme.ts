import { registerCustomTheme } from "@pierre/diffs"

// Zed palette from https://github.com/LoganBresnahan/birds-of-paradise-zed.
// The upstream license is included alongside the theme.
const themeName = "v5x-birds-of-paradise"
registerCustomTheme(themeName, async () => {
  const { default: theme } = await import("./themes/birds-of-paradise-zed.json")
  return {
    ...theme.themes[0],
    appearance: "dark" as const,
  }
}, "zed")

export const editorThemeOptions = {
  preferredHighlighter: "highlights" as const,
  theme: { dark: themeName, light: themeName },
  themeType: "dark" as const,
  disableFileHeader: true,
  unsafeCSS: `pre { --diffs-bg: var(--background); --diffs-dark-bg: var(--background); --diffs-light-bg: var(--background); }`,
}
