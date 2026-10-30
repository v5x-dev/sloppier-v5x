import { defineConfig } from "vite"
import { randomUUID } from "node:crypto"
import { cloudflare } from "@cloudflare/vite-plugin"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const release = randomUUID()

const config = defineConfig({
  define: { __CODE_RELEASE__: JSON.stringify(release) },
  resolve: { tsconfigPaths: true },
  plugins: [
    {
      name: "code-release-marker",
      apply: "build",
      generateBundle() {
        if (this.environment.name === "client") {
          this.emitFile({
            type: "asset",
            fileName: "release.json",
            source: JSON.stringify({ release }),
          })
        }
      },
    },
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
