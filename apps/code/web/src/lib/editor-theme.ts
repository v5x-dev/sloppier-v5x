import { registerCustomTheme } from "@pierre/diffs"
import { birdsOfParadiseTheme } from "@v5x/ui/lib/birds-of-paradise-theme"

const themeName = "v5x-birds-of-paradise"
registerCustomTheme(themeName, async () => birdsOfParadiseTheme, "zed")

export const editorThemeOptions = {
  preferredHighlighter: "highlights" as const,
  theme: { dark: themeName, light: themeName },
  themeType: "dark" as const,
  disableFileHeader: true,
  unsafeCSS: `
    pre { --diffs-bg: var(--background); --diffs-dark-bg: var(--background); --diffs-light-bg: var(--background); }
    [data-code] { scrollbar-width: none; }
    [data-code]::-webkit-scrollbar { display: none; }
  `,
}
