import { defineConfig } from "vite"
import { cloudflare } from "@cloudflare/vite-plugin"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      ...(process.env.CODE_PR_PREVIEW === "1"
        ? { configPath: "wrangler.preview.jsonc" }
        : {}),
    }),
    devtools(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  worker: { format: "es" },
  build: {
    // Keep font files as separate requests. An inlined font rides along in the
    // stylesheet and loads on every page, even pages that never use it.
    assetsInlineLimit: (filePath) =>
      filePath.endsWith(".woff2") ? false : undefined,
  },
  server: {
    allowedHosts: ["dev.xdvaychyt7al.opentunnel.xyz", "code-dev.v5x.dev"],
  },
})

export default config
